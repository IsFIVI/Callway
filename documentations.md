# 1) OpenAI Realtime (speech-to-speech)

## A. Connexion & modèles

- **Deux modes**:

  - **WebRTC (recommandé pour navigateur)** : latence plus basse, audio bidirectionnel natif, data channel pour events/outils. Auth via **token éphémère** généré par ton serveur (valide ~1 min) puis échange SDP pour établir la session. ([platform.openai.com][1])
  - **WebSocket (serveur ↔ serveur)** : utile pour **pont Telnyx ↔ OpenAI** pendant l’appel téléphonique (ton bridge Node en backend). ([newapi.ai][2])

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

## C. Tools / Function calling (pour Supabase & Telnyx)

- **Déclarer les “tools”** (fonctions) via **JSON Schema** ; ex:

  - `save_lead({first_name, last_name, phone})`

- L’agent **choisit** d’appeler la fonction; ton **backend exécute** puis renvoie le **résultat** au modèle pour qu’il continue la réponse (“tool → model → user”). ([platform.openai.com][8])

## D. Handoff / Continuité de contexte

- À la fin de la session web, **génère une synthèse courte** (but, infos validées, objections clés) et **passe-la en system prompt** de la **nouvelle session Realtime** côté appel téléphonique. C’est la méthode standard pour “reprendre là où on s’était arrêté”. ([platform.openai.com][9])

## E. RGPD / UE (données & résidences)

- **Data residency EU** disponible pour les clients éligibles : traitement et stockage en Europe.
- **Zero-Data Retention (ZDR)** : possible via contrat/paramétrage spécifique (utile en santé/finance). ([techinasia.com][10])

---

# 2) Telnyx (Programmable Voice API v2) — appels sortants & media streaming

## A. Ressources & prérequis

- **API v2** activée, **Auth v2**, et **Webhook API Version = v2** dans ton **Call Control Application**. Configure l’URL de webhook (ngrok en dev ok). ([preview.redoc.ly][11])
- **Numéro sortant** attaché à un **Outbound Voice Profile** + **Connection** (Call Control). ([developers.telnyx.com][12])
- Voice API **V2** commande tout via `https://api.telnyx.com/v2` et s’appuie sur un **`call_control_id`** pour piloter chaque jambe d’appel (answer, hangup, streaming_start, fork_start, speak, gather…). ([developers.telnyx.com][1])
- Côté portail: Créer l’application Voice API (Call Control), associer un numéro, configurer `Webhook URL` (publique) en version `V2`. Récupérer la **clé publique** des webhooks (`TELNYX_PUBLIC_KEY`), l’API key (`TELNYX_API_KEY`) et le `connection_id` (`TELNYX_CALL_CONTROL_APP_ID`).
- Variables env recommandées : `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` (signature ED25519), `TELNYX_CALL_CONTROL_APP_ID`, `TELNYX_OUTBOUND_CALLER_ID`, `TELNYX_WEBHOOK_URL`, `TELNYX_STREAM_URL` (si streaming start automatique). ([developers.telnyx.com][7])
  - `TELNYX_STREAM_URL` peut être soit une URL complète (`wss://…/api/telnyx/stream`) sur laquelle on ajoute automatiquement `?call_control_id=...`, soit un template contenant `{call_control_id}` (ex. `wss://.../stream/{call_control_id}`). Si absent, on retombe sur `PUBLIC_APP_URL + /api/telnyx/stream`.
# ⚠️ Dev : tunnel sur le bon port (ngrok http 3001) et routage correct `/api/telnyx/webhooks`. Sinon Telnyx reçoit 502 (ERR_NGROK_8012) → `localhost:3001` est indispensable.

## B. Démarrer un appel sortant (backend)

- **Endpoint**: `POST /v2/calls` avec `from`, `to` (E.164), et l’**identifiant de connection/app**. Les webhooks clés : `call.initiated`, `call.answered` (ou `call.hangup`).
- **Answering Machine Detection (AMD)** : `answering_machine_detection` = `premium` recommandé, avec événements `call.machine.premium.*` pour savoir si c’est une messagerie. ([developers.telnyx.com][13])

## C. Media vers ton IA (pont audio bi-directionnel)

Deux options éprouvées :

1. **Media Streaming WebSocket**

   - **`/v2/calls/{call_control_id}/actions/streaming_start`** → Telnyx pousse **base64 RTP payloads** sur **ton** WebSocket.
   - Tu écris un **“bridge” Node** qui **décode les frames** Telnyx et **alimente OpenAI Realtime (WebSocket)** via `input_audio_buffer.append`; en sens inverse, tu **construis des frames** et les renvoies à Telnyx pour lecture en temps réel. ([developers.telnyx.com][14])

2. **Forking (fork_start)**

   - Permet de **dupliquer** l’audio vers une cible (ex. ton WS). Moins courant si tu veux **duplex** complet, mais utile pour analytics/ASR en parallèle. ([developers.telnyx.com][15])

> Note: Telnyx documente aussi une **liste complète de commandes v2** (answer, playback, speak, gather_using_ai, streaming_start/stop, fork_start/stop, transfer, record, etc.). Tu en auras besoin pour stopper/start la diffusion, raccrocher, jouer un prompt si nécessaire, etc. ([developers.telnyx.com][16])

## D. Webhooks & IDs importants

- Tu recevras des **events** signés (vérifier la signature) : `call.initiated`, `call.answered`, `streaming.started/failed`, `call.machine.*`, `call.hangup`…
- Toutes les actions **référencent `call_control_id`** (l’identifiant/jeton pour piloter **la** jambe d’appel). ([developers.telnyx.com][17])
- Signature V2 : `Telnyx-Signature-Ed25519` et `Telnyx-Timestamp`. La chaîne à vérifier est `"<timestamp>|<payload brut>"` ; utilise `TELNYX_PUBLIC_KEY` (base64 32 octets) + `tweetnacl` ou équivalent pour valider. Réponse rapide 2xx (<10s) sinon Telnyx retente. ([developers.telnyx.com][7], [support.telnyx.com][3])
  - **Headers exacts** : `telnyx-signature-ed25519` + `telnyx-timestamp` (tout en minuscules côté Node). Prévoyez un fallback si un proxy renomme en `webhook-signature` / `webhook-timestamp`.

## E. Latence & PoPs UE

- **PoP GPU Telnyx à Paris** et infra EU → **<200 ms round-trip** visé, très bon pour agents IA vocaux en Europe (moins de “robot voice”). ([Telnyx][18])

---

# 3) Supabase (stockage leads + fonctions backend)

## A. Écriture des leads

- Côté **backend seulement** (API route / serverless) avec **Service Role Key** (jamais en front).
- **Insert** via `supabase.from('leads').insert({...}).select()` si tu veux l’ID en retour. **RLS** activée : règles restrictives; la **Service Role Key bypasse RLS** (donc backend only). ([Supabase][19])

## B. Edge Functions (optionnel)

- **Edge Functions** (Deno) pour encapsuler `save_lead` et/ou **appeler l’API Telnyx** en toute sécurité. Elles peuvent `fetch()` des APIs externes (prévoir headers/Auth). ([Supabase][20])

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
6. **Function call** `trigger_telnyx_call({lead_id})` → backend → **POST Telnyx /v2/calls** (AMD premium). ([developers.telnyx.com][13])
7. L’agent **prévient**: “Je lance le rappel maintenant” → **ferme la session web** proprement.

## (B) Session Téléphone (PSTN)

1. Telnyx **compose** → **webhook** `call.answered`.
2. Backend: **start streaming** (`streaming_start`) vers ton **bridge** WS. ([developers.telnyx.com][14])
3. **Crée une nouvelle session OpenAI Realtime (WebSocket)** côté serveur (bridge) avec **system prompt “résumé de la démo web”**. ([platform.openai.com][9])
4. **Bridge**:

   - **RX** (Telnyx→OpenAI): convertir payload **RTP base64 → PCM16** (taux ciblé 16 kHz ou transcode si 8 kHz) → `input_audio_buffer.append` + `commit`.
   - **TX** (OpenAI→Telnyx): lire **`response.audio.delta`** → empaqueter en frames WS Telnyx → renvoyer vers l’appelant. ([developers.telnyx.com][14])

5. **Barge-in** : si Telnyx détecte voix pendant playback, tu continues d’alimenter RX; côté OpenAI la VAD interrompt la génération courante. ([latent.space][25])
6. Fin : **stop streaming**, éventuellement **record/stocke** les métadonnées (journal, consentements).

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

## Telnyx Voice API v2

- **Call Control Application** (Webhook API v2, URL webhook, Auth v2). ([preview.redoc.ly][11])
- **Outbound Voice Profile** + **numéro** prêt à émettre. ([developers.telnyx.com][12])
- **Appels sortants**: `POST /v2/calls` (from/to E.164, connection_id/app_id). ([developers.telnyx.com][16])
- **AMD**: `answering_machine_detection = premium`, webhooks `call.machine.premium.*`. ([developers.telnyx.com][27])
- **Media streaming**: `.../actions/streaming_start` (WS bi-directionnel), frames **RTP base64**; alternative **fork_start**. ([developers.telnyx.com][14])
- **Commandes v2** utiles**:** `answer`, `playback_start/stop`, `speak`, `gather_*`, `streaming_start/stop`, `fork_*`, `hangup`, `transfer`. ([developers.telnyx.com][16])
- **IDs**: piloter via **`call_control_id`**; traite les **webhooks** (`call.initiated`, `call.answered`, `streaming.*`, `call.hangup`, …). ([developers.telnyx.com][28])
- **Latence EU**: PoP GPU Paris, **<200 ms** RTT visé pour agents IA (UX naturelle). ([Telnyx][18])

## Supabase

- **JS client (backend)** pour `insert` + `.select()` (récup ID). **Service Role Key** uniquement **côté serveur**, jamais exposée; **RLS** activée en base. ([Supabase][19])
- **Edge Functions** (Deno) si tu veux encapsuler `save_lead`/`trigger_call` proche de la base. **fetch** externe OK. ([Supabase][20])
- **E.164**: **`libphonenumber-js`** pour normaliser/valider en front. ([npmjs.com][21])

## Front navigateur (audio)

- **getUserMedia** avec `echoCancellation`, `noiseSuppression`, `autoGainControl` si dispo; `sampleRate` vérifiable via `MediaTrackSettings`. ([developer.mozilla.org][22])
- **WebRTC** natif (RTCPeerConnection), data channel pour événements/outil. ([webrtcHacks][24])

---

# 7) Checklist de livraison (opérationnelle)

- [ ] **Env**: variables pour OpenAI (clé server), Telnyx (API key v2, connection/app IDs), Supabase (URL, Service Role Key).
- [ ] **Tables**: `leads(id, first_name, last_name, phone_e164, created_at, source)` + **RLS** (off pour service role, on pour `anon`). ([Supabase][29])
- [ ] **Backend routes**:

  - `POST /tools/save_lead` → insert Supabase → renvoie `{lead_id}`.
  - `POST /tools/trigger_call` → `POST /v2/calls` (Telnyx).
  - `POST /telnyx/webhooks` → gère `call.answered` → `streaming_start` vers **bridge**.
  - `POST /session` → **token éphémère Realtime** (web).

- [ ] **Bridge serveur** (Node) : **Telnyx WS ⟷ OpenAI WS** (dé/encodage audio, gestion barge-in côté modèle). ([developers.telnyx.com][14])
- [ ] **Front**: bouton “Parler” → WebRTC Realtime; input mask tel + **E.164** avec `libphonenumber-js`. ([npmjs.com][21])
- [ ] **Contexte**: générer **résumé** fin session web → passer en **system** de la session téléphone. ([platform.openai.com][9])
- [ ] **AMD premium** activé pour réduire faux positifs messagerie. ([developers.telnyx.com][30])
- [ ] **Logs**: stocker **transcripts** (si activés), **lead_id**, **call_id**, **timestamps**.

---

# 8) Points d’attention / bonnes pratiques

- **Barge-in**: laisse **VAD serveur** gérer l’interruption; en cas de TTS en cours côté Realtime, envoie un **cancel** si tu fais un contrôle fin en client. ([latent.space][25])
- **Formats audio**: PSTN = 8 kHz souvent; si Telnyx WS envoie 8 kHz μ-law/PCM, **transcode** proprement vers le **taux attendu** par ta session Realtime (souvent **PCM16 mono 16–24 kHz**). ([developers.telnyx.com][14])
- **Latence EU**: choisis **endpoints/PoPs** EU (OpenAI data residency si requis, Telnyx Paris GPU PoP). ([Telnyx][18])
- **Sécurité**:

  - OpenAI **token éphémère** only en front. ([Microsoft Learn][4])
  - Supabase **service role** strictly serveur; RLS sur tables publiques. ([Supabase][31])
  - **Signer/vérifier** les webhooks Telnyx. (Bonne pratique standard de l’API v2). ([developers.telnyx.com][28])

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
