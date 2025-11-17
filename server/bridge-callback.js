// bridge-callback.js — Twilio Voice + OpenAI Realtime bridge + Supabase tooling
// Dependencies: express (provided), ws (server provided), @supabase/supabase-js, twilio, libphonenumber-js

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const { Server: WebSocketServer } = WebSocket;
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const twilio = require("twilio");

// --- Stores mémoire spécifiques à la feature ---
const leadSummaryStore = new Map(); // lead_id -> { summary, lead, stored_at }
const activeTwilioBridges = new Set(); // Set<TwilioOpenAIBridge>

// --- Helper: normalisation numéros (utilisé par save_lead) ---
function normalizePhoneNumber(input, countryHint, env) {
  const DEFAULT_PHONE_REGION = (env.DEFAULT_PHONE_REGION || "FR").toUpperCase();
  const PHONE_FALLBACK_REGIONS = (env.PHONE_FALLBACK_REGIONS ||
    "FR,BE,CH,DE,AT,LU,NL,IE,GB,ES,PT,IT,DK,SE,NO,FI,US,CA")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);

  if (!input || typeof input !== "string") {
    return { ok: false, error: "invalid_input", raw: input };
  }
  const cleaned = input.trim();
  if (!cleaned) return { ok: false, error: "invalid_input", raw: input };

  const attempts = [];
  const normalizedForPrefix = cleaned.replace(/[\s()-]/g, "");

  if (/^\+/.test(normalizedForPrefix)) {
    attempts.push({
      method: "international_plus",
      parse: () => parsePhoneNumberFromString(cleaned),
    });
  }
  if (/^(00|011)\d+/.test(normalizedForPrefix)) {
    const digitsOnly = normalizedForPrefix.replace(/^(00|011)/, "");
    const plusCandidate = `+${digitsOnly}`;
    attempts.push({
      method: "idd_to_plus",
      parse: () => parsePhoneNumberFromString(plusCandidate),
    });
  }

  const normalizedHint =
    typeof countryHint === "string" && countryHint.trim().length === 2
      ? countryHint.trim().toUpperCase()
      : null;

  const countryCandidates = [];
  if (normalizedHint)
    countryCandidates.push({ code: normalizedHint, method: `hint:${normalizedHint}` });

  const preferredDefault =
    DEFAULT_PHONE_REGION && DEFAULT_PHONE_REGION.length === 2 ? DEFAULT_PHONE_REGION : null;
  if (preferredDefault)
    countryCandidates.push({ code: preferredDefault, method: `default:${preferredDefault}` });

  for (const fallback of PHONE_FALLBACK_REGIONS) {
    if (
      fallback &&
      fallback.length === 2 &&
      (!normalizedHint || fallback !== normalizedHint) &&
      fallback !== preferredDefault
    ) {
      countryCandidates.push({ code: fallback, method: `fallback:${fallback}` });
    }
  }

  countryCandidates.forEach(({ code, method }) => {
    attempts.push({ method, parse: () => parsePhoneNumberFromString(cleaned, code) });
  });

  for (const { method, parse } of attempts) {
    try {
      const phone = parse();
      if (phone && phone.isValid()) {
        return {
          ok: true,
          e164: phone.number,
          country: phone.country || null,
          extension: phone.ext || null,
          method,
          raw: cleaned,
        };
      }
    } catch (_) {}
  }
  return { ok: false, error: "ambiguous_or_invalid", raw: cleaned };
}

// --- Classe Bridge Twilio <-> OpenAI ---
class TwilioOpenAIBridge {
  constructor({ ws, context, env }) {
    this.env = env;
    this.connection = ws;
    this.summary = context.summary || null;
    this.lead = context.lead || null;
    this.language = context.language || "fr";

    this.streamSid = null;
    this.callSid = null;
    this.closed = false;
    this.sessionUpdated = false;
    this.didIntro = false;
    this.pendingInboundAudio = [];
    this.openAiSocket = null;
    this.openAiReady = false;

    this.setupTwilioSocket();
    this.connectOpenAI();
  }

  setupTwilioSocket() {
    this.connection.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        const event = message.event;
        if (event === "start") {
          this.streamSid = message.start?.streamSid || this.streamSid;
          this.callSid = message.start?.callSid || null;
          console.info("[bridge] Twilio stream started", {
            streamSid: this.streamSid,
            callSid: this.callSid,
          });
          this.sendInitialGreeting();
        } else if (event === "media" && message.media?.payload) {
          this.handleTwilioMedia(message.media.payload);
        } else if (event === "stop") {
          this.shutdown();
        }
      } catch (error) {
        console.error("[bridge] Failed to parse Twilio media message", error);
      }
    });

    this.connection.on("close", () => this.shutdown());
    this.connection.on("error", (error) => {
      console.error("[bridge] Twilio stream error", error);
      this.shutdown();
    });
  }

  handleTwilioMedia(payload) {
    if (this.closed || !payload) return;
    let muLawBuffer;
    try {
      muLawBuffer = Buffer.from(payload, "base64");
    } catch {
      return;
    }
    if (!muLawBuffer.length) return;

    if (!this.isOpenAiSocketReady()) {
      this.queueInboundAudio(muLawBuffer);
      return;
    }
    if (this.pendingInboundAudio.length) this.flushPendingInboundAudio();

    this.sendAudioChunkToOpenAI(muLawBuffer);
  }

  queueInboundAudio(buffer) {
    this.pendingInboundAudio.push(Buffer.from(buffer));
  }

  flushPendingInboundAudio() {
    if (!this.pendingInboundAudio.length || !this.isOpenAiSocketReady()) return;
    const chunks = this.pendingInboundAudio.splice(0);
    for (const chunk of chunks) this.sendAudioChunkToOpenAI(chunk);
  }

  isOpenAiSocketReady() {
    return (
      this.openAiSocket &&
      this.openAiSocket.readyState === WebSocket.OPEN &&
      this.openAiReady &&
      !this.closed
    );
  }

  sendAudioChunkToOpenAI(buffer) {
    if (!buffer?.length) return;
    if (!this.isOpenAiSocketReady()) {
      this.queueInboundAudio(buffer);
      return;
    }
    try {
      this.openAiSocket.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: buffer.toString("base64"),
        })
      );
    } catch (error) {
      console.error("[bridge] Failed to forward audio to OpenAI", error);
      this.queueInboundAudio(buffer);
    }
  }

  connectOpenAI() {
    if (!this.env.OPENAI_API_KEY) {
      console.error("[bridge] OPENAI_API_KEY is missing; cannot create OpenAI bridge");
      this.shutdown();
      return;
    }

    const model = this.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;

    this.openAiSocket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    this.openAiSocket.on("open", () => {
      this.openAiReady = true;
      console.info("[bridge] OpenAI socket connected", { model });

      const sessionUpdate = {
        instructions: this.buildInstructions(),
        voice: "alloy",
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 300 },
      };

      this.openAiSocket.send(JSON.stringify({ type: "session.update", session: sessionUpdate }));
      this.flushPendingInboundAudio();
    });

    this.openAiSocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "session.updated") {
          this.sessionUpdated = true;
          this.sendInitialGreeting();
        }
        this.handleOpenAIMessage(message);
      } catch (error) {
        console.error("[bridge] Failed to parse OpenAI message", error);
      }
    });

    this.openAiSocket.on("close", () => this.shutdown());
    this.openAiSocket.on("error", (error) => {
      console.error("[bridge] OpenAI socket error", error);
      this.shutdown();
    });
  }

  buildInstructions() {
    let base =
      "Tu es Callway, l'agent IA téléphonique. Continue la discussion entamée sur la landing page en restant chaleureux, professionnel et en français.";
    if (this.summary) base += `\nRésumé de la session web : ${this.summary}`;
    if (this.lead) {
      const fullName = [this.lead.first_name, this.lead.last_name]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (fullName) base += `\nInterlocuteur : ${fullName}.`;
      if (this.lead.phone_raw || this.lead.phone_e164) {
        base += `\nNuméro confirmé : ${this.lead.phone_raw || this.lead.phone_e164}.`;
      }
    }
    base +=
      "\nObjectif : confirmer le rappel, répondre aux questions, rassurer sur la confidentialité et proposer les prochaines étapes Callway.";
    return base;
  }

  handleOpenAIMessage(message) {
    switch (message.type) {
      case "response.audio.delta":
      case "response.output_audio.delta": {
        const base64Payload = message.delta ?? message.audio ?? null;
        if (!base64Payload) return;
        this.sendAudioToTwilio(base64Payload);
        break;
      }
      case "response.completed":
        console.info("[bridge] OpenAI response completed", message.response?.id);
        break;
      case "error":
        console.error("[bridge] OpenAI error", message);
        break;
      default:
        break;
    }
  }

  sendAudioToTwilio(base64Payload) {
    if (!base64Payload || !this.streamSid || this.closed) return;
    if (this.connection.readyState !== WebSocket.OPEN) return;
    try {
      this.connection.send(
        JSON.stringify({
          event: "media",
          streamSid: this.streamSid,
          media: { payload: base64Payload },
        })
      );
    } catch (error) {
      console.error("[bridge] Failed to send audio to Twilio", error);
    }
  }

  sendInitialGreeting() {
    if (
      this.didIntro ||
      !this.sessionUpdated ||
      !this.isOpenAiSocketReady() ||
      !this.streamSid
    ) {
      return;
    }
    try {
      this.openAiSocket.send(
        JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            voice: "alloy",
            instructions:
              "Le correspondant vient de décrocher. Accueille-le chaleureusement en français en te présentant comme l'agent Callway, puis poursuis immédiatement la discussion entamée sur le site.",
          },
        })
      );
      this.didIntro = true;
      console.info("[bridge] Greeting triggered via response.create");
    } catch (error) {
      console.error("[bridge] Failed to send greeting", error);
    }
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    this.openAiReady = false;
    this.pendingInboundAudio = [];

    try {
      if (this.connection && this.connection.readyState === WebSocket.OPEN) {
        this.connection.close();
      }
    } catch (_) {}

    try {
      if (this.openAiSocket && this.openAiSocket.readyState === WebSocket.OPEN) {
        this.openAiSocket.close();
      }
    } catch (_) {}

    this.openAiSocket = null;
  }
}

// --- Helpers Twilio ---
function parseBooleanFlag(value) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

async function isNumberAllowed(twilioClient, to) {
  if (!twilioClient || !to) return false;
  try {
    const [incoming, callerIds] = await Promise.all([
      twilioClient.incomingPhoneNumbers.list({ phoneNumber: to, pageSize: 1 }),
      twilioClient.outgoingCallerIds.list({ phoneNumber: to, pageSize: 1 }),
    ]);
    if (Array.isArray(incoming) && incoming.length > 0) return true;
    if (Array.isArray(callerIds) && callerIds.length > 0) return true;
    return false;
  } catch (error) {
    console.warn("[server] Unable to verify if number is allowed", error);
    return false;
  }
}

function escapeXmlAttribute(value) {
  if (typeof value !== "string") {
    return value;
  }
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function buildTwiml(streamUrl) {
  const safeUrl = escapeXmlAttribute(streamUrl);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<Response><Connect><Stream url="${safeUrl}"/></Connect></Response>`
  );
}

function resolveTwilioStreamUrl(env, leadId, extraQuery = {}) {
  const domainCandidate = env.TWILIO_STREAM_DOMAIN || env.PUBLIC_APP_URL;
  if (!domainCandidate) {
    throw new Error("TWILIO_STREAM_DOMAIN (or PUBLIC_APP_URL) must be configured for Twilio streams.");
  }

  let base = domainCandidate.trim();
  if (!/^https?:\/\//i.test(base) && !/^wss?:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  const url = new URL(base);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";

  const safeLead = encodeURIComponent(leadId);
  const language =
    extraQuery?.lang ||
    extraQuery?.language ||
    extraQuery?.locale ||
    "fr";
  const safeLang = encodeURIComponent(language);

  url.pathname = `/api/twilio/media-stream/${safeLead}/${safeLang}`;

  Object.entries(extraQuery || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (["lang", "language", "locale"].includes(key)) return; // already encoded in path
    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

// --- Initialisation de la feature sur une app/serveur existants ---
function setupCallbackFeature({ app, server }) {
  if (!app || !server) throw new Error("setupCallbackFeature requires { app, server }");

  // Snapshot des env utiles
  const env = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL || "gpt-realtime",

    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

    DEFAULT_PHONE_REGION: process.env.DEFAULT_PHONE_REGION || "FR",
    PHONE_FALLBACK_REGIONS: process.env.PHONE_FALLBACK_REGIONS,

    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,

    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER_FROM: process.env.TWILIO_PHONE_NUMBER_FROM,
    TWILIO_STREAM_DOMAIN: process.env.TWILIO_STREAM_DOMAIN,
    TWILIO_REQUIRE_VERIFIED_NUMBERS: parseBooleanFlag(
      process.env.TWILIO_REQUIRE_VERIFIED_NUMBERS || "0"
    ),
  };

  // Supabase client
  let supabaseClient = null;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }

  // Twilio client
  let twilioClient = null;
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  } else {
    console.warn("[server] Twilio credentials are not fully configured.");
  }

  // --- Endpoints REST ---
  app.post("/api/tools/save_lead", express.json(), async (req, res) => {
    if (!supabaseClient) {
      return res.status(500).json({ error: "Supabase is not configured on the server." });
    }

    const {
      first_name: firstName,
      last_name: lastName,
      phone_raw: phoneRaw,
      country_hint: countryHint,
      summary = null,
      source,
    } = req.body || {};
    if (!firstName || !lastName || !phoneRaw) {
      return res
        .status(400)
        .json({ error: "Missing parameters. Expected first_name, last_name, phone_raw (and optional summary, source)." });
    }

    const trimmedFirstName = String(firstName).trim();
    const trimmedLastName = String(lastName).trim();
    const trimmedPhoneRaw = String(phoneRaw).trim();
    if (!trimmedFirstName || !trimmedLastName || !trimmedPhoneRaw) {
      return res
        .status(400)
        .json({
          error: "Invalid parameters. first_name, last_name and phone_raw must be non-empty strings.",
        });
    }

    const normalized = normalizePhoneNumber(trimmedPhoneRaw, countryHint, env);
    if (!normalized.ok) {
      return res.status(422).json({
        error:
          "Unable to normalise phone number. Please provide a valid phone number including country code or a recognizable national format.",
        details: normalized,
      });
    }

    const leadPayload = {
      first_name: trimmedFirstName,
      last_name: trimmedLastName,
      phone_raw: trimmedPhoneRaw,
      phone_e164: normalized.e164,
      source: source && typeof source === "string" && source.trim() ? source.trim() : "landing_web",
      summary: summary && typeof summary === "string" && summary.trim() ? summary.trim() : null,
    };

    try {
      const { data, error } = await supabaseClient.from("leads").insert(leadPayload).select("id").single();
      if (error) {
        console.error("[server] Failed to insert lead", error);
        return res.status(500).json({ error: "Failed to store the lead in Supabase." });
      }

      leadSummaryStore.set(data.id, {
        summary: leadPayload.summary,
        lead: {
          id: data.id,
          first_name: leadPayload.first_name,
          last_name: leadPayload.last_name,
          phone_raw: leadPayload.phone_raw,
          phone_e164: leadPayload.phone_e164,
        },
        stored_at: new Date().toISOString(),
      });

      return res.status(200).json({
        lead_id: data.id,
        phone_e164: normalized.e164,
        country: normalized.country,
        normalization_method: normalized.method,
      });
    } catch (error) {
      console.error("[server] Unexpected error when saving lead", error);
      return res.status(500).json({ error: "Unexpected error while saving the lead." });
    }
  });

  app.post("/api/tools/trigger_call", express.json(), async (req, res) => {
    if (!supabaseClient) {
      return res.status(500).json({ error: "Supabase is not configured on the server." });
    }
    if (!twilioClient || !env.TWILIO_PHONE_NUMBER_FROM) {
      return res.status(500).json({
        error: "Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER_FROM).",
      });
    }

    const { lead_id: leadId, summary, language } = req.body || {};
    if (!leadId) return res.status(400).json({ error: "Missing parameter lead_id for trigger_call." });

    try {
      const { data: lead, error: leadError } = await supabaseClient
        .from("leads")
        .select("id, first_name, last_name, phone_e164, phone_raw, summary")
        .eq("id", leadId)
        .single();

      if (leadError) {
        console.error("[server] Failed to load lead", leadError);
        return res.status(500).json({ error: "Failed to retrieve lead from Supabase." });
      }
      if (!lead) return res.status(404).json({ error: "Lead not found", details: { lead_id: leadId } });

      const normalizedSummary =
        typeof summary === "string" && summary.trim().length > 0 ? summary.trim() : lead.summary || null;
      const preferredLanguage =
        typeof language === "string" && language.trim().length > 0 ? language.trim() : "fr";

      if (env.TWILIO_REQUIRE_VERIFIED_NUMBERS) {
        const allowed = await isNumberAllowed(twilioClient, lead.phone_e164);
        if (!allowed) {
          return res.status(403).json({
            error:
              "This phone number is not authorised for outbound calls. Verify the recipient in your Twilio console or disable TWILIO_REQUIRE_VERIFIED_NUMBERS.",
          });
        }
      }

      let streamUrl;
      try {
        streamUrl = resolveTwilioStreamUrl(env, leadId, { lang: preferredLanguage });
      } catch (error) {
        console.error("[server] Failed to resolve Twilio stream URL", error);
        return res.status(500).json({ error: "Unable to build Twilio stream URL." });
      }

      try {
        const twiml = buildTwiml(streamUrl);
        console.info("[server] Twilio stream URL", { stream_url: streamUrl });
        const call = await twilioClient.calls.create({
          from: env.TWILIO_PHONE_NUMBER_FROM,
          to: lead.phone_e164,
          twiml,
        });

        leadSummaryStore.set(leadId, {
          summary: normalizedSummary,
          lead: {
            id: lead.id,
            first_name: lead.first_name,
            last_name: lead.last_name,
            phone_raw: lead.phone_raw,
            phone_e164: lead.phone_e164,
          },
          stored_at: new Date().toISOString(),
          language: preferredLanguage,
        });

        if (normalizedSummary && normalizedSummary !== lead.summary) {
          try {
            const { error: summaryError } = await supabaseClient
              .from("leads")
              .update({ summary: normalizedSummary })
              .eq("id", leadId);
            if (summaryError) {
              console.warn("[server] Failed to persist summary update", {
                lead_id: leadId,
                error: summaryError,
              });
            }
          } catch (error) {
            console.warn("[server] Summary update threw an exception", { lead_id: leadId, error });
          }
        }

        return res.status(200).json({
          lead_id: leadId,
          call_sid: call?.sid ?? null,
          phone_e164: lead.phone_e164,
          summary: normalizedSummary,
          stream_url: streamUrl,
        });
      } catch (error) {
        console.error("[server] Twilio call failed", error);
        return res.status(502).json({ error: "Failed to trigger Twilio call.", details: error?.message });
      }
    } catch (error) {
      console.error("[server] Unexpected error during trigger_call", error);
      return res.status(500).json({ error: "Unexpected error while triggering the call." });
    }
  });

  // --- WebSocket Twilio Media Stream ---
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    console.info("[upgrade] incoming request", { url: request.url });
    let pathname = "";
    let query = {};
    let pathInfo = { leadFromPath: null, langFromPath: null };
    try {
      const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
      pathname = parsedUrl.pathname;
      query = Object.fromEntries(parsedUrl.searchParams.entries());
      const parts = pathname.split("/").filter(Boolean);
      if (parts.length >= 3 && parts[0] === "api" && parts[1] === "twilio" && parts[2] === "media-stream") {
        if (parts[3]) pathInfo.leadFromPath = decodeURIComponent(parts[3]);
        if (parts[4]) pathInfo.langFromPath = decodeURIComponent(parts[4]);
      }
    } catch (error) {
      socket.destroy();
      return;
    }

    const isTwilioStream = pathname.startsWith("/api/twilio/media-stream");
    if (isTwilioStream) {
      request.callwayPathInfo = pathInfo;
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, query);
      });
    } else {
      socket.destroy();
    }
  });

  async function resolveLeadContext(leadId) {
    if (!leadId) return null;
    let cached = leadSummaryStore.get(leadId);
    if (cached && cached.lead) {
      return cached;
    }
    if (!supabaseClient) return cached || null;

    try {
      const { data, error } = await supabaseClient
        .from("leads")
        .select("id, first_name, last_name, phone_raw, phone_e164, summary")
        .eq("id", leadId)
        .single();
      if (error || !data) return cached || null;

      cached = {
        summary: data.summary || cached?.summary || null,
        lead: {
          id: data.id,
          first_name: data.first_name,
          last_name: data.last_name,
          phone_raw: data.phone_raw,
          phone_e164: data.phone_e164,
        },
        stored_at: new Date().toISOString(),
      };
      leadSummaryStore.set(leadId, cached);
      return cached;
    } catch (error) {
      console.error("[server] Failed to resolve lead context", error);
      return cached || null;
    }
  }

  wss.on("connection", (ws, request, query) => {
    const pathInfo = request?.callwayPathInfo || {};
    const leadId = query?.lead_id || pathInfo.leadFromPath || null;
    const initialLang =
      (typeof query?.lang === "string" && query.lang.trim() && query.lang.trim()) ||
      (typeof pathInfo?.langFromPath === "string" && pathInfo.langFromPath.trim()) ||
      null;
    const preferredLanguage = initialLang || "fr";
    console.info("[ws] Incoming Twilio stream", {
      query,
      leadId,
      lang: preferredLanguage,
    });

    if (!leadId) {
      ws.close(1008, "lead_id missing");
      return;
    }

    let bridge = null;

    const cleanup = () => {
      if (bridge) {
        bridge.shutdown();
        activeTwilioBridges.delete(bridge);
      }
    };

    ws.on("close", cleanup);
    ws.on("error", (error) => {
      console.error("[ws] Twilio WS error", error);
      cleanup();
    });

    resolveLeadContext(leadId)
      .then((context) => {
        if (!context) {
          ws.close(1011, "context unavailable");
          return;
        }
        bridge = new TwilioOpenAIBridge({
          ws,
          context: {
            summary: context.summary,
            lead: context.lead,
            language: preferredLanguage,
          },
          env,
        });
        activeTwilioBridges.add(bridge);
      })
      .catch((error) => {
        console.error("[server] Unable to initialise Twilio bridge", error);
        ws.close(1011, "initialisation failure");
      });
  });

  return {
    stores: { leadSummaryStore, activeTwilioBridges },
  };
}

module.exports = { setupCallbackFeature };
