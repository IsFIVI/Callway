# Callway — Contexte, Règles et Plan d’Implémentation

## 1) Résumé du projet

Landing page (front déjà en place) intégrant un agent d’IA vocal temps réel via OpenAI Realtime (speech-to-speech). Au clic sur le bouton (mockup iPhone), l’utilisateur converse naturellement avec l’agent (présentation du produit “agent IA téléphonique”, qualification). L’agent propose un rappel automatique : collecte prénom, nom, téléphone, confirme les infos, enregistre en base (Supabase via function calling), déclenche un appel sortant via Telnyx (function calling) et annonce la fin de la session web. Le téléphone de l’utilisateur sonne; à la prise d’appel, une nouvelle session Realtime (côté serveur) démarre avec un résumé de la session web pour reprendre la conversation.

Objectif final: un parcours complet et fluide web → appel téléphonique, avec orchestration minimale, JavaScript simple, et respect des bonnes pratiques sécurité (tokens éphémères, clés serveur only, validation E.164, webhooks signés).

## 2) Règles OBLIGATOIRES

1. Avant chaque implémentation, consulter et suivre la documentation interne: `documentations.md`.

- Cette étape est obligatoire pour chaque fichier/modification.
- En cas de divergence, `documentations.md` prime sur les choix d’implémentation.

2. Dire a l'utilisateur lorsqu'une intervention humaine est nécessaire en spécifiant précisement les actions a réaliser.

3. Effectuer des tests a la fin de chaque implémentation. Si les tests nécessite une intervention humaine, il faut bien expliquer ce que l'utilisateur doit faire.

## 3) Arborescence minimale (cible)

- `public/index.html` — UI landing (existant)
- `public/assets/css/styles.css` — build Tailwind (existant)
- `public/assets/js/front-animations.js` — animations UI (existant)
- `public/assets/js/agent.js` — WebRTC Realtime + UI voix + plomberies tools
- `server/index.js` — serveur Node/Express minimal (token éphémère, tools Supabase/Telnyx, webhooks, bridge Telnyx↔OpenAI)
- `.env` / `.env.example` — variables OpenAI/Telnyx/Supabase/URL webhook
- `documentations.md` — références techniques et flux (existant)
- `README.md` — runbook local (scripts, env, test)

Note: Corriger les chemins d’assets absolus (Windows) en chemins relatifs pour déploiement.

## 4) Plan d’implémentation (itératif et testable)

Chaque étape aboutit à un objectif fonctionnel vérifiable avant de passer à la suivante.

1. Préparer le front (structure minimale)

- Objectif: ajouter `public/assets/js/agent.js`, corriger le logo en chemin relatif, brancher le bouton `#btn-voice` et l’animation `#audio-wave`.
- Test: la page charge sans erreur; clic → l’état du bouton et l’onde changent.

2. Créer la table Supabase `leads`

- Objectif: table `leads(id, first_name, last_name, phone_raw, phone_e164, created_at, source, summary)` avec RLS (service_role bypass).
- Test: insertion manuelle via dashboard/SQL; lecture OK; contraintes E.164 validées et conservation du numéro brut.

3. Squelette serveur Node/Express

- Objectif: `server/index.js` avec CORS, `GET /api/health` (200 OK), lecture `.env`.
- Test: `GET /api/health` renvoie OK.

4. Endpoint token éphémère Realtime

- Objectif: `POST /api/realtime-token` (serveur) qui appelle l’API OpenAI “sessions” avec `OPENAI_API_KEY` et renvoie un token court au front.
- Test: `POST /api/realtime-token` → 200 + token JSON.

5. Front: capture micro + RTCPeerConnection (sans Realtime)

- Objectif: permission micro, création `RTCPeerConnection`, ajout de la piste, liaison à un tag audio de sortie.
- Test: permissions accordées, pas d’erreurs console, flux local prêt.

6. Front: WebRTC ↔ OpenAI Realtime

- Objectif: échange SDP avec OpenAI via token éphémère; recevoir la voix TTS et la jouer.
- Test: dire “Bonjour” → l’agent répond à voix haute; bouton stop ferme la session.

7. Prompt système + outils (tools) côté modèle

- Objectif: définir instructions (FR, rôle produit Callway, collecte consentie), déclarer les tools JSON Schema: `save_lead({first_name,last_name,phone_e164})`, `trigger_call({lead_id, summary})`.
- Test: l’agent propose le rappel et tente d’appeler `save_lead` quand l’utilisateur accepte.

8. Backend: `POST /api/tools/save_lead`

- Objectif: valider/normaliser E.164, insérer dans Supabase avec `service_role`, renvoyer `{lead_id}`.
- Test: cURL/Postman → 200 + `{lead_id}`; ligne présente en base.

9. Plomberie tools (front ↔ serveur ↔ modèle)

- Objectif: écouter les `tool_call` via data channel; POST au backend; renvoyer `tool.output` au modèle.
- Test: conversation web → l’agent collecte données → insertion réelle en DB → confirmation côté utilisateur.

10. Backend: `POST /api/tools/trigger_call`

- Objectif: appeler Telnyx `/v2/calls` (from/to E.164, connection/app, AMD premium), stocker `{lead_id: summary}` en mémoire/kv.
- Test: cURL/Postman → 200 + `{call_id}`; le téléphone sonne (en env réel).

11. Webhook Telnyx + signature

- Objectif: `POST /api/telnyx/webhooks` (signature vérifiée) gérant `call.initiated/answered/hangup`.
- Test: logs propres pour chaque event; 2xx; rejets si signature invalide.

12. Bridge Telnyx ↔ OpenAI Realtime (serveur)

- Objectif: sur `call.answered`, `streaming_start` vers un WS serveur; créer une session OpenAI Realtime (WS) avec system prompt incluant le `summary`; transcodage audio (Telnyx 8 kHz ↔ PCM16 16 kHz).
- Test: à la prise d’appel, l’IA parle et comprend en temps réel par le téléphone.

13. Handoff complet + clôture session web

- Objectif: côté web, après `trigger_call`, l’agent annonce le rappel et ferme proprement la session Realtime; le bridge téléphone reprend la conversation avec le résumé.
- Test: l’utilisateur quitte la session web, reçoit l’appel et retrouve le contexte.

14. Robustesse, sécurité, RGPD

- Objectif: gestion d’erreurs (retries limités, timeouts), CORS restrictif, pas de clés en front, consentement explicite, journaux minimaux (lead_id/call_id/timestamps), EU residency si requis.
- Test: scénarios d’échec (micro refusé, token expiré, Telnyx indispo) gérés sans crash; webhooks non signés rejetés.

15. DX et scripts

- Objectif: scripts `dev:server`/`start:server`, `dev:css` (existant), `.env.example`, `README.md` (setup clés, ngrok pour webhooks).
- Test: onboarding “from scratch” OK: installer deps → remplir `.env` → lancer front+server → test manuel end‑to‑end.

## 5) Rappels Sécurité (à respecter partout)

- Token OpenAI éphémère uniquement en front. Aucune clé longue OpenAI/Telnyx/Supabase côté navigateur.
- Validation stricte E.164 (front et serveur) avant insertion/appel.
- Webhooks Telnyx signés et vérifiés; réponses 2xx rapides.
- RLS active côté Supabase; usage de la Service Role Key strictement côté serveur.
