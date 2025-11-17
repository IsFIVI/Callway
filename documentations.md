# 1) OpenAI Realtime (speech-to-speech)

## A. Connexion & modèles

- **Deux modes**:

  - **WebRTC (recommandé pour navigateur)** : latence plus basse, audio bidirectionnel natif, data channel pour events/outils. Auth via **token éphémère** généré par ton serveur (valide ~1 min) puis échange SDP pour établir la session. ([platform.openai.com][1])
  - **WebSocket (serveur ↔ serveur)** : utile pour **pont Twilio ↔ OpenAI** pendant l’appel téléphonique (ton bridge Node en backend). ([newapi.ai][2])

- **Modèle**: `gpt-realtime` (dernière génération speech-in/speech-out, bon pour tool calling et voix naturelles). ([platform.openai.com][3])

## B. Session & paramètres importants

- **Token éphémère**: ton backend appelle l’API “sessions” pour créer un **clé courte durée**, renvoyée au navigateur; le client l’utilise pour la connexion WebRTC. **Ne jamais exposer ta clé API standard en front**. ([Microsoft Learn][4])
- **Turn detection / VAD (détection de prise de parole) & barge-in**

  - **Activé par défaut** via VAD serveur (**server_vad**).
  - **Semantic VAD** (si proposé sur ton déploiement) améliore l’endpointing (moins de coupes mid-sentence).
  - Le **barge-in** permet d’interrompre l’audio de l’agent dès que l’utilisateur parle; côté client on peut aussi envoyer `response.cancel`/équivalent si on gère manuellement. Paramètres typiques : **silence_duration**, **threshold**, **prefix_padding** (ajustent quand on “commit” l’input). ([platform.openai.com][5])

- **Audio I/O (formats)**

  - **Entrée**: envoyer des chunks **G.711 μ-law (g711_ulaw)** ou PCM16 selon le `input_audio_format` choisi. L’API impose **≥ 100 ms d’audio** avant chaque `input_audio_buffer.commit` (μ-law → env. **800 octets**). Variables utiles : `REALTIME_MIN_COMMIT_MS` (défaut 120 ms), `REALTIME_MAX_COMMIT_MS` (garde-fou 800 ms) et option `REALTIME_USE_SERVER_VAD=1` pour laisser le VAD serveur fermer les tours. ([docs.rs][1])
  - **Sortie**: lire les **`response.audio.delta`** (ou `response.output_audio.delta` selon les versions) qui contiennent l’audio encodé dans le format demandé (`output_audio_format`). ([community.openai.com][6])

- **Transcription côté session** (optionnel) : activer `input_audio_transcription` si tu veux des events de transcript pour logs/analytics. ([Microsoft Learn][7])

## C. Tools / Function calling (pour Supabase & Twilio)

- **Déclarer les “tools”** (fonctions) via **JSON Schema** ; ex:

  - `save_lead({first_name, last_name, phone})`

- L’agent **choisit** d’appeler la fonction; ton **backend exécute** puis renvoie le **résultat** au modèle pour qu’il continue la réponse (“tool → model → user”). ([platform.openai.com][8])

## D. Handoff / Continuité de contexte

- À la fin de la session web, **génère une synthèse courte** (but, infos validées, objections clés) et **passe-la en system prompt** de la **nouvelle session Realtime** côté appel téléphonique. C’est la méthode standard pour “reprendre là où on s’était arrêté”. ([platform.openai.com][9])

## E. RGPD / UE (données & résidences)

- **Data residency EU** disponible pour les clients éligibles : traitement et stockage en Europe.
- **Zero-Data Retention (ZDR)** : possible via contrat/paramétrage spécifique (utile en santé/finance). ([techinasia.com][10])

---

# 2) Twilio (Programmable Voice + Media Streams) — appels sortants & bridge temps réel

## A. Ressources & prérequis

- Compte Twilio avec un numéro voice (ou Caller ID vérifié en mode trial).
- Identifiants API : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER_FROM`.
- Media Streams activé : besoin d'une URL `wss://.../api/twilio/media-stream` accessible publiquement (ngrok ou tunnel équivalent).
- Variables env clés : `TWILIO_STREAM_DOMAIN` (domaine sans protocole), `TWILIO_REQUIRE_VERIFIED_NUMBERS` (mode trial), `PUBLIC_APP_URL` (fallback), sans oublier `OPENAI_*` et Supabase.
- Console Twilio : autoriser le domaine ngrok si requis et vérifier les numéros destinataires si la contrainte est activée.

## B. Déclencher un appel sortant

- Via `client.calls.create({ from, to, twiml })`.
- Le TwiML embarque `<Connect><Stream url="wss://.../api/twilio/media-stream?lead_id=..." /></Connect>` pour démarrer directement le flux audio.
- `to` doit être au format E.164. En mode trial (`TWILIO_REQUIRE_VERIFIED_NUMBERS=1`), vérifier le numéro dans la console ou refuser l'appel côté backend.
- En production, désactiver la contrainte pour appeler les prospects librement.

## C. Media Streams ↔ OpenAI Realtime

- Twilio envoie des événements JSON :
  - `start` → contient `streamSid`, `callSid`, codec (G.711 μ-law 8 kHz).
  - `media` → payload base64 (20 ms). À relayer via `input_audio_buffer.append`.
  - `stop`, `mark`, `dtmf` éventuels.
- Réponse attendue : renvoyer les audios TTS via `{ "event": "media", "streamSid": "...", "media": { "payload": "..." } }`.
- Session OpenAI : WebSocket `wss://api.openai.com/v1/realtime?model=...`, `session.update` avec `input_audio_format/output_audio_format = g711_ulaw`, `turn_detection = server_vad`, transcription FR activée.
- `response.create` pour déclencher la salutation initiale (“Bonjour, c'est Callway…”).

## D. Webhooks & sécurité

- Pas d'obligation de webhook HTTP : on se base sur la durée de vie du WS. Optionnel : `statusCallback` Twilio pour journaliser `queued/ringing/completed`.
- Sécuriser `/api/twilio/media-stream` (HTTPS/WSS). Le paramètre `lead_id` permet de retrouver le contexte côté serveur (stockage en mémoire + Supabase). En production, ajouter un token signé si nécessaire.
- Tunnel dev : `ngrok http 3001` et reporter le domaine (sans https://) dans `TWILIO_STREAM_DOMAIN`.

## E. Latence & qualité

- Media Streams transportent du μ-law 8 kHz → conserver ce format entre Twilio et OpenAI pour éviter la conversion.
- S'assurer que `streamSid` est connu avant d'envoyer l'audio, sinon Twilio ignore les paquets.
- Journaliser `callSid`/`streamSid`/`lead_id` pour le support.
- Plan de test : lancer serveur+ngrok → `POST /api/tools/trigger_call` → Twilio appelle, la passerelle WS s'initialise, l'IA continue la conversation automatiquement.
# 3) Supabase (stockage leads + fonctions backend)

## A. Écriture des leads

- Côté **backend seulement** (API route / serverless) avec **Service Role Key** (jamais en front).
- **Insert** via `supabase.from('leads').insert({...}).select()` si tu veux l’ID en retour. **RLS** activée : règles restrictives; la **Service Role Key bypasse RLS** (donc backend only). ([Supabase][19])

## B. Edge Functions (optionnel)

- **Edge Functions** (Deno) pour encapsuler `save_lead` et/ou **appeler l’API Twilio** en toute sécurité. Elles peuvent `fetch()` des APIs externes (prévoir headers/Auth). ([Supabase][20])

## C. Lib téléphone (front)

- **Validation/normalisation E.164** avec **`libphonenumber-js`** avant d’envoyer au backend (stockage en **E.164** recommandé). ([npmjs.com][21])

---

# 4) Front web (navigateur) — audio & UX “naturelle”

## A. Capture micro & qualité

- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }})` **si dispo**. Ajuster avec `applyConstraints` selon support. ([developer.mozilla.org][22])
- Sur certaines stacks, forcer **mono** et viser **16 kHz** pour la compat téléphonie/Realtime. Vérifier `sampleRate` via `MediaTrackSettings`. ([developer.mozilla.org][23])

## B. WebRTC avec OpenAI Realtime

- Flow type:

  1. Click → **fetch** `/session` (ton backend) → récup **token éphémère**.
  2. Créer **RTCPeerConnection**, attacher la **piste micro**, ouvrir **data channel**.
  3. Échanger **SDP** avec endpoint Realtime.
  4. Jouer **l’audio en sortie** (les `response.audio.delta` sont gérés par le stack Realtime/peer).

- Tu peux aussi piloter le **barge-in** (ex. interrompre lecture si user recommence à parler). ([webrtcHacks][24])

---

# 5) Flux détaillés (étape par étape)

## (A) Session Web “démo” (site)

1. **User clique “Parler”** → récup token éphémère → **init WebRTC** vers `gpt-realtime`.
2. **System prompt**: rôle “conseiller produit Callway”, ton, objectifs, **outil `save_lead` & `trigger_call`** décrits en JSON Schema; règles de consentement & format du numéro (E.164). ([platform.openai.com][8])
3. **VAD/barge-in** activés → dialogues naturels (interruption fluide). ([platform.openai.com][5])
4. **Qualification**: l’agent propose le **rappel**; si OK, **collecte** {prénom, nom, tel} ; **valide** en reformulant.
5. **Function call** `save_lead` → backend → **insert Supabase** (retourne `lead_id`). ([Supabase][19])
6. **Function call** `trigger_call({lead_id, summary})` → backend → **Twilio `calls.create`** (TwiML avec `<Connect><Stream ...>`).
7. L’agent **prévient**: “Je lance le rappel maintenant” → **ferme la session web** proprement.

## (B) Session Téléphone (PSTN)

1. Twilio **compose** → le TwiML Connect Stream ouvre directement le **WebSocket** (`/api/twilio/media-stream?lead_id=...`). Pas de webhook requis.
2. Backend : à la connexion WS, **initialiser le bridge** Twilio ↔ OpenAI et injecter le résumé web dans le `session.update`. ([platform.openai.com][9])
3. **Bridge** :

   - **RX** (Twilio→OpenAI) : chaque `media.payload` (μ-law 8 kHz) → `input_audio_buffer.append`. On tamponne tant que la session OpenAI n’est pas prête.
   - **TX** (OpenAI→Twilio) : lire `response.audio.delta` / `response.output_audio.delta` → renvoyer `{event:'media', streamSid, media:{payload}}`.

4. **Barge-in** : Twilio coupe automatiquement l’audio sortant quand l’utilisateur parle; côté OpenAI la VAD (`server_vad`) gère l’interruption. ([latent.space][25])
5. Fin : Twilio envoie `stop`, on ferme la session Realtime, on journalise `callSid`/`streamSid` + lead_id.

---

# 6) Liste exhaustive des technos & “spécificités” à retenir

## OpenAI Realtime

- **API Realtime** (WebRTC en front, WebSocket en bridge serveur).
- **Modèle**: `gpt-realtime` (S2S, tools). ([platform.openai.com][3])
- **Token éphémère** via endpoint `/realtime/sessions` (server-side), validité courte; **ne jamais** exposer la clé longue. ([Microsoft Learn][4])
- **VAD/Turn detection**: `server_vad` (défaut) ou `semantic_vad` quand dispo; paramètres: **silence_duration**, **threshold**, **prefix_padding**; **barge-in** supporté (interruption). ([platform.openai.com][5])
- **Événements** clés: `input_audio_buffer.append/commit`, `response.created/delta/completed`, `response.audio.delta`, `response.cancel`. ([Skywork][26])
- **Function calling** (tools) via **JSON Schema**. ([platform.openai.com][8])
- **Audio**: PCM16 mono 16–24 kHz (entrée/sortie), base64 en deltas sur le data channel/WS. ([community.openai.com][6])
- **Contexte**: passer **résumé** de la session web en **system** de la session téléphone. ([platform.openai.com][9])

## Twilio Voice + Media Streams (rappel rapide)

- `client.calls.create` avec TwiML `<Connect><Stream ...>` vers `/api/twilio/media-stream`.
- Media Streams = JSON (`start`, `media`, `stop`, `mark`). Codec μ-law 8 kHz.
- `streamSid` obligatoire pour renvoyer l'audio (`event: "media"`).
- Option `TWILIO_REQUIRE_VERIFIED_NUMBERS` à activer en mode trial (sinon Twilio bloque l'appel).
- `statusCallback` optionnel si tu veux un webhook HTTP (`queued/ringing/completed`).
- Test conseillé : server + ngrok → `POST /api/tools/trigger_call` → Twilio sonne, le bridge connecte OpenAI Realtime.

## Supabase
## Supabase

- **JS client (backend)** pour `insert` + `.select()` (récup ID). **Service Role Key** uniquement **côté serveur**, jamais exposée; **RLS** activée en base. ([Supabase][19])
- **Edge Functions** (Deno) si tu veux encapsuler `save_lead`/`trigger_call` proche de la base. **fetch** externe OK. ([Supabase][20])
- **E.164**: **`libphonenumber-js`** pour normaliser/valider en front. ([npmjs.com][21])

## Front navigateur (audio)

- **getUserMedia** avec `echoCancellation`, `noiseSuppression`, `autoGainControl` si dispo; `sampleRate` vérifiable via `MediaTrackSettings`. ([developer.mozilla.org][22])
- **WebRTC** natif (RTCPeerConnection), data channel pour événements/outil. ([webrtcHacks][24])

---

-# 7) Checklist de livraison (opérationnelle)
-
- [ ] **Env**: variables pour OpenAI (clé server), Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER_FROM`, `TWILIO_STREAM_DOMAIN`, `TWILIO_REQUIRE_VERIFIED_NUMBERS`), Supabase (URL, Service Role Key).
- [ ] **Tables**: `leads(id, first_name, last_name, phone_e164, created_at, source)` + **RLS** (off pour service role, on pour `anon`). ([Supabase][29])
- [ ] **Backend routes**:

  - `POST /tools/save_lead` → insert Supabase → renvoie `{lead_id}`.
  - `POST /tools/trigger_call` → `client.calls.create` (Twilio) avec TwiML Connect Stream.
  - Endpoint WebSocket `/api/twilio/media-stream` accessible publiquement (pas de webhook HTTP requis).
  - `POST /session` → **token éphémère Realtime** (web).

- [ ] **Bridge serveur** (Node) : **Twilio Media Streams WS ⟷ OpenAI WS** (buffer μ-law, VAD, greeting).
- [ ] **Front**: bouton “Parler” → WebRTC Realtime; input mask tel + **E.164** avec `libphonenumber-js`. ([npmjs.com][21])
- [ ] **Contexte**: générer **résumé** fin session web → passer en **system** de la session téléphone. ([platform.openai.com][9])
- [ ] **Logs**: stocker **transcripts** (si activés), **lead_id**, **call_id**, **timestamps**.

---

# 8) Points d’attention / bonnes pratiques

- **Barge-in**: laisse **VAD serveur** gérer l’interruption; en cas de TTS en cours côté Realtime, envoie un **cancel** si tu fais un contrôle fin en client. ([latent.space][25])
- **Formats audio**: PSTN = 8 kHz; Twilio Media Streams émet déjà du μ-law 8 kHz → rester dans ce format côté Realtime (`g711_ulaw`) évite toute conversion inutile.
- **Latence EU**: héberger le serveur (bridge) proche de Twilio/du tunnel pour limiter la RTT (<200 ms visé). Utilise les régions EU d’OpenAI si nécessaire.
- **Sécurité**:

  - OpenAI **token éphémère** only en front. ([Microsoft Learn][4])
  - Supabase **service role** strictly serveur; RLS sur tables publiques. ([Supabase][31])
  - Restreindre l’accès à `/api/twilio/media-stream` aux domaines attendus (ngrok) et, en production, ajouter un token signé côté query si besoin.

- **Téléphone (E.164)**: normalise/valide **avant** d’insérer/avant d’appeler. ([npmjs.com][21])
- **function_call_output** : on renvoie la même `call_id` et on fournit `output` **stringifié** (JSON). ([Microsoft Learn][1])

- Après avoir injecté un `function_call_output`, on *doit* relancer l’inférence avec `response.create` (on peut y mettre une instruction pour que l’agent commente le résultat). ([Microsoft Learn][1])

- Structure côté client (WebRTC data channel ou WS) :
  ```json
  {
    "type": "conversation.item.create",
    "item": {
      "type": "function_call_output",
      "call_id": "<CALL_ID>",
      "output": "{\"lead_id\":\"123\",\"phone_e164\":\"+336...\"}"
    }
  }
  ```
  Puis :
  ```json
  {
    "type": "response.create",
    "response": {
      "instructions": "Confirme les informations à l'utilisateur."
    }
  }
  ```
