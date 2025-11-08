// bridge-callback.js — Feature Telnyx callback + Bridge Telnyx ↔ OpenAI Realtime
// Dépendances: express (app fourni), ws (server fourni), @supabase/supabase-js, tweetnacl, libphonenumber-js

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const nacl = require("tweetnacl");
const WebSocket = require("ws");
const { Server: WebSocketServer } = WebSocket;
const { parsePhoneNumberFromString } = require("libphonenumber-js");

const fetchFn =
  globalThis.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: nodeFetch }) => nodeFetch(...args)));

// --- Stores mémoire spécifiques à la feature ---
const leadSummaryStore = new Map(); // lead_id -> { summary, lead, stored_at, call_id? }
const callBridgeState = new Map(); // call_control_id -> { leadId, summary, lead, streamStarted, streamUrl }
const activeBridges = new Map();   // call_control_id -> TelnyxOpenAIBridge

// --- Constantes μ-law (PCMU @ 8kHz) ---
const TELNYX_MEDIA_PAYLOAD_SIZE = 160; // 20ms @ 8kHz

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
    attempts.push({ method: "international_plus", parse: () => parsePhoneNumberFromString(cleaned) });
  }
  if (/^(00|011)\d+/.test(normalizedForPrefix)) {
    const digitsOnly = normalizedForPrefix.replace(/^(00|011)/, "");
    const plusCandidate = `+${digitsOnly}`;
    attempts.push({ method: "idd_to_plus", parse: () => parsePhoneNumberFromString(plusCandidate) });
  }

  const normalizedHint = typeof countryHint === "string" && countryHint.trim().length === 2
    ? countryHint.trim().toUpperCase() : null;

  const countryCandidates = [];
  if (normalizedHint) countryCandidates.push({ code: normalizedHint, method: `hint:${normalizedHint}` });

  const preferredDefault = DEFAULT_PHONE_REGION && DEFAULT_PHONE_REGION.length === 2 ? DEFAULT_PHONE_REGION : null;
  if (preferredDefault) countryCandidates.push({ code: preferredDefault, method: `default:${preferredDefault}` });

  for (const fallback of PHONE_FALLBACK_REGIONS) {
    if (fallback && fallback.length === 2 && (!normalizedHint || fallback !== normalizedHint) && fallback !== preferredDefault) {
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

// --- Vérification signature Telnyx (ED25519) ---
function verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey }) {
  if (!rawBody || !signature || !timestamp || !publicKey) {
    throw new Error("Missing Telnyx signature parameters");
  }
  const keyBytes = Buffer.from(publicKey.trim(), "base64");
  const signatureBytes = Buffer.from(signature, "base64");
  const messageBytes = Buffer.concat([Buffer.from(`${timestamp}|`, "utf8"), rawBody]);
  const isValid = nacl.sign.detached.verify(
    new Uint8Array(messageBytes),
    new Uint8Array(signatureBytes),
    new Uint8Array(keyBytes)
  );
  if (!isValid) throw new Error("Telnyx signature verification failed");
}

// --- Classe Bridge Telnyx ↔ OpenAI ---
class TelnyxOpenAIBridge {
  constructor(callControlId, telnyxSocket, context, env) {
    this.env = env;
    this.callControlId = callControlId;
    this.telnyxSocket = telnyxSocket;
    this.summary = context.summary || null;
    this.lead = context.lead || null;

    this.closed = false;
    this.streamId = null;           // stream_id "général" (si présent)
    this.streamIdInbound = null;    // stream_id piste inbound (appelant → nous)
    this.streamIdOutbound = null;   // stream_id piste outbound (nous → appelant)
    this.didGreet = false;
    this.openAiSocket = null;
    this.openAiReady = false;
    this.sessionUpdated = false;
    this.pendingInboundAudio = [];
    this.rtpResidual = Buffer.alloc(0);

    this.setupTelnyxSocket();
    this.connectOpenAI();
  }

  // --- WS Telnyx (réception events/media + découverte des tracks) ---
  setupTelnyxSocket() {
    this.telnyxSocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const event = message?.event || message?.type;

        if (event === "media" && message.media?.payload) {
          let payloadBytes = 0;
          try { payloadBytes = Buffer.from(message.media.payload, "base64").length; } catch {}
          console.debug("[bridge] Telnyx media frame", {
            call_control_id: this.callControlId,
            track: message.media?.track,
            stream_id: message.media?.stream_id || message.stream_id || this.streamId || null,
            base64_bytes: message.media.payload.length,
            pcmu_bytes: payloadBytes,
          });
        } else {
          console.info("[bridge] Telnyx event", {
            call_control_id: this.callControlId,
            event,
            track: message.start?.track || message.media?.track,
            stream_id: message.media?.stream_id || message.stream_id || message.start?.stream_id || null,
          });
        }
        this.handleTelnyxEvent(message);
      } catch (error) {
        console.error("[bridge] Failed to parse Telnyx message", error);
      }
    });

    this.telnyxSocket.on("close", () => this.shutdown());
    this.telnyxSocket.on("error", (error) => {
      console.error("[bridge] Telnyx socket error", error);
      this.shutdown();
    });
  }

  handleTelnyxEvent(message) {
    switch (message.event) {
      case "start": {
        // Telnyx envoie typiquement 2 événements "start": un par piste (inbound/outbound)
        const sid =
          message.start?.stream_id ||
          message.stream_id ||
          message.start?.streamId ||
          null;

        const track = message.start?.track || message.track || "unknown";

        // Mémorise un streamId "général" si pas encore appris
        if (!this.streamId && sid) this.streamId = sid;

        if (track === "inbound" && sid) {
          this.streamIdInbound = sid;
        } else if (track === "outbound" && sid) {
          this.streamIdOutbound = sid;
          // Si on a tamponné des frames en attendant l'outbound, flush maintenant
          if (this.rtpResidual && this.rtpResidual.length) {
            this.sendAudioToTelnyx(Buffer.alloc(0));
          }
        }

        console.info("[bridge] Telnyx start", {
          call_control_id: this.callControlId,
          track,
          sid,
          streamIdInbound: this.streamIdInbound,
          streamIdOutbound: this.streamIdOutbound,
        });

        this.maybeGreet();
        break;
      }
      case "media": {
        if (message.media?.payload) {
          // On peut parfois apprendre un stream_id via 'media' (pour inbound)
          if (message.media.stream_id && !this.streamId) {
            this.streamId = message.media.stream_id;
          }
          const track = message.media?.track || "unknown";
          if (track === "inbound" && !this.streamIdInbound) {
            this.streamIdInbound = message.media.stream_id || this.streamIdInbound;
          }
          if (track === "outbound" && !this.streamIdOutbound) {
            this.streamIdOutbound = message.media.stream_id || this.streamIdOutbound;
            if (this.rtpResidual && this.rtpResidual.length) {
              this.sendAudioToTelnyx(Buffer.alloc(0));
            }
          }
          this.handleTelnyxMedia(message.media.payload);
        }
        break;
      }
      case "stop":
        this.shutdown();
        break;
      default:
        break;
    }
  }

  handleTelnyxMedia(payload) {
    if (this.closed || !payload) return;
    let muLawBuffer;
    try { muLawBuffer = Buffer.from(payload, "base64"); } catch { return; }
    if (!muLawBuffer.length) return;

    if (!this.isOpenAiSocketReady()) {
      this.queueInboundAudio(muLawBuffer);
      return;
    }
    if (this.pendingInboundAudio.length) this.flushPendingInboundAudio();

    this.sendAudioChunkToOpenAI(muLawBuffer);
  }

  queueInboundAudio(buffer) { this.pendingInboundAudio.push(Buffer.from(buffer)); }

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
    if (!this.isOpenAiSocketReady()) { this.queueInboundAudio(buffer); return; }
    try {
      this.openAiSocket.send(
        JSON.stringify({ type: "input_audio_buffer.append", audio: buffer.toString("base64") })
      );
    } catch (error) {
      console.error("[bridge] Failed to forward audio to OpenAI", error);
      this.queueInboundAudio(buffer);
    }
  }

  // --- WS OpenAI (session.update + réception des deltas audio) ---
  connectOpenAI() {
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
      console.info("[bridge] OpenAI socket connected", { call_control_id: this.callControlId, model });
      const sessionUpdate = {
        instructions: this.buildInstructions(),
        voice: "alloy",
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 300 },
        input_audio_transcription: { enabled: true, language: "fr" },
      };

      this.openAiSocket.send(JSON.stringify({ type: "session.update", session: sessionUpdate }));
      this.flushPendingInboundAudio();
      // On attend 'session.updated' pour saluer proprement
    });

    this.openAiSocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "session.updated") {
          this.sessionUpdated = true;
          this.maybeGreet();
        }
        this.handleOpenAIMessage(message);
      } catch (e) {
        console.error("[bridge] Failed to parse OpenAI message", e);
      }
    });

    this.openAiSocket.on("close", () => this.shutdown());
    this.openAiSocket.on("error", (error) => { console.error("[bridge] OpenAI socket error", error); this.shutdown(); });
  }

  buildInstructions() {
    let base = "Tu es Callway, l'agent IA telephonique. Continue la conversation entamee sur le site en restant naturel et professionnel.";
    if (this.summary) base += `\nResume de la session web : ${this.summary}`;
    if (this.lead) base += `\nInformations confirmees : ${this.lead.first_name || ""} ${this.lead.last_name || ""} - numero ${this.lead.phone_raw || this.lead.phone_e164 || "inconnu"}.`;
    base += "\nBut : conclure le rappel, repondre aux questions et proposer l'etape suivante. Reponds en francais uniquement.";
    return base;
  }

  handleOpenAIMessage(message) {
    switch (message.type) {
      case "response.audio.delta":
      case "response.output_audio.delta": {
        const base64Payload = message.delta ?? message.audio ?? null;
        if (!base64Payload) return;
        const muLaw = Buffer.from(base64Payload, "base64");
        this.sendAudioToTelnyx(muLaw);
        break;
      }
      case "error":
        console.error("[bridge] OpenAI error", message);
        break;
      default:
        break;
    }
  }

  sendAudioToTelnyx(muLawBuffer) {
    if (((!muLawBuffer || !muLawBuffer.length) && (!this.rtpResidual || !this.rtpResidual.length)) || this.closed) return;
    if (this.telnyxSocket.readyState !== WebSocket.OPEN) return;

    // Il faut ABSOLUMENT router les paquets sur la piste OUTBOUND
    const chosenStream = this.streamIdOutbound || this.streamId;

    if (!chosenStream) {
      console.warn("[bridge] No stream_id available yet; delaying outbound audio");
      this.rtpResidual =
        this.rtpResidual.length > 0
          ? Buffer.concat([this.rtpResidual, muLawBuffer || Buffer.alloc(0)])
          : Buffer.from(muLawBuffer || Buffer.alloc(0));
      return;
    }

    // Si l'outbound n'est pas encore connu mais un id "général" existe, on bufferise
    if (!this.streamIdOutbound) {
      this.rtpResidual =
        this.rtpResidual.length > 0
          ? Buffer.concat([this.rtpResidual, muLawBuffer || Buffer.alloc(0)])
          : Buffer.from(muLawBuffer || Buffer.alloc(0));
      return;
    }

    const combined =
      this.rtpResidual && this.rtpResidual.length
        ? Buffer.concat([this.rtpResidual, muLawBuffer || Buffer.alloc(0)])
        : (muLawBuffer || Buffer.alloc(0));

    const FRAME = 160;
    let offset = 0;
    let framesSent = 0;

    while (offset + TELNYX_MEDIA_PAYLOAD_SIZE <= combined.length) {
      const frame = combined.subarray(offset, offset + TELNYX_MEDIA_PAYLOAD_SIZE);
      this.telnyxSocket.send(JSON.stringify({
        event: "media",
        stream_id: chosenStream, // <-- piste OUTBOUND
        track: "outbound",
        media: { payload: frame.toString("base64") },
      }));
      offset += TELNYX_MEDIA_PAYLOAD_SIZE;
      framesSent++;
    }

    const leftover = combined.subarray(offset);
    this.rtpResidual = leftover.length > 0 ? Buffer.from(leftover) : Buffer.alloc(0);

    if (framesSent > 0) {
      console.debug("[bridge] Sent μ-law frames to Telnyx", {
        call_control_id: this.callControlId,
        frames: framesSent,
        target_stream: chosenStream,
        outbound_known: !!this.streamIdOutbound,
      });
    }
  }

  maybeGreet() {
    if (this.didGreet || !this.streamId || !this.isOpenAiSocketReady() || !this.sessionUpdated) return;
    try {
      this.openAiSocket.send(JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["audio", "text"],
          voice: "alloy",
          instructions: "Le correspondant vient de decrocher. Salue-le et poursuis en francais la discussion entamee sur le site.",
        },
      }));
      this.didGreet = true;
      console.info("[bridge] Greeting queued via response.create", { call_control_id: this.callControlId });
    } catch (error) { console.error("[bridge] Failed to send greeting", error); }
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    this.openAiReady = false;
    this.pendingInboundAudio = [];

    try { if (this.telnyxSocket && this.telnyxSocket.readyState === WebSocket.OPEN) this.telnyxSocket.close(); } catch (e) { }
    try { if (this.openAiSocket && this.openAiSocket.readyState === WebSocket.OPEN) this.openAiSocket.close(); } catch (e) { }
    this.openAiSocket = null;

    activeBridges.delete(this.callControlId);
    callBridgeState.delete(this.callControlId);
  }
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

    TELNYX_API_KEY: process.env.TELNYX_API_KEY,
    TELNYX_CONNECTION_ID: process.env.TELNYX_CONNECTION_ID,
    TELNYX_OUTBOUND_CALLER_ID: process.env.TELNYX_OUTBOUND_CALLER_ID,
    TELNYX_PUBLIC_KEY: process.env.TELNYX_PUBLIC_KEY,
    TELNYX_STREAM_URL: process.env.TELNYX_STREAM_URL,

    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,

    DEFAULT_PHONE_REGION: process.env.DEFAULT_PHONE_REGION || "FR",
    PHONE_FALLBACK_REGIONS: process.env.PHONE_FALLBACK_REGIONS,
  };

  // Supabase (optionnel mais requis pour save_lead/trigger_call)
  let supabaseClient = null;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }

  // --- Endpoints REST ---
  app.post("/api/tools/save_lead", express.json(), async (req, res) => {
    if (!supabaseClient) return res.status(500).json({ error: "Supabase is not configured on the server." });

    const { first_name: firstName, last_name: lastName, phone_raw: phoneRaw, country_hint: countryHint, summary = null, source } = req.body || {};
    if (!firstName || !lastName || !phoneRaw) return res.status(400).json({ error: "Missing parameters. Expected first_name, last_name, phone_raw (and optional summary, source)." });

    const trimmedFirstName = String(firstName).trim();
    const trimmedLastName = String(lastName).trim();
    const trimmedPhoneRaw = String(phoneRaw).trim();
    if (!trimmedFirstName || !trimmedLastName || !trimmedPhoneRaw) return res.status(400).json({ error: "Invalid parameters. first_name, last_name and phone_raw must be non-empty strings." });

    const normalized = normalizePhoneNumber(trimmedPhoneRaw, countryHint, env);
    if (!normalized.ok) return res.status(422).json({ error: "Unable to normalise phone number. Please provide a valid phone number including country code or a recognizable national format.", details: normalized });

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
    if (!supabaseClient) return res.status(500).json({ error: "Supabase is not configured on the server." });
    if (!env.TELNYX_API_KEY || !env.TELNYX_CONNECTION_ID || !env.TELNYX_OUTBOUND_CALLER_ID) {
      return res.status(500).json({ error: "Telnyx credentials are not configured (TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_OUTBOUND_CALLER_ID)." });
    }

    const { lead_id: leadId, summary } = req.body || {};
    if (!leadId) return res.status(400).json({ error: "Missing parameter lead_id for trigger_call." });

    try {
      const { data: lead, error: leadError } = await supabaseClient
        .from("leads")
        .select("id, first_name, last_name, phone_e164, phone_raw")
        .eq("id", leadId)
        .single();

      if (leadError) {
        console.error("[server] Failed to load lead", leadError);
        return res.status(500).json({ error: "Failed to retrieve lead from Supabase." });
      }
      if (!lead) return res.status(404).json({ error: "Lead not found", details: { lead_id: leadId } });

      const normalizedSummary = typeof summary === "string" && summary.trim().length > 0 ? summary.trim() : null;
      const payload = {
        connection_id: env.TELNYX_CONNECTION_ID,
        to: lead.phone_e164,
        from: env.TELNYX_OUTBOUND_CALLER_ID,
        answering_machine_detection: "premium",
        client_state: Buffer.from(JSON.stringify({ lead_id: leadId, summary: normalizedSummary })).toString("base64"),
      };

      console.info("[server] Triggering Telnyx call", { payload, summary: normalizedSummary, lead_id: leadId });

      const telnyxResponse = await fetchFn("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const telnyxData = await telnyxResponse.json().catch(() => null);
      if (!telnyxResponse.ok) {
        console.error("[server] Telnyx call failed", telnyxData);
        return res.status(telnyxResponse.status).json({ error: "Failed to trigger Telnyx call.", details: telnyxData });
      }

      const callId = telnyxData?.data?.id || null;
      const leadEntry = leadSummaryStore.get(leadId) || { lead };
      leadSummaryStore.set(leadId, {
        summary: normalizedSummary || leadEntry.summary || null,
        call_id: callId,
        lead: leadEntry.lead || lead,
        stored_at: new Date().toISOString(),
      });

      if (normalizedSummary) {
        try {
          const { error: summaryError } = await supabaseClient.from("leads").update({ summary: normalizedSummary }).eq("id", leadId);
          if (summaryError) console.warn("[server] Failed to persist summary update", { lead_id: leadId, error: summaryError });
        } catch (error) { console.warn("[server] Summary update threw an exception", { lead_id: leadId, error }); }
      }

      return res.status(200).json({ lead_id: leadId, call_id: callId, phone_e164: lead.phone_e164, summary: summary || null, telnyx: telnyxData?.data || null });
    } catch (error) {
      console.error("[server] Unexpected error during trigger_call", error);
      return res.status(500).json({ error: "Unexpected error while triggering the call." });
    }
  });

  // --- Webhook Telnyx ---
  const telnyxWebhookHandler = async (req, res) => {
    if (!env.TELNYX_PUBLIC_KEY) {
      console.error("[server] Telnyx public key not configured");
      return res.status(500).json({ error: "Telnyx public key not configured" });
    }

    const signature = req.headers["telnyx-signature-ed25519"]; const timestamp = req.headers["telnyx-timestamp"];
    if (!signature || !timestamp) return res.status(400).json({ error: "Missing Telnyx signature headers" });

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}), "utf8");
    try { verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey: env.TELNYX_PUBLIC_KEY }); }
    catch (error) { console.error("[server] Telnyx signature verification failed", error); return res.status(400).json({ error: "Invalid Telnyx signature" }); }

    let payload; try { payload = JSON.parse(rawBody.toString("utf8")); } catch (error) { return res.status(400).json({ error: "Invalid Telnyx payload" }); }
    const eventType = payload?.data?.event_type; const call = payload?.data?.payload || {};
    const clientStateRaw = call.client_state || payload?.data?.client_state; let clientState = null;
    if (clientStateRaw) { try { clientState = JSON.parse(Buffer.from(clientStateRaw, "base64").toString("utf8")); } catch (e) { console.warn("[server] Unable to parse Telnyx client_state", e); } }

    console.info("[server] Telnyx webhook received", {
      event_type: eventType,
      call_control_id: call.call_control_id,
      call_leg_id: call.call_leg_id,
      call_session_id: call.call_session_id,
      state: call.state,
      answered_by_machine: call.answered_by_machine,
      tags: call.tags,
    });

    switch (eventType) {
      case "call.initiated": {
        if (clientState?.lead_id) {
          const leadEntry = leadSummaryStore.get(clientState.lead_id) || {};
          callBridgeState.set(call.call_control_id, {
            leadId: clientState.lead_id,
            summary: clientState.summary ?? leadEntry.summary ?? null,
            lead: leadEntry.lead || null,
            streamStarted: false,
          });
        }
        break;
      }
      case "call.answered": {
        if (clientState?.lead_id && !callBridgeState.has(call.call_control_id)) {
          const leadEntry = leadSummaryStore.get(clientState.lead_id) || {};
          callBridgeState.set(call.call_control_id, {
            leadId: clientState.lead_id,
            summary: clientState.summary ?? leadEntry.summary ?? null,
            lead: leadEntry.lead || null,
            streamStarted: false,
          });
        }
        startTelnyxStreaming(call.call_control_id, env).catch((error) => console.error("[server] Failed to start Telnyx streaming", error));
        break;
      }
      case "call.hangup": {
        stopTelnyxBridge(call.call_control_id);
        break;
      }
      default:
        break;
    }

    return res.status(200).json({ received: true });
  };

  app.use("/api/telnyx/webhooks", express.raw({ type: "application/json" }), telnyxWebhookHandler);

  // --- WebSocket Telnyx (upgrade sur /api/telnyx/stream) ---
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => {
      try {
        if (Array.isArray(protocols) && protocols.includes("telnyx-media-stream")) return "telnyx-media-stream";
        return (Array.isArray(protocols) && protocols[0]) || false;
      } catch { return false; }
    },
  });

  server.on("upgrade", (request, socket, head) => {
    let pathname = ""; let query = {};
    try {
      const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
      pathname = parsedUrl.pathname;
      query = Object.fromEntries(parsedUrl.searchParams.entries());
    } catch (error) {
      socket.destroy();
      return;
    }

    if (pathname === "/api/telnyx/stream") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, query);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, _request, query) => {
    const callControlId = query?.call_control_id;
    if (!callControlId) { ws.close(); return; }

    let bridge = null; let tries = 0; const MAX_TRIES = 50;
    const waitTimer = setInterval(() => {
      const context = callBridgeState.get(callControlId);
      if (context) {
        clearInterval(waitTimer);
        bridge = new TelnyxOpenAIBridge(callControlId, ws, context, env);
        activeBridges.set(callControlId, bridge);
      } else if (++tries >= MAX_TRIES) {
        clearInterval(waitTimer);
        try { ws.close(); } catch {}
      }
    }, 100);

    ws.on("close", () => {
      clearInterval(waitTimer);
      if (bridge) { activeBridges.delete(callControlId); bridge.shutdown(); }
      callBridgeState.delete(callControlId);
    });

    ws.on("error", (error) => { console.error("[ws] Telnyx WS error", error); });
  });

  // --- Helpers streaming_start ---
  function toWsUrl(baseUrl, path, query = {}) {
    const urlObj = new URL(baseUrl);
    urlObj.protocol = urlObj.protocol === "https:" ? "wss:" : "ws:";
    urlObj.pathname = path;
    Object.entries(query).forEach(([key, value]) => urlObj.searchParams.set(key, value));
    return urlObj.toString();
  }

  function resolveTelnyxStreamUrl(callControlId) {
    if (env.TELNYX_STREAM_URL && env.TELNYX_STREAM_URL.trim().length > 0) {
      try {
        const streamUrl = new URL(env.TELNYX_STREAM_URL.trim());
        streamUrl.searchParams.set("call_control_id", callControlId);
        return streamUrl.toString();
      } catch (error) {
        const template = env.TELNYX_STREAM_URL.trim();
        if (template.includes("{call_control_id}")) {
          return template.replace("{call_control_id}", encodeURIComponent(callControlId));
        }
      }
    }
    const publicAppUrl = env.PUBLIC_APP_URL;
    if (!publicAppUrl) throw new Error("PUBLIC_APP_URL (or TELNYX_STREAM_URL) must be configured for streaming_start");
    return toWsUrl(publicAppUrl, "/api/telnyx/stream", { call_control_id: callControlId });
  }

  async function startTelnyxStreaming(callControlId, envLocal) {
    const context = callBridgeState.get(callControlId);
    if (!context) { console.warn("[server] No bridge context for call", { callControlId }); return; }
    if (context.streamStarted) return;
    if (!envLocal.TELNYX_API_KEY) { console.error("[server] TELNYX_API_KEY missing; cannot start streaming"); return; }

    let streamUrl;
    try { streamUrl = resolveTelnyxStreamUrl(callControlId); }
    catch (error) { console.error("[server] Failed to resolve Telnyx stream URL", error); return; }

    try {
      const response = await fetchFn(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/streaming_start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${envLocal.TELNYX_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          stream_url: streamUrl,
          // on veut recevoir ET envoyer (et apprendre les deux stream_id)
          stream_track: "both_tracks",
          stream_bidirectional_mode: "rtp",
          stream_bidirectional_codec: "PCMU",
          stream_bidirectional_sampling_rate: 8000,
          stream_bidirectional_target_legs: "both"
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) { console.error("[server] Telnyx streaming_start failed", result); return; }

      context.streamStarted = true;
      context.streamUrl = streamUrl;
      console.info("[server] Telnyx streaming_start initiated", { call_control_id: callControlId, stream_url: streamUrl });
    } catch (error) {
      console.error("[server] Telnyx streaming_start error", error);
    }
  }

  function stopTelnyxBridge(callControlId) {
    const bridge = activeBridges.get(callControlId);
    if (bridge) { bridge.shutdown(); activeBridges.delete(callControlId); }
    callBridgeState.delete(callControlId);
  }

  return {
    stores: { leadSummaryStore, callBridgeState, activeBridges },
  };
}

module.exports = { setupCallbackFeature };
