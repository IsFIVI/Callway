Plan d'implémentation fonction par fonction à suivre pour reconstruire la feature callback telnyx.

---

## 1. `handleCreateCallbackRequest(req, res)`

### Rôle

Handler HTTP appelé par la landing page lorsque l’utilisateur valide son numéro et que tu veux lancer le rappel Telnyx.

### Blocs de code à écrire

1. **Extraction & validation des données**

   * Lire `req.body` : `{ firstName, lastName, phoneNumber, landingSessionId, summary, ... }`.
   * Vérifier que `phoneNumber` est en **E.164** (`+33...`).
   * (Optionnel) Valider qu’un résumé / contexte est présent si tu veux le réinjecter côté OpenAI.

2. **Création d’un “call session” applicatif**

   * Appeler une fonction type `createCallSession({ phoneNumber, landingSessionId, summary })`.
   * Cette fonction retourne un objet `session` avec :

     * `sessionId`
     * `callControlId: null` (pour l’instant)
     * `mediaToken` à générer plus tard ou immédiatement.
   * Stocker la session en mémoire (Map) ou en DB si tu veux persister.

3. **Appel Telnyx pour lancer l’appel sortant**

   * Appeler `startTelnyxOutboundCall({ to: phoneNumber, session })`.
   * Récupérer `callControlId` renvoyé par Telnyx.
   * Mettre à jour la session (`session.callControlId = callControlId`).

4. **Réponse HTTP**

   * Retourner un JSON : `{ success: true, sessionId, callControlId }`.
   * Gérer les erreurs : en cas d’erreur Telnyx, renvoyer HTTP 500 avec un message clair.

### Logs à ajouter

* Au tout début :

  ```js
  console.log('[CALLBACK_API] /callback request received', {
    body: req.body,
    requestId: req.id,
  });
  ```
* Après validation :

  ```js
  console.log('[CALLBACK_API] Validated callback payload', {
    phoneNumber,
    landingSessionId,
  });
  ```
* Après création de session :

  ```js
  console.log('[CALLBACK_API] Created call session', {
    sessionId: session.sessionId,
    phoneNumber: session.phoneNumber,
  });
  ```
* Après appel Telnyx :

  ```js
  console.log('[CALLBACK_API] Telnyx call initiated', {
    sessionId: session.sessionId,
    callControlId,
  });
  ```
* En cas d’erreur Telnyx :

  ```js
  console.error('[CALLBACK_API] Failed to initiate Telnyx call', {
    sessionId: session?.sessionId,
    error: error.message,
    stack: error.stack,
  });
  ```

### Références doc

* **Section 6** – “Exemple d’appel API Telnyx pour lancer un appel sortant avec Media Streams”.
* **Section 14** – Étape “1. Utilisateur clique 'Rappelez-moi' → Backend initie l’appel via Telnyx”.

---

## 2. `startTelnyxOutboundCall({ to, session })`

### Rôle

Encapsuler l’appel HTTP REST `POST https://api.telnyx.com/v2/calls` en utilisant l’**application Telnyx** (connection_id) + `stream_url` du WS média.

### Blocs de code à écrire

1. **Préparer le `stream_url` sécurisé**

   * Appeler `generateMediaStreamToken(session)` pour créer un token unique.
   * Construire :
     `const streamUrl = \`wss://your-domain.com/media-stream?token=${token}`;`
   * Stocker ce token dans la session : `session.mediaToken = token`.

2. **Construire le payload Telnyx**

   * `connection_id`: ton ID d’application Voice API.
   * `to`: numéro du client.
   * `from`: ton numéro Telnyx.
   * `stream_url`: l’URL WS ci-dessus.
   * `stream_track`: `"inbound_track"`.
   * `stream_bidirectional_mode`: `"rtp"`.
   * `stream_bidirectional_codec`: `"PCMU"` (μ-law).
   * Optionnel : paramètres supplémentaires (timeout, etc.).

3. **Appeler Telnyx**

   * Utiliser `axios.post('https://api.telnyx.com/v2/calls', payload, { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` }})`.
   * Récupérer `call_control_id` depuis `res.data.data.call_control_id`.

4. **Mettre à jour la session**

   * `session.callControlId = callControlId`.

5. **Retourner le `callControlId`**

   * `return callControlId;`

### Logs à ajouter

* Avant l’appel :

  ```js
  console.log('[TELNYX_API] Initiating outbound call', {
    sessionId: session.sessionId,
    to,
    from: TELNYX_NUMBER,
    streamUrl,
  });
  ```
* Après la réponse Telnyx :

  ```js
  console.log('[TELNYX_API] Outbound call created', {
    sessionId: session.sessionId,
    callControlId,
    telnyxResponse: res.data,
  });
  ```
* En cas d’erreur :

  ```js
  console.error('[TELNYX_API] Error creating outbound call', {
    sessionId: session.sessionId,
    to,
    error: error.response?.data || error.message,
  });
  ```

### Références doc

* **Section 6** – Payload `connection_id`, `to`, `from`, `stream_url`, `stream_track`, `stream_bidirectional_mode`, `stream_bidirectional_codec`.
* **Section 10** – Sécurité du `stream_url` avec token (auth simple côté WS).
* **Section 2** – Nécessité d’un Outbound Voice Profile lié à l’app.

---

## 3. `handleTelnyxWebhook(req, res)`

### Rôle

Endpoint HTTP pour recevoir **tous les webhooks Telnyx** (`call.initiated`, `call.answered`, `streaming.started`, `call.hangup`, etc.) et dispatch vers les bons handlers.

### Blocs de code à écrire

1. **Vérification de la signature Telnyx**

   * Récupérer en-têtes : `Telnyx-Signature-Ed25519`, `Telnyx-Timestamp`.
   * Utiliser une func utilitaire `verifyTelnyxSignature(rawBody, timestamp, signature)` (avec SDK ou lib crypto).
   * Si la signature n’est pas valide → `console.warn` + `res.status(400).send('Invalid signature');` et `return`.

2. **Parsing de l’événement**

   * `const event = req.body.data;`
   * `const eventType = event.event_type;`
   * `const payload = event.payload;`
   * `const callControlId = payload.call_control_id;`

3. **Routing par type d’événement**

   * `switch (eventType)`:

     * `"call.initiated"` → `onCallInitiated(payload)`.
     * `"call.answered"` → `onCallAnswered(payload)`.
     * `"streaming.started"` → `onStreamingStarted(payload)`.
     * `"streaming.stopped"` → `onStreamingStopped(payload)`.
     * `"call.hangup"` → `onCallHangup(payload)`.
     * autres → log + ignore.

4. **Réponse rapide**

   * Toujours répondre `res.sendStatus(200);` après traitement pour éviter les timeouts côté Telnyx.

### Logs à ajouter

* Entrée :

  ```js
  console.log('[TELNYX_WEBHOOK] Incoming webhook', {
    eventType,
    callControlId,
    rawBody: req.body,
  });
  ```
* Si signature invalide :

  ```js
  console.warn('[TELNYX_WEBHOOK] Invalid webhook signature', {
    eventType,
    callControlId,
  });
  ```
* Après dispatch :

  ```js
  console.log('[TELNYX_WEBHOOK] Dispatched event to handler', {
    eventType,
    callControlId,
  });
  ```

### Références doc

* **Section 7** – Webhooks `call.initiated`, `call.answered`, `streaming.started`, `streaming.stopped`, `call.hangup`.
* **Section 10** – Vérification de la signature Telnyx v2 (`Telnyx-Signature-Ed25519`).

---

## 4. `onCallInitiated(payload)`

### Rôle

Mettre à jour/annoter la session quand Telnyx signale que l’appel est initié.

### Blocs de code à écrire

1. **Récupérer la session associée**

   * `const callControlId = payload.call_control_id;`
   * `const session = getSessionByCallControlId(callControlId);`

2. **Mettre à jour les infos**

   * `session.callStatus = 'initiated';`
   * Stocker éventuellement `payload.to`, `payload.from`, timestamp, etc. pour debug.

3. **(Optionnel) Log applicatif / métriques**

### Logs

```js
console.log('[TELNYX_WEBHOOK] call.initiated', {
  callControlId,
  sessionId: session?.sessionId,
  direction: payload.direction,
  to: payload.to,
  from: payload.from,
});
```

### Références doc

* **Section 7** – Description de `call.initiated`.

---

## 5. `onCallAnswered(payload)`

### Rôle

Quand l’utilisateur décroche, démarrer la **connexion OpenAI** pour cette session.

### Blocs de code à écrire

1. **Récupérer la session**

   * `const callControlId = payload.call_control_id;`
   * `const session = getSessionByCallControlId(callControlId);`

2. **Mettre à jour l’état**

   * `session.callStatus = 'answered';`
   * `session.answeredAt = payload.start_time || new Date().toISOString();`

3. **Ouvrir la connexion WS OpenAI**

   * Appeler `createOpenAISession(session);`
   * Cette fonction ouvre un WS, envoie `session.update`, et rattache le socket à la session (voir plus bas).

### Logs

```js
console.log('[TELNYX_WEBHOOK] call.answered', {
  callControlId,
  sessionId: session?.sessionId,
  startTime: payload.start_time,
});
```

En cas de session introuvable :

```js
console.error('[TELNYX_WEBHOOK] call.answered but no session found', {
  callControlId,
});
```

### Références doc

* **Section 7** – Événement `call.answered`.
* **Section 9** / **14** – Etape “call.answered → backend ouvre WS OpenAI”.

---

## 6. `onStreamingStarted(payload)`

### Rôle

Confirmer que Telnyx a bien relié l’appel au **WebSocket media** de ton serveur.

### Blocs de code à écrire

1. **Récupérer session**

   * `const callControlId = payload.call_control_id;`
   * `const session = getSessionByCallControlId(callControlId);`

2. **Mettre à jour l’état**

   * `session.streamingStatus = 'started';`
   * `session.streamUrlConfirmed = payload.stream_url;`

3. **(Optionnel)** Déclencher une logique si tu veux t’assurer qu’OpenAI WS est aussi prêt.

### Logs

```js
console.log('[TELNYX_WEBHOOK] streaming.started', {
  callControlId,
  sessionId: session?.sessionId,
  streamUrl: payload.stream_url,
});
```

### Références doc

* **Section 7** – Événement `streaming.started`.

---

## 7. `onStreamingStopped(payload)`

### Rôle

Savoir que Telnyx a arrêté le streaming, préparer le cleanup.

### Blocs

1. Récupérer session via `callControlId`.
2. `session.streamingStatus = 'stopped';`
3. (Option) marquer pour cleanup, mais la vraie fin sera `call.hangup`.

### Logs

```js
console.log('[TELNYX_WEBHOOK] streaming.stopped', {
  callControlId,
  sessionId: session?.sessionId,
});
```

### Références doc

* **Section 7** – `streaming.stopped`.

---

## 8. `onCallHangup(payload)`

### Rôle

Fin de vie de l’appel : fermer WS Telnyx, WS OpenAI, et nettoyer la session.

### Blocs de code

1. **Récupérer la session**

   * `const callControlId = payload.call_control_id;`
   * `const session = getSessionByCallControlId(callControlId);`

2. **Mettre à jour état**

   * `session.callStatus = 'hangup';`
   * `session.hangupCause = payload.hangup_cause;`
   * `session.hangupSource = payload.hangup_source;`

3. **Fermer WS**

   * Si `session.telnyxWs` ouvert → `session.telnyxWs.close();`
   * Si `session.openAiWs` ouvert → `session.openAiWs.close();`

4. **Nettoyer**

   * Appeler `cleanupCallSession(callControlId);`

### Logs

```js
console.log('[TELNYX_WEBHOOK] call.hangup', {
  callControlId,
  sessionId: session?.sessionId,
  hangupCause: payload.hangup_cause,
  hangupSource: payload.hangup_source,
});
```

Et dans `cleanupCallSession` (voir plus bas), un log de type :

```js
console.log('[SESSION] Cleanup call session', {
  callControlId,
  sessionId: session?.sessionId,
});
```

### Références doc

* **Section 7** – `call.hangup` + raisons.
* **Section 9 / 14** – Fin d’appel et cleanup.

---

## 9. `initTelnyxMediaWebSocketServer(httpServer)`

### Rôle

Attacher un **WebSocket.Server** (lib `ws`) sur le serveur HTTPS pour le **flux média Telnyx**.

### Blocs

1. **Création du serveur WS**

   * `const wssTelnyx = new WebSocket.Server({ server: httpServer, path: '/media-stream' });`
   * Stocker `wssTelnyx` pour debug.

2. **Gestion des connexions**

   * `wssTelnyx.on('connection', (ws, req) => handleTelnyxMediaConnection(ws, req));`

3. **Gestion des erreurs globales**

   * `wssTelnyx.on('error', (err) => console.error('[TELNYX_WS] Server error', err));`

### Logs

* À l’initialisation :

  ```js
  console.log('[TELNYX_WS] Media WebSocket server initialized at path /media-stream');
  ```
* Dans le handler `connection` (délégué à la fonction suivante) tu auras des logs plus fins.

### Références doc

* **Section 6** – `stream_url` pointant vers ton WS.
* **Section 7** – Événements WS `connected`, `start`, `media`, `stop`.
* **Section 9 / 14** – “Telnyx ouvre une connexion WebSocket vers stream_url”.

---

## 10. `handleTelnyxMediaConnection(ws, req)`

### Rôle

Gérer **une connexion WS Telnyx** (un appel) : authentifier par token, lier la socket à la session, et écouter les messages.

### Blocs de code

1. **Extraire et valider le token**

   * `const params = new URLSearchParams(req.url.split('?')[1]);`
   * `const token = params.get('token');`
   * `const session = getSessionByMediaToken(token);`
   * Si token invalide ou session absente → log + `ws.close(); return;`.

2. **Attacher la socket à la session**

   * `session.telnyxWs = ws;`
   * Ajouter un mapping inverse : `telnyxWsToSession.set(ws, session);`

3. **Écouter les messages**

   * `ws.on('message', (raw) => handleTelnyxMediaMessage(ws, raw));`

4. **Écouter la fermeture**

   * `ws.on('close', (code, reason) => { ... });`
   * Marquer `session.telnyxWs = null` et éventuellement déclencher cleanup si `callStatus` déjà `hangup`.

5. **Gérer erreurs**

   * `ws.on('error', (err) => { ... });`

### Logs

* À la connexion :

  ```js
  console.log('[TELNYX_WS] Connection opened', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    ip: req.socket.remoteAddress,
  });
  ```
* Token invalide :

  ```js
  console.warn('[TELNYX_WS] Invalid media token, closing connection', {
    token,
    ip: req.socket.remoteAddress,
  });
  ```
* À la fermeture :

  ```js
  console.log('[TELNYX_WS] Connection closed', {
    sessionId: session?.sessionId,
    callControlId: session?.callControlId,
    code,
    reason: reason?.toString(),
  });
  ```

### Références doc

* **Section 10** – Sécurisation du WebSocket Telnyx via token et éventuellement par IP.
* **Section 7** – `connected` event envoyé juste après l’ouverture.

---

## 11. `handleTelnyxMediaMessage(ws, rawMessage)`

### Rôle

Parser chaque message JSON venant de Telnyx (`connected`, `start`, `media`, `stop`, `error`) et router.

### Blocs de code

1. **Récupérer la session**

   * `const session = telnyxWsToSession.get(ws);`
   * Si aucune session → log + return.

2. **Parsing JSON**

   * `let msg; try { msg = JSON.parse(rawMessage); } catch (e) { ... }`
   * Si parse échoue → log + éventuellement fermer la socket (en accord avec doc Telnyx).

3. **Switch par `msg.event`**

   * `"connected"` → log soft.
   * `"start"` → stocker `msg.start.media_format` dans `session.mediaFormatTelnyx = msg.start.media_format;`
   * `"media"` → si `msg.media.payload` && `msg.media.track === 'inbound'` →
     `const audioBuf = Buffer.from(msg.media.payload, 'base64');`
     `handleInboundAudioFromTelnyx(session, audioBuf);`
   * `"stop"` → log + éventuellement marquer `session.telnyxStreamStopped = true;`
   * `"error"` → log détaillé.

### Logs

* Parse:

  ```js
  console.log('[TELNYX_WS] Message received', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    event: msg.event,
  });
  ```

* Erreur JSON :

  ```js
  console.error('[TELNYX_WS] Failed to parse Telnyx WS message', {
    sessionId: session?.sessionId,
    rawMessage: rawMessage.toString(),
    error: e.message,
  });
  ```

* Pour `start` :

  ```js
  console.log('[TELNYX_WS] Media stream started', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    mediaFormat: msg.start.media_format,
  });
  ```

* Pour `error` :

  ```js
  console.error('[TELNYX_WS] Telnyx media error', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    code: msg.error?.code,
    message: msg.error?.message,
  });
  ```

### Références doc

* **Section 7** – Structure des messages `start`, `media`, `stop`, `error`.
* **Section 3** – `media_format.encoding`, `sample_rate`, `channels`.

---

## 12. `createOpenAISession(session)`

### Rôle

Ouvrir la **connexion WebSocket client vers OpenAI**, envoyer la config `session.update` avec `g711_ulaw`, et brancher les handlers.

### Blocs de code

1. **Construire l’URL WS**

   * `const url = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';`

2. **Créer la connexion WS**

   * `const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' } });`
   * Stocker :

     * `session.openAiWs = ws;`
     * `openAiWsToSession.set(ws, session);`

3. **On open**

   * Envoyer `session.update` :

     ```js
     const config = {
       type: 'session.update',
       session: {
         input_audio_format: 'g711_ulaw',
         output_audio_format: 'g711_ulaw',
         input_audio_transcription: { model: 'whisper-1' },
         turn_detection: { type: 'server_vad' },
         instructions: buildSystemPromptFromSession(session), // optionnel
         voice: 'alloy', // ou autre
       },
     };
     ws.send(JSON.stringify(config));
     ```

4. **On message**

   * `ws.on('message', (msg) => handleOpenAIMessage(ws, msg));`

5. **On close / error**

   * `ws.on('close', ...)` → log + éventuellement cleanup si Telnyx aussi fermé.
   * `ws.on('error', ...)` → log + éventuellement raccrocher côté Telnyx.

### Logs

* À la création :

  ```js
  console.log('[OPENAI_WS] Creating OpenAI realtime connection', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
  });
  ```
* On open :

  ```js
  console.log('[OPENAI_WS] Connection opened, sending session.update', {
    sessionId: session.sessionId,
    audioFormat: { input: 'g711_ulaw', output: 'g711_ulaw' },
  });
  ```
* On close :

  ```js
  console.log('[OPENAI_WS] Connection closed', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    code,
    reason: reason?.toString(),
  });
  ```
* On error :

  ```js
  console.error('[OPENAI_WS] Error', {
    sessionId: session.sessionId,
    error: err.message,
  });
  ```

### Références doc

* **Section 8** – Messages `session.update` et formats audio.
* **Section 5 (Option A)** – `input_audio_format: "g711_ulaw"`, `output_audio_format: "g711_ulaw"`.
* **Section 9** – Ouverture WS OpenAI après `call.answered`.

---

## 13. `handleOpenAIMessage(ws, msg)`

### Rôle

Gérer les messages de l’API Realtime : JSON texte (événements) ou binaire (audio direct).

### Blocs de code

1. **Récupérer la session**

   * `const session = openAiWsToSession.get(ws);`

2. **Différencier texte / binaire**

   * Si `Buffer.isBuffer(msg)` → audio brut → `handleOutboundAudioFromOpenAI(session, msg);`
   * Sinon → string JSON → `const data = JSON.parse(msg);`

3. **Switch sur `data.type`**

   * `response.audio.delta` :

     * extraire audio (array Int16 ou base64).
     * convertir en `Buffer`.
     * `handleOutboundAudioFromOpenAI(session, audioBuf);`
   * `response.audio_transcript.delta` / `.done` :

     * log partiel / final, stocker dans la session si tu veux.
   * `response.output_item.done` :

     * marquer `session.currentTurnCompleted = true;`
   * Autres → log debug.

4. **Try/catch**

   * Entourer parse JSON d’un `try` pour log en cas d’erreur.

### Logs

* Réception brute :

  ```js
  console.log('[OPENAI_WS] Message received', {
    sessionId: session.sessionId,
    isBinary: Buffer.isBuffer(msg),
  });
  ```
* Audio delta :

  ```js
  console.log('[OPENAI_WS] response.audio.delta', {
    sessionId: session.sessionId,
    audioBytes: audioBuf.length,
  });
  ```
* Transcript delta :

  ```js
  console.log('[OPENAI_WS] response.audio_transcript.delta', {
    sessionId: session.sessionId,
    text: data.transcripts?.[0],
  });
  ```
* Transcript final :

  ```js
  console.log('[OPENAI_WS] response.audio_transcript.done', {
    sessionId: session.sessionId,
    text: data.transcripts?.[0],
  });
  ```
* JSON parse error :

  ```js
  console.error('[OPENAI_WS] Failed to parse JSON message', {
    sessionId: session?.sessionId,
    raw: msg.toString(),
    error: e.message,
  });
  ```

### Références doc

* **Section 8** – Types d’événements `response.audio.delta`, `response.audio_transcript.*`, `response.output_item.done`.

---

## 14. `handleInboundAudioFromTelnyx(session, audioBuf)`

### Rôle

Prendre l’audio **appelant → Telnyx** et le pousser vers OpenAI.

Avec l’option G.711 μ-law 8k des deux côtés : **pas de conversion**, on envoie les octets tels quels.

### Blocs

1. **Vérifier présence du WS OpenAI**

   * `const ws = session.openAiWs;`
   * Si absent ou pas `OPEN` → log et return.

2. **Backpressure / sécurité**

   * Optionnel : vérifier `ws.bufferedAmount` pour éviter d’empiler.

3. **Envoyer le binaire**

   * `ws.send(audioBuf);`

4. **(Optionnel) Compteur**

   * Incrémenter un compteur `session.stats.inboundChunks++` pour debug.

### Logs

* Si OpenAI WS pas prêt :

  ```js
  console.warn('[BRIDGE] Dropping inbound audio, OpenAI WS not ready', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    audioBytes: audioBuf.length,
  });
  ```
* Envoi normal (log échantillonné, pas à chaque chunk en prod, mais en dev oui) :

  ```js
  console.log('[BRIDGE] Telnyx -> OpenAI audio', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    bytes: audioBuf.length,
  });
  ```

### Références doc

* **Section 5 (Option A)** – μ-law 8k des deux côtés, pas de transcodage.
* **Section 9** – Boucle “Telnyx media (media event) → Node → OpenAI WS (binary audio)”.

---

## 15. `handleOutboundAudioFromOpenAI(session, audioBuf)`

### Rôle

Prendre l’audio **IA → OpenAI** et l’envoyer à Telnyx via `event: "media"` sur la WS Telnyx.

### Blocs de code

1. **Vérifier WS Telnyx**

   * `const ws = session.telnyxWs;`
   * Si absent ou pas `OPEN` → log + return.

2. **Conversion (ici : aucune)**

   * On suppose qu’OpenAI fournit déjà du μ-law 8k (config `g711_ulaw`).
   * Si jamais dans la vraie vie on reçoit du PCM, on appellera plus tard une fonction de conversion, mais dans la spec de base on passe direct.

3. **Encodage base64**

   * `const payloadBase64 = audioBuf.toString('base64');`

4. **Construction message JSON**

   * `const msg = JSON.stringify({ event: 'media', media: { payload: payloadBase64 } });`

5. **Envoi**

   * `ws.send(msg);`

6. **(Optionnel)** Rate limiting

   * Si tu veux être strict sur Telnyx (~50 messages/s), tu peux ajouter une simple cadence ou buffer.

### Logs

* Si WS Telnyx absent :

  ```js
  console.warn('[BRIDGE] Dropping outbound audio, Telnyx WS not ready', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    audioBytes: audioBuf.length,
  });
  ```
* Envoi normal :

  ```js
  console.log('[BRIDGE] OpenAI -> Telnyx audio', {
    sessionId: session.sessionId,
    callControlId: session.callControlId,
    bytes: audioBuf.length,
  });
  ```

### Références doc

* **Section 7** – Envoi RTP direct : message `{ "event": "media", "media": { "payload": "<base64>" } }`.
* **Section 5 (Option A)** – μ-law aligné Telnyx / OpenAI.

---

## 16. `createCallSession({ phoneNumber, landingSessionId, summary })`

### Rôle

Créer un **objet de session d’appel** central qui relie tout : landing, Telnyx, OpenAI, WS, contexte.

### Blocs

1. **Générer `sessionId`**

   * `const sessionId = uuid.v4();`

2. **Construire l’objet**

   ```js
   const session = {
     sessionId,
     phoneNumber,
     landingSessionId,
     summary,
     callControlId: null,
     mediaToken: null,
     callStatus: 'created',
     streamingStatus: 'pending',
     telnyxWs: null,
     openAiWs: null,
     mediaFormatTelnyx: null,
     stats: {
       inboundChunks: 0,
       outboundChunks: 0,
     },
   };
   ```

3. **Stocker dans des Maps**

   * `sessionsById.set(sessionId, session);`
   * (callControlId viendra après, token aussi).

4. **Retourner `session`**

### Logs

```js
console.log('[SESSION] Created call session', {
  sessionId,
  phoneNumber,
  landingSessionId,
});
```

### Références doc

* **Section 9** – Besoin d’un contexte par appel pour gérer 2 WS et lier call_control_id.
* **Section 14** – Le “call context” qui suit le parcours complet.

---

## 17. `getSessionByCallControlId(callControlId)`, `getSessionByMediaToken(token)`

### Rôle

Fonctions utilitaires pour retrouver la session depuis les identifiants Telnyx ou le token média.

### Blocs

1. **Maintenir des Maps**

   * `sessionsByCallControlId: Map<string, Session>`
   * `sessionsByMediaToken: Map<string, Session>`

2. **Mise à jour après création / appel Telnyx**

   * Dans `startTelnyxOutboundCall` : `sessionsByCallControlId.set(callControlId, session);`
   * Lors de génération token : `sessionsByMediaToken.set(token, session);`

3. **Fonctions**

   ```js
   function getSessionByCallControlId(id) {
     return sessionsByCallControlId.get(id) || null;
   }
   function getSessionByMediaToken(token) {
     return sessionsByMediaToken.get(token) || null;
   }
   ```

### Logs

Généralement pas besoin de logs dans ces getters — mais utile en cas d’absence :

```js
if (!session) {
  console.warn('[SESSION] No session found for callControlId', { callControlId });
}
```

### Références doc

* **Section 9** – Nécessité de lier `call_control_id` ↔ WS ↔ OpenAI.

---

## 18. `cleanupCallSession(callControlId)`

### Rôle

Supprimer toutes les références en mémoire quand l’appel est terminé.

### Blocs

1. **Récupérer la session**

   * `const session = getSessionByCallControlId(callControlId);`
   * Si null → log + return.

2. **Fermer les WS si encore ouverts**

   * `session.telnyxWs?.close();`
   * `session.openAiWs?.close();`

3. **Supprimer des Maps**

   * `sessionsById.delete(session.sessionId);`
   * `sessionsByCallControlId.delete(callControlId);`
   * `sessionsByMediaToken.delete(session.mediaToken);`
   * `telnyxWsToSession.delete(session.telnyxWs);`
   * `openAiWsToSession.delete(session.openAiWs);`

4. **(Optionnel)** Appeler une couche de log/perf (durée de l’appel, etc.).

### Logs

```js
console.log('[SESSION] Cleanup completed', {
  sessionId: session.sessionId,
  callControlId,
});
```

### Références doc

* **Section 9 & 14** – Fin de l’appel, fermeture WS, libération des ressources.
* **Section 12** – Tests durée & mémoire (éviter les leaks).

---

## 19. `generateMediaStreamToken(session)` / `isValidMediaStreamToken(token)`

### Rôle

Gérer les tokens utilisés dans `stream_url` pour authentifier Telnyx sur le WS.

### Blocs

1. **generateMediaStreamToken**

   * `const token = crypto.randomBytes(32).toString('hex');`
   * `sessionsByMediaToken.set(token, session);`
   * `return token;`

2. **isValidMediaStreamToken**

   * `return sessionsByMediaToken.has(token);`

3. **Utilisation**

   * Dans `startTelnyxOutboundCall` → `generateMediaStreamToken(session)`.
   * Dans `handleTelnyxMediaConnection` → `const session = getSessionByMediaToken(token);`.

### Logs

* Génération :

  ```js
  console.log('[SECURITY] Generated media token for session', {
    sessionId: session.sessionId,
  });
  ```
* Token invalide est déjà logué dans `handleTelnyxMediaConnection`.

### Références doc

* **Section 6** – Exemple `stream_url` avec `?token=XYZ`.
* **Section 10** – Sécurisation du WS media Telnyx par token.

---

## 20. `verifyTelnyxSignature(rawBody, timestamp, signature)`

### Rôle

Garantir que les webhooks Telnyx sont auth.

### Blocs

1. **Charger clé publique Telnyx** (config / env).
2. **Construire message**

   * Concat timestamp + “.” + rawBody (ou la forme exacte selon la doc Telnyx v2).
3. **Vérifier signature Ed25519**

   * Utiliser SDK Telnyx ou lib `tweetnacl` / `crypto`.
4. **Retourner boolean**

### Logs

* En cas d’échec :

  ```js
  console.warn('[SECURITY] Telnyx webhook signature verification failed', {
    timestamp,
  });
  ```

### Références doc

* **Section 10** – Authentification des requêtes Telnyx (webhooks signés).
