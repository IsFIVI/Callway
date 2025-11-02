const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const nacl = require("tweetnacl");
const WebSocket = require("ws");
const { Server: WebSocketServer } = WebSocket;


const fetchFn =
  globalThis.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: nodeFetch }) => nodeFetch(...args)));

const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

const app = express();

const corsOrigin = process.env.CORS_ORIGIN;
let corsOptions;

if (corsOrigin && corsOrigin.trim().length > 0) {
  const origins = corsOrigin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  corsOptions = {
    origin: origins.length === 1 ? origins[0] : origins,
    credentials: true,
  };
} else {
  corsOptions = {
    origin: "*",
  };
}

app.use(cors(corsOptions));
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PHONE_REGION =
  (process.env.DEFAULT_PHONE_REGION || "FR").toUpperCase();
const PHONE_FALLBACK_REGIONS = (process.env.PHONE_FALLBACK_REGIONS ||
  "FR,BE,CH,DE,AT,LU,NL,IE,GB,ES,PT,IT,DK,SE,NO,FI,US,CA")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_CONNECTION_ID = process.env.TELNYX_CONNECTION_ID;
const TELNYX_OUTBOUND_CALLER_ID = process.env.TELNYX_OUTBOUND_CALLER_ID;
const TELNYX_PUBLIC_KEY = process.env.TELNYX_PUBLIC_KEY;
const TELNYX_STREAM_URL = process.env.TELNYX_STREAM_URL;

let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
} else {
  console.warn(
    "[server] Supabase credentials are not fully configured. /api/tools/save_lead will return 500 errors."
  );
}

if (!OPENAI_API_KEY) {
  console.warn(
    "[server] OPENAI_API_KEY is not set. /api/realtime-token will return 500 errors."
  );
}

app.post("/api/realtime-token", express.json(), async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY is not configured on the server." });
  }

  const { voice = "alloy", modalities } = req.body || {};

  const baseTools = [
    {
      type: "function",
      name: "save_lead",
      description:
        "Validate and persist the user's contact information when they confirm the callback.",
      parameters: {
        type: "object",
        required: ["first_name", "last_name", "phone_raw"],
        properties: {
          first_name: {
            type: "string",
            description:
              "User's given name. Confirm spelling with the user if unsure.",
          },
          last_name: {
            type: "string",
            description:
              "User's family name. Confirm spelling with the user if unsure.",
          },
          phone_raw: {
            type: "string",
            description:
              "The phone number exactly as provided by the user (may be national or international format).",
          },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "trigger_call",
      description:
        "Request the backend to place a follow-up phone call to the user after data has been saved.",
      parameters: {
        type: "object",
        required: ["lead_id", "summary"],
        properties: {
          lead_id: {
            type: "string",
            description:
              "Identifier of the stored lead returned by the save_lead function.",
          },
          summary: {
            type: "string",
            description:
              "Short recap (in French) of the web conversation to brief the phone agent before the callback.",
          },
        },
        additionalProperties: false,
      },
    },
  ];

  try {
    const response = await fetchFn(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "realtime=v1",
        },
        body: JSON.stringify({
          model: OPENAI_REALTIME_MODEL,
          voice,
          ...(Array.isArray(modalities) && modalities.length > 0
            ? { modalities }
            : {}),
          tools: baseTools,
          instructions: [
            "Tu es Callway, l’agent IA vocal qui accueille les visiteurs de la landing page.",
            "Ta mission est de présenter Callway (agent IA téléphonique), répondre aux questions,",
            "puis guider la conversation vers une proposition de rappel téléphonique par notre IA.",
            "",
            "Processus à suivre :",
            "1. Explore poliment le contexte et les besoins de l’utilisateur.",
            "2. Présente les bénéfices clés de Callway (disponibilité 24/7, intégrations, transfert humain, multilingue…).",
            "3. Propose un rappel téléphonique lorsqu’il y a un intérêt manifeste.",
            "4. Si l’utilisateur accepte, collecte prénom, nom et numéro de téléphone EXACTEMENT comme il le dicte.",
            "   Ne convertis pas le numéro : tu dois transmettre le numéro brut.",
            "5. Fais valider toutes les informations (prénom, nom, numéro) avant de déclencher le rappel.",
            "   Lorsque tu répètes le numéro, restitue-le exactement comme l’utilisateur l’a dicté, sans ajout ni conversion.",
            "   N’invente, ne reformule ni ne convertis jamais le numéro ; laisse-le brut et laisse le backend réaliser les vérifications.",
          "6. Appelle la fonction save_lead uniquement après validation.",
          "7. Lorsque tu reçois la réponse de save_lead, si success=false, explique l’erreur et redemande poliment le numéro (avec l’indicatif pays).",
          "8. Une fois save_lead exécutée avec succès, propose immédiatement de lancer le rappel.",
          "9. Lorsque l’utilisateur confirme, appelle trigger_call en fournissant le lead_id et un court résumé",
          "   de la conversation (en français). Indique au résumé : besoins, points clés et consentement.",
          "10. Préviens l’utilisateur que l’appel va démarrer, remercie-le, puis clôture la session web.",
            "",
            "Contraintes supplémentaires :",
            "- Tu es toujours courtois, naturel et proactif. Ton ton est francophone natif.",
            "- Tu confirmes explicitement le consentement à être rappelé avant toute action.",
            "- Tu valides que le numéro paraît correct et rassures sur la confidentialité.",
            "  Ne reformule pas et ne convertis jamais le numéro : laisse-le exactement tel qu'il a été dicté.",
            "- Tu as déjà salué l’utilisateur via la salutation automatique. Ne redis plus “Bonjour” ou équivalent, réponds directement au contenu de son message.",
            "- Si l’utilisateur refuse ou est hésitant, respecte la décision et reste disponible pour autre chose.",
            "- Si l’utilisateur demande un rappel ultérieur, note-le dans le résumé.",
            "- Mentionne qu’aucune information n’est partagée en dehors de Callway.",
          ].join("\n"),
        }),
      }
    );

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const statusCode = response.status;
      const body =
        errorPayload && typeof errorPayload === "object"
          ? errorPayload
          : { error: "Failed to create OpenAI Realtime session" };

      return res.status(statusCode).json(body);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("[server] Failed to create OpenAI Realtime session", error);
    return res
      .status(500)
      .json({ error: "Unexpected error while creating realtime session" });
  }
});

const normalizePhoneNumber = (input, countryHint) => {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "invalid_input", raw: input };
  }

  const cleaned = input.trim();
  if (!cleaned) {
    return { ok: false, error: "invalid_input", raw: input };
  }

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
  if (normalizedHint) {
    countryCandidates.push({ code: normalizedHint, method: `hint:${normalizedHint}` });
  }

  const preferredDefault =
    DEFAULT_PHONE_REGION && DEFAULT_PHONE_REGION.length === 2
      ? DEFAULT_PHONE_REGION
      : null;

  if (preferredDefault) {
    countryCandidates.push({ code: preferredDefault, method: `default:${preferredDefault}` });
  }

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
    attempts.push({
      method,
      parse: () => parsePhoneNumberFromString(cleaned, code),
    });
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
    } catch (error) {
      // Ignore and try next strategy.
    }
  }

  return { ok: false, error: "ambiguous_or_invalid", raw: cleaned };
};

app.post("/api/tools/save_lead", express.json(), async (req, res) => {
  if (!supabaseClient) {
    return res
      .status(500)
      .json({ error: "Supabase is not configured on the server." });
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
    return res.status(400).json({
      error:
        "Missing parameters. Expected first_name, last_name, phone_raw (and optional summary, source).",
    });
  }

  const trimmedFirstName = String(firstName).trim();
  const trimmedLastName = String(lastName).trim();
  const trimmedPhoneRaw = String(phoneRaw).trim();

  if (!trimmedFirstName || !trimmedLastName || !trimmedPhoneRaw) {
    return res.status(400).json({
      error:
        "Invalid parameters. first_name, last_name and phone_raw must be non-empty strings.",
    });
  }

  const normalized = normalizePhoneNumber(trimmedPhoneRaw, countryHint);

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
    source: source && typeof source === "string" && source.trim()
      ? source.trim()
      : "landing_web",
    summary: summary && typeof summary === "string" && summary.trim()
      ? summary.trim()
      : null,
  };

  try {
    const { data, error } = await supabaseClient
      .from("leads")
      .insert(leadPayload)
      .select("id")
      .single();

    if (error) {
      console.error("[server] Failed to insert lead", error);
      return res
        .status(500)
        .json({ error: "Failed to store the lead in Supabase." });
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
    return res
      .status(500)
      .json({ error: "Unexpected error while saving the lead." });
  }
});

const leadSummaryStore = new Map();
const callBridgeState = new Map();
const activeBridges = new Map();

app.post("/api/tools/trigger_call", express.json(), async (req, res) => {
  if (!supabaseClient) {
    return res
      .status(500)
      .json({ error: "Supabase is not configured on the server." });
  }

  if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_OUTBOUND_CALLER_ID) {
    return res.status(500).json({
      error:
        "Telnyx credentials are not configured (TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_OUTBOUND_CALLER_ID).",
    });
  }

  const { lead_id: leadId, summary } = req.body || {};

  if (!leadId) {
    return res
      .status(400)
      .json({ error: "Missing parameter lead_id for trigger_call." });
  }

  try {
    const { data: lead, error: leadError } = await supabaseClient
      .from("leads")
      .select("id, first_name, last_name, phone_e164, phone_raw")
      .eq("id", leadId)
      .single();

    if (leadError) {
      console.error("[server] Failed to load lead", leadError);
      return res
        .status(500)
        .json({ error: "Failed to retrieve lead from Supabase." });
    }

    if (!lead) {
      return res
        .status(404)
        .json({ error: "Lead not found", details: { lead_id: leadId } });
    }

    const normalizedSummary =
      typeof summary === "string" && summary.trim().length > 0
        ? summary.trim()
        : null;

    const payload = {
      connection_id: TELNYX_CONNECTION_ID,
      to: lead.phone_e164,
      from: TELNYX_OUTBOUND_CALLER_ID,
      answering_machine_detection: "premium",
      client_state: Buffer.from(
        JSON.stringify({
          lead_id: leadId,
          summary: normalizedSummary,
        })
      ).toString("base64"),
    };

    console.info("[server] Triggering Telnyx call", {
      payload,
      summary: normalizedSummary,
      lead_id: leadId,
    });

    const telnyxResponse = await fetchFn("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const telnyxData = await telnyxResponse.json().catch(() => null);

    if (!telnyxResponse.ok) {
      console.error("[server] Telnyx call failed", telnyxData);
      return res.status(telnyxResponse.status).json({
        error: "Failed to trigger Telnyx call.",
        details: telnyxData,
      });
    }

    const callId = telnyxData?.data?.id || null;

    const leadEntry = leadSummaryStore.get(leadId) || {
      lead,
    };

    leadSummaryStore.set(leadId, {
      summary: normalizedSummary || leadEntry.summary || null,
      call_id: callId,
      lead: leadEntry.lead || lead,
      stored_at: new Date().toISOString(),
    });

    if (normalizedSummary) {
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
        console.warn("[server] Summary update threw an exception", {
          lead_id: leadId,
          error,
        });
      }
    }

    return res.status(200).json({
      lead_id: leadId,
      call_id: callId,
      phone_e164: lead.phone_e164,
      summary: summary || null,
      telnyx: telnyxData?.data || null,
    });
  } catch (error) {
    console.error("[server] Unexpected error during trigger_call", error);
    return res
      .status(500)
      .json({ error: "Unexpected error while triggering the call." });
  }
});

const verifyTelnyxSignature = ({ rawBody, signature, timestamp, publicKey }) => {
  if (!rawBody || !signature || !timestamp || !publicKey) {
    throw new Error("Missing Telnyx signature parameters");
  }

  const keyBytes = Buffer.from(publicKey.trim(), "base64");
  const signatureBytes = Buffer.from(signature, "base64");
  const messageBytes = Buffer.concat([
    Buffer.from(`${timestamp}|`, "utf8"),
    rawBody,
  ]);

  const isValid = nacl.sign.detached.verify(
    new Uint8Array(messageBytes),
    new Uint8Array(signatureBytes),
    new Uint8Array(keyBytes)
  );

  if (!isValid) {
    throw new Error("Telnyx signature verification failed");
  }
};

const telnyxWebhookHandler = async (req, res) => {
  if (!TELNYX_PUBLIC_KEY) {
    console.error("[server] Telnyx public key not configured");
    return res.status(500).json({ error: "Telnyx public key not configured" });
  }

  const signature = req.headers["telnyx-signature-ed25519"];
  const timestamp = req.headers["telnyx-timestamp"];

  if (!signature || !timestamp) {
    console.warn("[server] Missing Telnyx signature headers");
    return res.status(400).json({ error: "Missing Telnyx signature headers" });
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(
        typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}),
        "utf8"
      );

  try {
    verifyTelnyxSignature({
      rawBody,
      signature,
      timestamp,
      publicKey: TELNYX_PUBLIC_KEY,
    });
  } catch (error) {
    console.error("[server] Telnyx signature verification failed", error);
    return res.status(400).json({ error: "Invalid Telnyx signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    console.error("[server] Failed to parse Telnyx payload", error);
    return res.status(400).json({ error: "Invalid Telnyx payload" });
  }

  const eventType = payload?.data?.event_type;
  const call = payload?.data?.payload || {};
  const clientStateRaw = call.client_state || payload?.data?.client_state;
  let clientState = null;

  if (clientStateRaw) {
    try {
      clientState = JSON.parse(
        Buffer.from(clientStateRaw, "base64").toString("utf8")
      );
    } catch (error) {
      console.warn("[server] Unable to parse Telnyx client_state", error);
    }
  }

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
          summary:
            clientState.summary ?? leadEntry.summary ?? null,
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
          summary:
            clientState.summary ?? leadEntry.summary ?? null,
          lead: leadEntry.lead || null,
          streamStarted: false,
        });
      }

      startTelnyxStreaming(call.call_control_id).catch((error) =>
        console.error("[server] Failed to start Telnyx streaming", error)
      );
      break;
    }
    case "call.hangup": {
      stopTelnyxBridge(call.call_control_id);
      break;
    }
    default:
      console.debug("[server] Telnyx event ignored", eventType);
  }

  return res.status(200).json({ received: true });
};

app.use(
  "/api/telnyx/webhooks",
  express.raw({ type: "application/json" }),
  telnyxWebhookHandler
);

app.use(express.json());

const toWsUrl = (baseUrl, path, query = {}) => {
  const urlObj = new URL(baseUrl);
  urlObj.protocol = urlObj.protocol === "https:" ? "wss:" : "ws:";
  urlObj.pathname = path;
  Object.entries(query).forEach(([key, value]) => {
    urlObj.searchParams.set(key, value);
  });
  return urlObj.toString();
};

const resolveTelnyxStreamUrl = (callControlId) => {
  if (TELNYX_STREAM_URL && TELNYX_STREAM_URL.trim().length > 0) {
    try {
      const streamUrl = new URL(TELNYX_STREAM_URL.trim());
      streamUrl.searchParams.set("call_control_id", callControlId);
      return streamUrl.toString();
    } catch (error) {
      const template = TELNYX_STREAM_URL.trim();
      if (template.includes("{call_control_id}")) {
        return template.replace(
          "{call_control_id}",
          encodeURIComponent(callControlId)
        );
      }
      console.warn("[server] TELNYX_STREAM_URL is not a valid URL", error);
    }
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL;

  if (!publicAppUrl) {
    throw new Error(
      "PUBLIC_APP_URL (or TELNYX_STREAM_URL) must be configured for streaming_start"
    );
  }

  return toWsUrl(publicAppUrl, "/api/telnyx/stream", {
    call_control_id: callControlId,
  });
};

const startTelnyxStreaming = async (callControlId) => {
  const context = callBridgeState.get(callControlId);

  if (!context) {
    console.warn("[server] No bridge context for call", { callControlId });
    return;
  }

  if (context.streamStarted) {
    return;
  }

  if (!TELNYX_API_KEY) {
    console.error("[server] TELNYX_API_KEY missing; cannot start streaming");
    return;
  }

  let streamUrl;

  try {
    streamUrl = resolveTelnyxStreamUrl(callControlId);
  } catch (error) {
    console.error("[server] Failed to resolve Telnyx stream URL", error);
    return;
  }

  try {
    const response = await fetchFn(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent(
        callControlId
      )}/actions/streaming_start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stream_url: streamUrl,
          stream_bidirectional_mode: "rtp",
          stream_bidirectional_codec: "PCMU",
        }),
      }
    );

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("[server] Telnyx streaming_start failed", result);
      return;
    }

    context.streamStarted = true;
    context.streamUrl = streamUrl;

    console.info("[server] Telnyx streaming_start initiated", {
      call_control_id: callControlId,
      stream_url: streamUrl,
    });
  } catch (error) {
    console.error("[server] Telnyx streaming_start error", error);
  }
};

const stopTelnyxBridge = (callControlId) => {
  const bridge = activeBridges.get(callControlId);
  if (bridge) {
    bridge.shutdown();
    activeBridges.delete(callControlId);
  }
  callBridgeState.delete(callControlId);
};

const TELNYX_MEDIA_PAYLOAD_SIZE = 160;
const RTP_PAYLOAD_TYPE_PCMU = 0;
const RTP_HEADER_BYTES = 12;
const RTP_FRAME_SAMPLES = 160;
const RTP_CLOCK_RATE = 8000;

const buildRtpPacket = (pcmuPayload, sequenceNumber, timestamp, ssrc) => {
  const packet = Buffer.alloc(RTP_HEADER_BYTES + pcmuPayload.length);

  packet[0] = 0x80; // Version 2, no padding/extensions
  packet[1] = RTP_PAYLOAD_TYPE_PCMU & 0x7f;
  packet.writeUInt16BE(sequenceNumber & 0xffff, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  packet.writeUInt32BE(ssrc >>> 0, 8);
  pcmuPayload.copy(packet, RTP_HEADER_BYTES);

  return packet;
};

class TelnyxOpenAIBridge {
  constructor(callControlId, telnyxSocket, context = {}) {
    this.callControlId = callControlId;
    this.telnyxSocket = telnyxSocket;
    this.summary = context.summary || null;
    this.lead = context.lead || null;
    this.closed = false;
    this.streamId = null;
    this.didGreet = false;
    this.openAiSocket = null;
    this.openAiReady = false;
    this.pendingInboundAudio = [];
    this.rtpSeq = Math.floor(Math.random() * 0xffff);
    this.rtpTimestamp = Math.floor(Math.random() * 0xffffffff);
    this.rtpSsrc = Math.floor(Math.random() * 0xffffffff);
    this.rtpResidual = Buffer.alloc(0);

    this.setupTelnyxSocket();
    this.connectOpenAI();
  }

  setupTelnyxSocket() {
    this.telnyxSocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        const event = message?.event || message?.type;

        if (event === "media" && message.media?.payload) {
          let payloadBytes = 0;
          try {
            payloadBytes = Buffer.from(message.media.payload, "base64").length;
          } catch {
            payloadBytes = 0;
          }
          console.debug("[bridge] Telnyx media frame", {
            call_control_id: this.callControlId,
            stream_id:
              message.media.stream_id ||
              message.stream_id ||
              this.streamId ||
              null,
            base64_bytes: message.media.payload.length,
            pcmu_bytes: payloadBytes,
          });
        } else {
          console.info("[bridge] Telnyx event", {
            call_control_id: this.callControlId,
            event,
            stream_id:
              message.media?.stream_id ||
              message.stream_id ||
              message.start?.stream_id ||
              null,
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
      case "start":
        this.streamId =
          message.stream_id ||
          message.streamId ||
          message.start?.stream_id ||
          message.start?.streamId ||
          message.media?.stream_id ||
          this.streamId;
        this.maybeGreet();
        break;
      case "media":
        if (message.media?.payload) {
          if (message.media.stream_id && !this.streamId) {
            this.streamId = message.media.stream_id;
            this.maybeGreet();
          }
          this.handleTelnyxMedia(message.media.payload);
        }
        break;
      case "stop":
        this.shutdown();
        break;
      default:
        break;
    }
  }

  handleTelnyxMedia(payload) {
    if (this.closed || !payload) {
      return;
    }

    let muLawBuffer;
    try {
      muLawBuffer = Buffer.from(payload, "base64");
    } catch (error) {
      console.error("[bridge] Invalid Telnyx media payload", error);
      return;
    }

    if (!muLawBuffer.length) {
      return;
    }

    if (!this.isOpenAiSocketReady()) {
      this.queueInboundAudio(muLawBuffer);
      return;
    }

    if (this.pendingInboundAudio.length) {
      this.flushPendingInboundAudio();
    }

    console.debug("[bridge] Forwarding audio to OpenAI", {
      call_control_id: this.callControlId,
      pcmu_bytes: muLawBuffer.length,
    });
    this.sendAudioChunkToOpenAI(muLawBuffer);
  }

  queueInboundAudio(buffer) {
    this.pendingInboundAudio.push(Buffer.from(buffer));
  }

  flushPendingInboundAudio() {
    if (!this.pendingInboundAudio.length || !this.isOpenAiSocketReady()) {
      return;
    }

    const chunks = this.pendingInboundAudio.splice(0);
    for (const chunk of chunks) {
      this.sendAudioChunkToOpenAI(chunk);
    }
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
    if (!buffer?.length) {
      return;
    }

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
    const model = OPENAI_REALTIME_MODEL;
    const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
      model
    )}`;

    this.openAiSocket = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    this.openAiSocket.on("open", () => {
      this.openAiReady = true;
      console.info("[bridge] OpenAI socket connected", {
        call_control_id: this.callControlId,
        model,
      });

      const instructions = this.buildInstructions();
      const sessionUpdate = {
        instructions,
        voice: "alloy",
        modalities: ["audio", "text"],
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          silence_duration_ms: 300,
        },
      };

      this.openAiSocket.send(
        JSON.stringify({
          type: "session.update",
          session: sessionUpdate,
        })
      );

      this.flushPendingInboundAudio();
      this.maybeGreet();
    });

    this.openAiSocket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
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
      "Tu es Callway, l'agent IA telephonique. Continue la conversation entamee sur le site en restant naturel et professionnel.";

    if (this.summary) {
      base += `\nResume de la session web : ${this.summary}`;
    }

    if (this.lead) {
      base += `\nInformations confirmees : ${this.lead.first_name || ""} ${this.lead.last_name || ""} - numero ${this.lead.phone_raw || this.lead.phone_e164 || "inconnu"}.`;
    }

    base +=
      "\nBut : conclure le rappel, repondre aux questions et proposer l'etape suivante. Reponds en francais uniquement.";

    return base;
  }

  handleOpenAIMessage(message) {
    switch (message.type) {
      case "response.audio.delta": {
        const audio = message.audio;
        if (!audio) {
          return;
        }
        const muLaw = Buffer.from(audio, "base64");
        console.debug("[bridge] OpenAI audio delta received", {
          call_control_id: this.callControlId,
          pcmu_bytes: muLaw.length,
        });
        this.sendAudioToTelnyx(muLaw);
        break;
      }
      case "response.output_audio.delta": {
        const audio = message.delta || message.audio;
        if (!audio) {
          return;
        }
        const muLaw = Buffer.from(audio, "base64");
        console.debug("[bridge] OpenAI output audio delta received", {
          call_control_id: this.callControlId,
          pcmu_bytes: muLaw.length,
        });
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
    if (!muLawBuffer.length || this.closed) {
      return;
    }

    if (this.telnyxSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!this.streamId) {
      console.warn(
        "[bridge] Telnyx stream_id not yet available; dropping outbound audio"
      );
      return;
    }

    const combined =
      this.rtpResidual && this.rtpResidual.length
        ? Buffer.concat([this.rtpResidual, muLawBuffer])
        : muLawBuffer;

    let offset = 0;

    while (offset + TELNYX_MEDIA_PAYLOAD_SIZE <= combined.length) {
      const frame = combined.subarray(
        offset,
        offset + TELNYX_MEDIA_PAYLOAD_SIZE
      );

      const rtpPacket = buildRtpPacket(
        frame,
        this.rtpSeq,
        this.rtpTimestamp,
        this.rtpSsrc
      );

      this.rtpSeq = (this.rtpSeq + 1) & 0xffff;
      this.rtpTimestamp = (this.rtpTimestamp + RTP_FRAME_SAMPLES) >>> 0;

      this.telnyxSocket.send(
        JSON.stringify({
          event: "media",
          stream_id: this.streamId,
          media: { payload: rtpPacket.toString("base64") },
        })
      );

      offset += TELNYX_MEDIA_PAYLOAD_SIZE;
    }

    const leftover = combined.subarray(offset);
    this.rtpResidual =
      leftover.length > 0 ? Buffer.from(leftover) : Buffer.alloc(0);

    if (offset > 0) {
      console.debug("[bridge] Sent audio frame(s) to Telnyx", {
        call_control_id: this.callControlId,
        frames: offset / TELNYX_MEDIA_PAYLOAD_SIZE,
      });
    }
  }

  maybeGreet() {
    if (this.didGreet || !this.streamId || !this.isOpenAiSocketReady()) {
      return;
    }

    try {
      console.info("[bridge] Sending greeting response", {
        call_control_id: this.callControlId,
      });
      this.openAiSocket.send(
        JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["audio", "text"],
            voice: "alloy",
            instructions:
              "Le correspondant vient de decrocher. Salue-le et poursuis en francais la discussion entamee sur le site.",
          },
        })
      );
      this.didGreet = true;
    } catch (error) {
      console.error("[bridge] Failed to send greeting", error);
    }
  }

  shutdown() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.openAiReady = false;
    this.pendingInboundAudio = [];

    try {
      if (this.telnyxSocket && this.telnyxSocket.readyState === WebSocket.OPEN) {
        this.telnyxSocket.close();
      }
    } catch (error) {
      console.warn("[bridge] Failed to close Telnyx socket", error);
    }

    try {
      if (this.openAiSocket && this.openAiSocket.readyState === WebSocket.OPEN) {
        this.openAiSocket.close();
      }
    } catch (error) {
      console.warn("[bridge] Failed to close OpenAI socket", error);
    }

    this.openAiSocket = null;

    activeBridges.delete(this.callControlId);
    callBridgeState.delete(this.callControlId);
  }
}

const port = Number(process.env.PORT || 3001);

const server = app.listen(port, () => {
  console.log(`[server] listening on port ${port}`);
});

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols /*, request */) => {
    try {
      if (Array.isArray(protocols) && protocols.includes("telnyx-media-stream")) {
        return "telnyx-media-stream";
      }
      return (Array.isArray(protocols) && protocols[0]) || false;
    } catch (error) {
      return false;
    }
  },
});

server.on("upgrade", (request, socket, head) => {
  let pathname = "";
  let query = {};

  try {
    const parsedUrl = new URL(request.url, `http://${request.headers.host}`);
    pathname = parsedUrl.pathname;
    query = Object.fromEntries(parsedUrl.searchParams.entries());
  } catch (error) {
    console.error("[ws] upgrade parse error", error);
    socket.destroy();
    return;
  }

  if (pathname === "/api/telnyx/stream") {
    console.info("[ws] HTTP upgrade", { pathname, query });
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, query);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws, request, query) => {
  const callControlId = query?.call_control_id;

  if (!callControlId) {
    console.warn("[ws] missing call_control_id in query");
    ws.close();
    return;
  }

  console.info("[ws] Telnyx WS connected, awaiting context", {
    call_control_id: callControlId,
  });

  let bridge = null;
  let tries = 0;
  const MAX_TRIES = 50;
  const waitTimer = setInterval(() => {
    const context = callBridgeState.get(callControlId);
    if (context) {
      clearInterval(waitTimer);
      console.info("[ws] Bridge context ready, starting", {
        call_control_id: callControlId,
      });
      bridge = new TelnyxOpenAIBridge(callControlId, ws, context);
      activeBridges.set(callControlId, bridge);
    } else if (++tries >= MAX_TRIES) {
      clearInterval(waitTimer);
      console.warn("[ws] Context not found in time, closing", {
        call_control_id: callControlId,
      });
      try {
        ws.close();
      } catch (error) {
        console.error("[ws] Failed closing Telnyx WS", error);
      }
    }
  }, 100);

  ws.on("close", () => {
    clearInterval(waitTimer);
    if (bridge) {
      activeBridges.delete(callControlId);
      bridge.shutdown();
    }
    callBridgeState.delete(callControlId);
  });

  ws.on("error", (error) => {
    console.error("[ws] Telnyx WS error", error);
  });
});



