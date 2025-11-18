// server/index.js — version épurée + bridge externalisé

const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const fetchFn =
  globalThis.fetch ||
  ((...args) =>
    import("node-fetch").then(({ default: nodeFetch }) => nodeFetch(...args)));

const envPath = path.resolve(process.cwd(), ".env");
dotenv.config({ path: envPath });

const app = express();

// ----- CORS
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
  corsOptions = { origin: "*" };
}
app.use(cors(corsOptions));

// ----- Healthcheck
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ----- Realtime token (web agent) — on garde tel quel
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const WEB_END_SESSION_DELAY_MS = Number(
  process.env.WEB_END_SESSION_DELAY_MS || "5000"
);

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

  // On expose bien les tools attendus par le front (save_lead & trigger_call)
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
    {
      type: "function",
      name: "end_session",
      description:
        "Close the current realtime session on the landing page once every required action is completed.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description:
              "Optional sentence explaining to the user why the session is closing (e.g. callback scheduled).",
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
            "Tu es Callway, un agent IA vocal téléphonique qui accueille les visiteurs de la landing page callway.",
            "Ta mission est de présenter Callway (agent IA téléphonique), répondre aux questions,",
            "puis guider la conversation vers une proposition que tu les rappelle par téléphone.",
            "",
            "Processus à suivre :",
            "1. Explore poliment le contexte et les besoins de l’utilisateur.",
            "2. Présente les bénéfices clés de Callway (disponibilité 24h sur 24, 7j sur 7, intégrations, transfert humain, multilingue…).",
            "3. Propose un rappel téléphonique lorsqu’il y a un intérêt manifeste.",
            "4. Si l’utilisateur accepte, collecte prénom, nom et numéro de téléphone.",
            "   Ne convertis pas le numéro : tu dois transmettre le numéro brut, tel que l'utilisateur l'a dicté.",
            "5. Fais valider toutes les informations (prénom, nom, numéro) avant de déclencher le rappel.",
            "   Lorsque tu répètes le numéro, restitue-le exactement comme l’utilisateur l’a dicté, sans ajout ni conversion.",
            "   N’invente, ne reformule ni ne convertis jamais le numéro ; laisse-le brut et laisse le backend réaliser les vérifications.",
            "6. Puis ppelle la fonction save_lead.",
            "7. Lorsque tu reçois la réponse de save_lead, si success=false, explique l’erreur et redemande poliment le numéro (avec l’indicatif pays).",
            "8. Une fois save_lead exécutée avec succès, propose immédiatement de lancer le rappel.",
            "9. Lorsque l’utilisateur confirme, appelle trigger_call en fournissant le lead_id et un court résumé",
            "   de la conversation (en français). Indique au résumé : besoins, points clés et consentement.",
            "10. Lorsque trigger_call réussit, annonce que l’appel va démarrer",
            " 11. Puis une fois que a terminé d'annoncer que l’appel va démarrer informe l'utilisateur que tu vas clôturer la session web.",
            "11. Puis Appelle la fonction end_session pour raccrocher proprement la session.",
            "",
            "Contraintes supplémentaires :",
            "- Tu es toujours courtois, naturel et proactif. Ton ton est francophone natif mais tu as la capatité de parler plusieurs langues si l'utilisateur le demande.",
            "- Tu confirmes explicitement le consentement à être rappelé avant toute action.",
            "- Tu valides que le numéro paraît correct et rassures sur la confidentialité.",
            "  Ne reformule pas et ne convertis jamais le numéro : laisse-le exactement tel qu'il a été dicté.",
            "- Tu as déjà salué l’utilisateur via la salutation automatique. Ne redis plus “Bonjour” ou équivalent, réponds directement au contenu de son message.",
            "- Si l’utilisateur refuse ou est hésitant, respecte la décision et reste disponible pour autre chose.",
            "- Si l’utilisateur demande un rappel ultérieur, note-le dans le résumé.",
            "- Mentionne qu’aucune information n’est partagée en dehors de Callway.",
            "- Utilise end_session après le déclenchement du rappel ou lorsque l’utilisateur demande expressément de terminer.",
            "Lorsque tu dois utiliser end_sesion, utilise l'outils uniquement quand tu as terminé de parler et dis à l'utilisateur que tu racrochai car end-sesion coupe instentanément ta parole",
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
    const delayMs =
      Number.isFinite(WEB_END_SESSION_DELAY_MS) && WEB_END_SESSION_DELAY_MS >= 0
        ? WEB_END_SESSION_DELAY_MS
        : 5000;

    return res.status(200).json({
      ...data,
      callway_config: {
        web_end_session_delay_ms: delayMs,
      },
    });
  } catch (error) {
    console.error("[server] Failed to create OpenAI Realtime session", error);
    return res
      .status(500)
      .json({ error: "Unexpected error while creating realtime session" });
  }
});

// ----- Création du serveur HTTP
const server = http.createServer(app);

// ----- Bridge & rappel Telnyx externalisés
const { setupCallbackFeature } = require("./bridge-callback");
setupCallbackFeature({ app, server });

// (facultatif) body-parser global pour le reste de l’app
// app.use(express.json());

// ----- Démarrage
const port = Number(process.env.PORT || 3001);
server.listen(port, () => {
  console.log(`[server] listening on port ${port}`);
});
