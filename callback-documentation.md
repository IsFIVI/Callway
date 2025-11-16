Rappel téléphonique automatisé avec Telnyx et OpenAI GPT-Realtime – Rapport technique
1. Configuration d’une application Telnyx Voice API (Media Streams WebSocket)

Pour utiliser la Voice API v2 de Telnyx, commencez par créer une Voice API Application (application de contrôle d’appel) depuis le portail Telnyx
developers.telnyx.com
. Cette application définira le comportement des appels et permettra la diffusion du média en temps réel. Lors de la création :

Nom de l’application – Donnez un nom descriptif (par ex. “Callback AI”).

Webhook URL (événements d’appel) – Indiquez l’URL publique de votre serveur (Node.js) qui recevra les webhooks Telnyx (événements comme call.initiated, call.answered, etc.)
developers.telnyx.com
. Utilisez HTTPS (Telnyx exige un schéma https://). Assurez-vous d’opter pour l’API V2 des webhooks (format v2 recommandé)
developers.telnyx.com
. Cette URL de webhook n’a pas de lien avec le flux audio ; elle sert uniquement aux notifications d’état d’appel.

Ancrage de site (Anchor site) – Laissez par défaut (“latency”) pour que Telnyx choisisse automatiquement le point de présence optimal afin de minimiser la latence média
developers.telnyx.com
.

Timeout de commande – Activez éventuellement “Hang-up on timeout” avec un délai si vous voulez que Telnyx raccroche si votre application ne répond pas aux webhooks dans un temps imparti
developers.telnyx.com
.

Une fois l’application créée, assignez un numéro de téléphone à cette application dans l’onglet “Numbers” pour les appels entrants (si nécessaire)
developers.telnyx.com
. Pour notre cas de rappel sortant, le numéro sera principalement utilisé en tant qu’identifiant d’appelant (from), mais lier le numéro à l’application garantit que Telnyx saura utiliser cette application pour tout appel impliquant ce numéro
developers.telnyx.com
.

⚠ Distinction TeXML : Telnyx propose deux approches de contrôle d’appels : les applications Voice API (Call Control API v2, orientées API/JSON) et les applications TeXML (basées sur un XML de pilotage, similaire à TwiML). Ici, nous utilisons la Voice API v2 et non TeXML, car elle permet le streaming audio WebSocket. Veillez donc à créer une “Voice API Application” (parfois appelée Call Control App) et non une application TeXML. Dans la console Telnyx, cela signifie choisir l’option “Programmable Voice API” lors de la configuration de l’application
telnyx.com
.

2. Paramétrage de l’Outbound Voice Profile et mapping avec l’application

Telnyx requiert un Outbound Voice Profile (OVP) pour émettre des appels sortants. Ce profil définit les réglages de terminaison d’appel (plan de tarification, destinations autorisées, limite de canaux, etc.)
support.telnyx.com
support.telnyx.com
. Créez un OVP dans le portail Telnyx (menu Outbound Voice Profiles). Donnez-lui un nom (p.ex. “Profile Rappel AI”) et configurez au minimum :

Destinations autorisées – Sélectionnez les pays ou régions vers lesquels les appels peuvent être émis
support.telnyx.com
 (ajustez selon votre cas d’usage). Pour des appels nationaux standard, cette étape peut être minimale, mais pour des appels internationaux, assurez-vous d’inclure les pays requis.

Méthode de facturation – Laissez “Rate Deck” par défaut (tarification par préfixe)
support.telnyx.com
.

Limite de canaux sortants – Vous pouvez restreindre le nombre d’appels simultanés sur ce profil (par ex. limiter à 1 si vous ne voulez qu’un rappel à la fois durant les tests)
support.telnyx.com
.

Autres réglages – Par défaut, la limite de dépense quotidienne et l’enregistrement des appels sont désactivés, à configurer selon vos besoins. (Exemple : vous pouvez activer Record Outbound Calls pour enregistrer les appels sortants – choisir format WAV/MP3 et mono/stéréo
support.telnyx.com
 – mais cela n’est pas indispensable pour la fonctionnalité de rappel elle-même.)

Une fois l’OVP créé, assignez-le à votre application Voice API. Dans le profil, utilisez la section “Associated Connections and Applications” pour ajouter votre application (elle apparaîtra avec le label “APP” suivi de son nom)
support.telnyx.com
. Inversement, vous pouvez aussi ouvrir la configuration de l’application Voice API et sélectionner le Outbound Voice Profile correspondant dans les paramètres de sortie
developers.telnyx.com
. Cette association est obligatoire pour autoriser les appels sortants via l’application
support.telnyx.com
. Sans profil de sortie assigné, toute tentative d’appel sortant sera bloquée par Telnyx.

Enfin, notez le Connection ID / Application ID de votre application (identifiant unique) : il sera nécessaire pour initier les appels via l’API
support.telnyx.com
. Dans la console, l’ID de l’application apparaît dans les détails de l’application une fois créée.

3. Format audio des flux Telnyx Media Streams (codec, échantillonnage, format)

Telnyx Media Streams fournit le son de l’appel en temps réel via WebSocket, sous forme de paquets audio encodés. Par défaut, l’audio est encodé en PCMU (G.711 μ-law) à 8 kHz, mono
developers.telnyx.com
developers.telnyx.com
. Telnyx supporte plusieurs codecs pour le streaming bidirectionnel :

PCMU (G.711 μ-law), 8 kHz (par défaut)
developers.telnyx.com

PCMA (G.711 A-law), 8 kHz
developers.telnyx.com

G.722, 8 kHz (codec wideband 50–7000 Hz souvent utilisé en VoIP HD)
developers.telnyx.com

OPUS, 8 kHz ou 16 kHz
developers.telnyx.com

AMR-WB, 8 kHz ou 16 kHz
developers.telnyx.com

L16 (PCM linéaire 16 bit), 16 kHz
developers.telnyx.com

Les flux Telnyx utilisent le protocole RTP sur WebSocket, mais Telnyx envoie uniquement la charge utile audio encodée, sans en-têtes RTP, encodée en base64 dans un JSON
developers.telnyx.com
developers.telnyx.com
. Concrètement, chaque message audio reçu sur le WebSocket Telnyx a la structure suivante :

{
  "event": "media",
  "sequence_number": "...",
  "media": {
    "track": "inbound", 
    "chunk": "2", 
    "timestamp": "5",
    "payload": "<données audio base64>"
  },
  "stream_id": "..."
}


Le champ payload contient les données audio brutes encodées en base64 (par exemple, des trames RTP G.711 sans en-tête)
developers.telnyx.com
. Chaque message correspond à un fragment temporel d’audio. Telnyx envoie typiquement des paquets de l’ordre de 20 ms chacun pour un flux en temps réel à faible latence (valeur commune pour RTP en téléphonie). Le numéro de chunk et le timestamp peuvent aider à réordonner si des paquets arrivent hors séquence, bien que l’ordre de livraison ne soit normalement pas garanti par Telnyx (s’appuyant sur TCP)
developers.telnyx.com
.

Conteneur et framing : Aucun conteneur de haut niveau (WAV, etc.) n’est utilisé. Les données sont brutes, continuees, et découpées en trames successives. Par exemple, en PCMU 8 kHz, une trame de 20 ms représente 160 échantillons codés sur 8 bits (soit 160 octets, encodés en base64 dans ~216 octets JSON). En L16 16 kHz, 20 ms représentent 320 échantillons PCM 16-bit (640 octets). Telnyx enveloppe chaque fragment audio dans un message JSON comme illustré ci-dessus.

Résumé format Telnyx : Codec (ex. PCMU), échantillonnage (8 kHz par défaut, ou jusqu’à 16 kHz avec codecs comme OPUS/L16), canaux (mono 1 canal)
developers.telnyx.com
, fragments (20 ms typiquement, encodés base64 dans des événements media). Aucune métadonnée audio (ex. taux de bits) n’est à gérer puisqu’on est en flux non compressé (ou compressé standard télécom).

4. Format audio de l’OpenAI GPT-Realtime via WebSocket (codec, sample rate, canaux)

L’API OpenAI Realtime (modèle GPT-Realtime) permet une interaction speech-to-speech en continu. Par défaut, OpenAI utilise du PCM 16 bits linéaire, 24 kHz, mono pour l’audio
docs.workadventu.re
. Concrètement, les chunks audio échangés sont en format PCM signé 16-bit little-endian (S16LE), 1 canal, échantillonnés à 24000 Hz.

Côté entrée (voix utilisateur vers OpenAI) : OpenAI attend normalement un flux audio PCM 24 kHz 16 bits. Ce flux est généralement envoyé sous forme binaire sur le WebSocket (chaque message binaire contenant un segment d’audio). Si l’audio fourni n’est pas en 24 kHz, OpenAI ne le traitera pas correctement – il faudra donc convertir ou informer l’API via la configuration de session (voir section compatibilité audio).

Côté sortie (voix générée par l’IA) : OpenAI génère des réponses audio également en PCM 16 bits 24 kHz par défaut. L’API envoie ces données par morceaux (streaming), permettant de commencer la lecture avant que la phrase complète ne soit produite. Par exemple, dès que l’IA commence à parler, des chunks audio (Int16) sont émis progressivement. Dans l’implémentation JavaScript côté client, on reçoit ces données sous forme de tableau d’entiers 16-bit, qu’il faut convertir en floats pour Web Audio
docs.workadventu.re
.

Taille de trame et latence : OpenAI ne documente pas explicitement la taille de chaque chunk envoyé. D’après les tests, les paquets audio de sortie peuvent correspondre à quelques dizaines de millisecondes chacun, selon le débit de génération du modèle. Le protocole étant optimisé pour la faible latence, OpenAI envoie l’audio dès qu’il est disponible, par petits incréments.

Configuration personnalisée : L’API GPT-Realtime permet de changer le format audio via des paramètres de session. Par exemple, on peut demander du PCM 16 kHz au lieu de 24 kHz, ou du G.711, afin de faciliter l’interfaçage avec une source externe. Ceci se fait en envoyant un message de type session.update après l’ouverture du WebSocket, avec des champs input_audio_format et output_audio_format appropriés
evilmartians.com
. Les valeurs supportées incluent notamment :

"pcm_s16le_16000" – PCM 16 kHz 16-bit little-endian
community.openai.com

"pcm_s16le_24000" – (valeur par défaut implicite, 24 kHz)

"g711_ulaw" – G.711 μ-law 8 kHz
evilmartians.com

"g711_alaw" – G.711 A-law 8 kHz (supporté également d’après la documentation OpenAI)

En outre, on peut configurer d’autres paramètres via session.update : par ex. choisir le modèle de transcription (ex. whisper-1 pour la reconnaissance vocale entrante)
evilmartians.com
, activer la détection de fin de parole (Voice Activity Detection, mode server_vad par défaut), ou sélectionner une voix spécifique pour la synthèse vocale de sortie (OpenAI propose plusieurs voix pré-entraînées, telles que “alloy” utilisée dans certains exemples
docs.workadventu.re
docs.workadventu.re
).

Résumé format OpenAI : Codec : PCM 16 bits (sauf configuration contraire), sample rate : 24000 Hz par défaut (peut être ajusté à 16000 Hz), canaux : mono. Les données transitent généralement en binaire (suite d’octets PCM) sur le WebSocket. Si on utilise la librairie OpenAI Realtime, elle nous fournit directement les tableaux Int16 en sortie et gère l’envoi en entrée.

5. Compatibilité audio Telnyx ↔ OpenAI et transcodage dans le bridge

Étant donné les formats ci-dessus, il est crucial d’aligner le format audio entre Telnyx et OpenAI pour éviter toute distorsion ou absence de son. Il y a plusieurs possibilités mais dans un objectif de simplifcité maximale et latence minimale, nous choisions de partir sur l'option qui ne demande pas de conversion :

G.711 μ-law 8 kHz des deux côtés. Telnyx utilise par défaut PCMU 8 kHz, et OpenAI peut être configuré pour accepter et produire du g711_ulaw (8 kHz). Avantage : aucun transcodage lourd côté Node – on peut relayer les données quasi directement. Inconvénient : qualité téléphonique standard (bande étroite), pouvant réduire la précision de reconnaissance et la qualité vocale de l’IA. Néanmoins, OpenAI a prévu ce cas et sait gérer du μ-law. Pour activer ce mode, envoyez {"type": "session.update", "session": {"input_audio_format": "g711_ulaw", "output_audio_format": "g711_ulaw", ...}} juste après la connexion au WebSocket OpenAI
evilmartians.com
. Ainsi, le bridge Node.js n’a qu’à décoder le base64 de Telnyx (obtenant les octets G.711) et les envoyer tels quels en binaire à OpenAI, puis prendre les octets G.711 en sortie d’OpenAI et les renvoyer en base64 à Telnyx. Pas de resampling, pas de conversion d’échantillonnage – juste un décodage/encodage base64 et éventuellement un remaniement d’enveloppe JSON. (Telnyx et OpenAI traitent le μ-law comme flux audio compressé standard.)




6. Exemple d’appel API Telnyx pour lancer un appel sortant avec Media Streams

Pour initier un appel de rappel automatisé, votre application Node.js devra appeler l’API Telnyx pour démarrer un appel sortant. L’endpoint à utiliser est POST https://api.telnyx.com/v2/calls 
developers.telnyx.com
. Vous devrez fournir dans le corps JSON toutes les informations nécessaires :

connection_id : l’ID de votre application Voice API Telnyx (identifiant de connexion/app obtenu lors de la config, cf. section 1)
developers.telnyx.com
.

to : le numéro de destination (numéro du client à rappeler) au format E.164, par ex. "+33123456789"
developers.telnyx.com
.

from : le numéro d’appelant, c’est-à-dire votre numéro Telnyx acheté, au format E.164 également
developers.telnyx.com
. Ce numéro doit être associé à l’application.

stream_url : l’URL wss:// de votre serveur WebSocket qui gérera le streaming média
developers.telnyx.com
. C’est l’URL où Telnyx enverra la voix de l’appel et attendra en retour l’audio à jouer. Exemple : "wss://api.mondomain.com/media" (doit être accessible publiquement en WS sécurisé).

stream_track : indique quelle voie audio streamer : "inbound_track", "outbound_track" ou "both_tracks"
developers.telnyx.com
. Pour une intégration avec un agent IA, il est courant d’écouter l’audio de l’appelant uniquement (inbound_track par défaut) et d’injecter des réponses. Cependant, pour un bridge full-duplex, vous pouvez choisir "both_tracks" afin de recevoir aussi l’audio sortant (par ex. utile si vous souhaitez éventuellement transcrire ce que l’IA dit ou vérifier ce qui a été envoyé).

stream_bidirectional_mode : pour activer l’audio bidirectionnel (envoi et réception via WebSocket), spécifiez "rtp"
developers.telnyx.com
developers.telnyx.com
. Sans ce paramètre, Telnyx n’enverra que le flux en écoute (mode “fork” unidirectionnel). "rtp" signifie qu’on utilisera le protocole RTP simulé pour injecter de l’audio en retour.

stream_bidirectional_codec : le codec à utiliser si on active le mode bidirectionnel. Choisissez parmi les codecs supportés (voir section 3) en fonction de la stratégie décidée
developers.telnyx.com
. Par ex., "PCMU" pour μ-law 8k, ou "L16" pour PCM 16k. Important : Ce codec doit être cohérent avec la configuration côté OpenAI/bridge (voir section 5). S’il diffère du codec négocié avec le réseau téléphonique, Telnyx effectuera une conversion avec risque de perte de qualité
developers.telnyx.com
. (Telnyx fait en sorte de transcoder si besoin, mais mieux vaut éviter : ex. si l’appel PSTN est en G.711 et que vous demandez L16, Telnyx convertira G.711→PCM16; cela ajoute un poil de latence et de distorsion, mais c’est généralement acceptable.)

Voici un exemple de requête cURL complète combinant ces éléments (valeurs fictives) :

curl -X POST "https://api.telnyx.com/v2/calls" \
  -H "Authorization: Bearer <TELNYX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "1684641123236054244",
    "to": "+33612345678",
    "from": "+33123456789",
    "stream_url": "wss://ai.example.com/media-stream/abc123?token=XYZ",
    "stream_track": "inbound_track",
    "stream_bidirectional_mode": "rtp",
    "stream_bidirectional_codec": "PCMU"
  }'


Dans cet exemple, on initie un appel du +33 1 23 45 67 89 (votre numéro) vers le +33 6 12 34 56 78 (client). Le flux WebSocket ira vers wss://ai.example.com/media-stream/abc123?.... Notez l’ajout d’un paramètre token=XYZ dans l’URL : vous pouvez utiliser un jeton d’authentification (généré par votre app) pour sécuriser la connexion WS (Telnyx retransmettra la query string lors de la connexion). Nous y reviendrons en section 10 (sécurité).

Telnyx répondra à cet appel API avec un JSON contenant notamment un call_control_id (identifiant unique de l’appel)
developers.telnyx.com
. Conservez-le si vous comptez éventuellement contrôler l’appel par la suite (par ex. raccrocher manuellement via API, etc.), même si pour ce cas d’usage, ce n’est pas nécessaire car l’appel suivra son cours automatiquement.

Webhook d’initiation : Immédiatement après l’appel API réussi, Telnyx enverra un webhook call.initiated à votre URL (voir section 7) confirmant le début de l’appel
developers.telnyx.com
. Vous pouvez l’utiliser pour logguer ou lier l’appel à une session utilisateur côté application.

7. Structure des événements Telnyx (call.initiated, call.answered, media.start, media.stop, etc.)

Telnyx notifie votre application des changements d’état de l’appel via des webhooks HTTP (POST vers votre Webhook URL configuré). Chaque événement est envoyé au format JSON v2 contenant un champ event_type et un payload. Parallèlement, pour le streaming audio, des messages WebSocket spécifiques transitent sur la connexion media. Détaillons les principaux événements :

Événements d’appel (webhooks HTTP) :

call.initiated – Indique que l’appel a été initié (composition en cours). Le payload inclut l’ID de contrôle d’appel (call_control_id), l’ID de session, le numéro appelant (from), le numéro appelé (to), la direction (outgoing dans ce cas), et l’état (bridging lors de la sonnerie)
developers.telnyx.com
developers.telnyx.com
. Vous recevez ce webhook juste après votre requête d’appel sortant.

call.answered – Envoyé lorsque le destinataire a décroché. Le payload indique state: "answered" et fournit l’horodatage de début d’appel effectif
developers.telnyx.com
developers.telnyx.com
. À ce stade, la communication audio est établie. Dans notre contexte, la réception de call.answered signifie qu’on peut démarrer l’envoi du flux audio à OpenAI (si ce n’est pas déjà fait via déclenchement par media event, voir plus bas).

streaming.started – Cet événement confirme que Telnyx a bien établi la connexion de streaming vers votre WebSocket et a commencé à forker l’audio
developers.telnyx.com
developers.telnyx.com
. Le payload contient le call_control_id et l’URL du stream. Vous pouvez l’utiliser pour logguer ou vérifier que le WS audio a démarré. (Telnyx envoie généralement ce webhook juste après le call.answered si le streaming a été demandé dans la commande d’appel).

streaming.stopped – Indique que le streaming média a pris fin
developers.telnyx.com
developers.telnyx.com
, généralement lorsque l’appel se termine ou que vous arrêtez le stream. Payload semblable à streaming.started.

call.hangup – Indique que l’appel est terminé (raccroché)
developers.telnyx.com
developers.telnyx.com
. Le payload fournit la raison (hangup_cause) – e.g. "hangup_cause": "normal_clearing" pour fin d’appel normale – et qui a raccroché (hangup_source: “caller” ou “callee”)
developers.telnyx.com
developers.telnyx.com
. C’est votre signal pour nettoyer la session côté serveur (fermer la connexion OpenAI, libérer ressources).

Telnyx peut envoyer d’autres événements (par ex. call.failed si l’appel n’aboutit pas, call.machine_detected si AMD activé, etc.), mais les quatre ci-dessus couvrent le cycle de vie nominal d’un appel de rappel.

Événements du WebSocket media (messages JSON sur la connexion WebSocket Telnyx) :

connected – Message envoyé immédiatement lors de l’établissement de la connexion WS par Telnyx
developers.telnyx.com
. Il s’agit d’un simple JSON : {"event": "connected", "version": "1.0.0"} indiquant que la socket est prête. Votre serveur doit l’ignorer ou s’en servir pour logguer la connexion.

start – Indique le début effectif du streaming audio. Contient des métadonnées sur le flux : media_format avec codec, sample rate et nombre de canaux
developers.telnyx.com
developers.telnyx.com
, ainsi qu’un stream_id unique. Exemple de media_format reçu : "encoding": "PCMU", "sample_rate": 8000, "channels": 1
developers.telnyx.com
. Ce message confirme quel codec Telnyx utilise (au cas où vous n’auriez pas explicitement fixé le codec côté API). Dans notre contexte, on s’attendra par ex. à "encoding": "PCMU" (si μ-law) ou "L16" (si PCM) etc. Une fois ce message reçu, Telnyx va commencer à envoyer les paquets audio.

media – C’est l’événement principal, envoyé de manière répétitive. Chaque événement de ce type contient un fragment audio de la conversation. Le JSON inclut track (“inbound” ou “outbound”), sequence_number, timestamp, chunk (index de paquet) et surtout le payload audio en base64
developers.telnyx.com
developers.telnyx.com
. Telnyx enverra typiquement des événements media pour le track inbound (voix de l’utilisateur) si vous avez choisi inbound_track. Si vous aviez both_tracks, vous recevriez aussi des media avec track: "outbound" (contenu de ce qui est joué à l’utilisateur). Votre Node.js doit décoder ces payloads et les transmettre à OpenAI (voir section 9). Telnyx attend également que vous puissiez envoyer des messages media en retour pour jouer du son (voir ci-après Sending RTP).

stop – Indique la fin du flux audio sur la socket, généralement juste après que l’appel soit raccroché
developers.telnyx.com
. Structure : {"event": "stop", "sequence_number": "...", "stop": { "call_control_id": "...", ... }, "stream_id": "..."}. Après cet événement, Telnyx fermera la connexion WebSocket.

Événements spéciaux :

mark – Marqueurs optionnels utilisés pour synchroniser la fin de lecture de médias injectés
developers.telnyx.com
. Peu pertinent dans notre cas sauf si vous gérez des files audio complexes.

clear – Confirmation après envoi d’une commande clear (pour stopper tout média en cours de lecture sur la socket)
developers.telnyx.com
.

dtmf – Notification si un DTMF (touche) est détecté dans l’appel
developers.telnyx.com
. Cela apparaît si l’utilisateur presse une touche téléphonique. Le payload fournit la digit
developers.telnyx.com
. Vous pourriez l’exploiter pour ajouter des commandes via clavier, mais par défaut on n’en a pas besoin.

error – Indique une erreur sur le flux WS
developers.telnyx.com
 (ex : frame mal formée, débit dépassé, etc.). En particulier, si vous envoyez des données non base64 ou trop fréquemment, Telnyx peut renvoyer un event: "error" avec un code (ex. 100003 malformed_frame ou 100005 rate_limit_reached)
developers.telnyx.com
. Vous devez gérer ces erreurs éventuelles (log et éventuellement corriger l’envoi).

Injection audio (Telnyx WebSocket en écriture) : le WebSocket n’est pas qu’en lecture – grâce au mode bidirectionnel activé, votre serveur peut envoyer des messages sur la socket Telnyx pour jouer de l’audio sur l’appel. Deux types d’envoi existent :

Envoi RTP direct : en mode "rtp", on peut envoyer un message media contenant un payload base64 représentant des paquets RTP audio à jouer
developers.telnyx.com
. Format identique aux paquets reçus, sauf qu’ici c’est vous qui fournissez le payload. Telnyx l’injectera comme audio sortant (track outbound) vers l’appelant en temps réel. Taille : Telnyx accepte des chunks entre 20 ms minimum et 30 s maximum
developers.telnyx.com
. Pour une conversation temps réel, vous enverrez typiquement des petits chunks (20 ms à quelques centaines de ms) successifs pour constituer la parole de l’IA.

Envoi de fichiers (MP3) : Alternativement, Telnyx autorise l’envoi de médias sous forme de fichier audio complet encodé en base64 (actuellement MP3 uniquement)
developers.telnyx.com
. Dans ce cas, Telnyx placera le média dans une file d’attente et le jouera en entier. Cependant, cette méthode n’est pas adaptée au full-duplex ou aux réponses dynamiques mot-à-mot, car Telnyx impose une limite d’un fichier par seconde maximum
developers.telnyx.com
 et attend la fin de la lecture. C’est plutôt pour diffuser un message préenregistré. Pour notre besoin (streaming de la voix IA en temps réel), on utilisera l’envoi RTP direct plutôt que le MP3 file.

En résumé, votre Node.js recevra des événements media (inbound) sur la socket Telnyx, et devra envoyer des événements media (payload outbound) sur la même socket pour faire parler l’IA. Le tout en respectant le format (base64 RTP) et le timing (pas saturer plus de ~50 messages/s pour rester dans ~20 ms chacun, et éviter l’erreur de rate-limit).

8. Structure des messages WebSocket OpenAI GPT-Realtime

L’interaction avec l’API OpenAI Realtime se fait entièrement via le WebSocket que vous établissez vers wss://api.openai.com/v1/realtime (ou l’endpoint Azure équivalent si vous utilisez Azure OpenAI). Une fois connecté et authentifié, les échanges se font sous forme d’événements JSON pouvant contenir du texte ou de l’audio, émis asynchronement dans les deux sens
learn.microsoft.com
learn.microsoft.com
. Voici les principaux types de messages et leur rôle :

Authentification / Configuration : Lors de la connexion, vous devez fournir votre clé API OpenAI. Cela peut se faire soit via l’en-tête Authorization: Bearer <API_KEY> au handshake WebSocket (ce qui est recommandé côté serveur)
evilmartians.com
evilmartians.com
, soit en ajoutant ?api-key=... dans l’URL (évitez en production car bien que chiffré en wss, mieux vaut l’entête). OpenAI peut aussi exiger un header d’opt-in si l’API est en bêta (par ex., OpenAI-Beta: realtime=v1 lors des phases preview)
evilmartians.com
evilmartians.com
. Une fois la connexion établie, OpenAI envoie typiquement un événement session.created (ou équivalent) pour confirmer la session
evilmartians.com
. Immédiatement après, vous avez la possibilité d’envoyer un événement de configuration de session. Il s’agit d’un message JSON de type session.update où vous pouvez spécifier les paramètres tels que input_audio_format, output_audio_format, input_audio_transcription.model (ex. whisper-1), voice (choix de la voix de synthèse) ou encore des instructions système pour le modèle
docs.workadventu.re
docs.workadventu.re
. Exemple minimal : {"type": "session.update", "session": { "input_audio_format": "g711_ulaw", "output_audio_format": "g711_ulaw", "input_audio_transcription": {"model": "whisper-1"} } }
evilmartians.com
. OpenAI répondra éventuellement par un événement session.updated pour accuser réception (non strictement nécessaire si pas de changement critique).

Envoi de l’audio utilisateur (input) : Pour transmettre la voix de l’appelant à OpenAI, vous envoyez des messages binaires sur le WS. Chaque message binaire contient un fragment audio (ex. 20 ms) encodé selon le format attendu (PCM ou μ-law selon config). Vous n’avez pas besoin d’envelopper cela dans du JSON : le protocole considère tout message binaire entrant comme un morceau de signal audio utilisateur. Ces paquets peuvent être envoyés en continu pendant que l’utilisateur parle. OpenAI effectuera la reconnaissance vocale en temps réel sur ce flux, avec Voice Activity Detection (VAD) pour déterminer quand le locuteur a fini sa phrase
docs.workadventu.re
. Vous n’obtiendrez pas de confirmation pour chaque chunk envoyé, c’est un flux aveugle type streaming.

Transcription en temps réel (events de sortie) : Tandis que l’utilisateur parle, OpenAI peut commencer à renvoyer des éléments de transcription partiels. Ces messages arrivent sous forme d’événements JSON de type response.audio_transcript.delta (pour un morceau de transcription)
evilmartians.com
. Le champ delta contiendra par exemple un ou quelques mots reconnus jusqu’à présent. Votre application peut les utiliser pour afficher du texte live ou logguer ce que dit l’utilisateur. Quand OpenAI a déterminé que l’utilisateur a terminé sa phrase (via VAD ou silence), il envoie un événement response.audio_transcript.done contenant la transcription complète de l’énoncé utilisateur
evilmartians.com
. Vous pouvez exploiter ce message si vous voulez avoir le texte complet de la requête (par ex. pour journalisation ou pour une autre logique). Toutefois, pour simplement faire suivre à l’IA, ce n’est pas nécessaire : OpenAI passe automatiquement à l’étape suivante.

Réponse de l’IA (audio de sortie) : Après la fin de la parole utilisateur, le modèle LLM génère une réponse (sous forme textuelle) puis la convertit en audio (via un TTS interne), le tout de manière streamée. Vous recevrez des événements response.audio.delta contenant chacun un chunk audio de la réponse vocale
evilmartians.com
. Ces chunks sont typiquement des tableaux d’entiers 16-bit (Int16) si le format est PCM, ou potentiellement encodés (ex. μ-law) selon output_audio_format. Dans l’implémentation Node, si vous utilisez la librairie OpenAI realtime, l’event peut vous fournir event.delta.audio directement sous forme d’Int16Array
docs.workadventu.re
docs.workadventu.re
. Si vous n’utilisez pas de librairie, le message JSON contiendra probablement l’audio encodé en base64 ou en structure compressée – mais d’après les exemples (Evil Martians), on voit qu’ils reçoivent un JSON, puis décodent dedans l’audio. Il est possible qu’OpenAI envoie l’audio sous forme de données binaires séparées ou encapsulées dans du JSON. Supposons pour la simplicité qu’on obtienne l’audio brut. Votre serveur recevra donc ces chunks successifs jusqu’à ce que la réponse soit complète. OpenAI signale la fin de sa réponse par un événement response.output_item.done (ou response.done)
evilmartians.com
, indiquant que l’item de réponse est terminé. À ce moment, l’IA attend à nouveau une éventuelle prochaine entrée utilisateur (nouvelle turn de conversation).

Messages textuels et autres : En parallèle des audio, vous pourriez recevoir des messages contenant du texte pur (par ex. si l’IA décide d’effectuer un appel de fonction ou retourne un résultat textuel). Dans le cas du modèle GPT-Realtime standard, la sortie principale est audio + texte transcrit de ce qu’elle dit. Vous pouvez capter le texte de la réponse IA via des events response.message.* ou via les champs transcripts inclus parfois dans les deltas audio
docs.workadventu.re
. Par exemple, certains events conversation.updated contiendront un delta.transcripts avec les mots que l’IA est en train de prononcer ou a prononcés
docs.workadventu.re
. Ce sont en fait la transcription texte de l’audio de l’IA. Cela peut servir si vous voulez afficher les sous-titres de la réponse IA en live, ou analyser le contenu généré. Ce n’est pas strictement nécessaire pour le fonctionnement vocal, mais c’est une donnée utile en annexe.

Contrôle de tour : OpenAI GPT-Realtime gère par défaut le tour de rôle grâce au VAD (on a configuré turn_detection: server_vad dans l’exemple WorkAdventure
docs.workadventu.re
). Cela signifie que l’IA attend le silence de l’utilisateur pour répondre, et parle sans interruption jusqu’à la fin de sa réponse (puis attend de nouveau l’utilisateur). Il est possible d’implémenter un barge-in (interruption de l’IA par l’utilisateur), mais c’est complexe : il faudrait couper l’audio de l’IA en cours si on détecte de la voix entrante. Par défaut, considérez l’échange comme un tour par tour strict (ce qui correspond aux événements décrits : transcript → réponse → etc.).

En synthèse, sur le WebSocket OpenAI : vous envoyez l’audio utilisateur en binaire (et éventuellement un message initial de session.update), et vous recevez des messages JSON indiquant la transcription utilisateur et l’audio de la réponse IA. Votre code Node doit gérer ces messages asynchrones, en particulier assembler les chunks audio de réponse pour les envoyer en continu à Telnyx.

9. Spécification du bridge Node.js (audio duplex Telnyx ↔ OpenAI)

Cette section décrit comment construire le pont audio full-duplex en Node.js reliant Telnyx (appel téléphonique) et OpenAI GPT-Realtime (IA vocale). L’architecture globale est la suivante : votre serveur Node agit comme intermédiaire, à la fois serveur WebSocket (pour Telnyx) et client WebSocket (pour OpenAI), transférant l’audio dans les deux sens et orchestrant le dialogue.

Étapes de flux (événementiel) :

Démarrage du rappel : Un utilisateur (depuis une landing page, par ex.) demande un rappel. Votre backend déclenche l’appel sortant via Telnyx (API /calls comme en section 6). Vous obtenez immédiatement un call_control_id et peu après le webhook call.initiated de Telnyx
developers.telnyx.com
.

Mise en place des connexions WS :

Dès la requête d’appel effectuée, ou au plus tard dès réception de call.answered
developers.telnyx.com
, votre Node.js doit ouvrir la connexion WebSocket vers OpenAI. Il s’agit d’établir la session GPT-Realtime. Incluez le header d’auth Authorization: Bearer <OPENAI_API_KEY> et connectez à wss://api.openai.com/v1/realtime?model=gpt-realtime (ou modèle exact déployé)
learn.microsoft.com
. Si la connexion réussit, vous recevrez un événement session.created (de façon asynchrone). À ce stade, envoyez immédiatement le message session.update pour configurer le format audio et les paramètres (voir section 8). Par ex., input_audio_format = "PCMU" (alias g711_ulaw) si on reste en μ-law, ou "pcm_s16le_16000" si on utilise PCM, etc., de manière cohérente avec Telnyx
evilmartians.com
. Configurez aussi input_audio_transcription.model: "whisper-1" (modèle de STT, recommandé), et éventuellement voice pour la voix de synthèse (OpenAI propose par ex. "voice": "alloy" pour une voix féminine naturelle). Vous pouvez aussi envoyer des instructions (système prompt) ici, qui définissent la personnalité ou le contexte du modèle (par ex. « Tu es un assistant vocal au téléphone… » etc.). Cette configuration initiale de session garantit qu’OpenAI est prêt à échanger l’audio dans le bon format.

Simultanément, Telnyx va tenter de se connecter à votre WebSocket serveur (à l’URL stream_url fourni). Vous devez avoir un serveur WebSocket Node écoutant sur le chemin en question, capable d’accepter la connexion entrante de Telnyx. Libraries utiles : ws (pour WebSocket) ou tout framework supportant les WS (SockJS, etc.). À l’arrivée de la connexion, vérifiez éventuellement un token d’auth (voir section 10). Une fois accepté, Telnyx enverra le message {"event": "connected"}
developers.telnyx.com
, puis après l’établissement de l’appel, le message start avec media_format
developers.telnyx.com
developers.telnyx.com
. À la réception de start, vous savez quel codec et sample rate Telnyx utilise (utile pour valider qu’il correspond à ce que vous attendiez/configuré côté OpenAI). Par exemple, vous verrez media_format.encoding = "PCMU" si μ-law 8k. S’il y a une discordance, logguez une alerte (mais idéalement, en ayant configuré explicitement via stream_bidirectional_codec, il n’y aura pas de surprise).

Boucle de streaming inbound (utilisateur → IA) : Lorsque l’utilisateur parle, Telnyx envoie des événements media (inbound track) contenant le son en base64
developers.telnyx.com
. Votre code doit, pour chaque message media reçu de Telnyx :

Extraire le payload base64 et le décoder en bytes (Buffer binaire).

Si nécessaire, convertir le format vers celui d’OpenAI : par exemple, si Telnyx envoie du μ-law 8k et qu’OpenAI attend du μ-law 8k, pas de conversion ; si Telnyx envoie du PCM16 16k big-endian et qu’OpenAI attend du PCM16 16k little-endian, convertir l’endianness (swap bytes) sur le buffer; si Telnyx 16k → OpenAI 24k, appliquer un resampler.

Envoyer le buffer résultant sur le WebSocket OpenAI en tant que message binaire. Aucune enveloppe JSON n’est requise, on envoie les raw bytes.

(Optionnel) Si OpenAI tarde à répondre et que l’utilisateur fait une pause longue, vous pourriez décider d’arrêter d’envoyer pour économiser de la bande passante. Ce n’est généralement pas nécessaire, OpenAI VAD gère cela.

Ce mécanisme se poursuit de façon fluide. Pensez à implémenter un tampon ou backpressure : si pour une raison quelconque OpenAI ne pouvait pas consommer aussi vite que Telnyx émet (peu probable vu qu’on est en temps réel), évitez d’empiler infiniment les messages. En Node.js, utilisez par exemple les événements ws.send avec un callback ou gérez l’état socket.bufferedAmount. En pratique, la vitesse d’envoi de Telnyx (p. ex ~50 msg/s de 20 ms) est supportée par OpenAI temps réel.

Boucle de streaming outbound (IA → utilisateur) : Dès que l’IA commence à formuler une réponse, OpenAI va envoyer des événements response.audio.delta avec du son IA. Votre code doit, pour chaque message audio de l’IA reçu :

Récupérer les données audio. Si vous recevez un Int16Array directement (via la lib), convertissez-le en Buffer binaire (souvent il suffira de faire Buffer.from(int16array.buffer)). Si vous recevez une chaîne base64 dans un JSON, décodez-la en Buffer. Si vous recevez un Buffer binaire (OpenAI pourrait potentiellement envoyer l’audio en binaire aussi), utilisez-le directement.

Convertir le format vers celui de Telnyx : ex. OpenAI PCM 24k little-endian → Telnyx μ-law 8k nécessite décodage PCM → ré-échantillonnage 24→8k → encodage μ-law (il existe des libs télécom pour PCM->μ-law). Mais encore une fois, si configuré judicieusement, vous pouvez éviter. Idéalement : OpenAI a été configuré pour produire du μ-law 8k directement (output_audio_format: g711_ulaw), alors peut-être qu’il vous envoie déjà des octets μ-law (ou alors il renvoie du PCM16 qu’il vous incombe de compresser : à vérifier, car un utilisateur sur GitHub notait que malgré g711_ulaw configuré, l’API renvoyait un Int16Array
github.com
 – possiblement un bug ou la lib qui décodait?). Par prudence, préparez la conversion : si OpenAI vous donne PCM16 16k et Telnyx attend PCM16 16k, convertissez endianness si besoin; si Telnyx attend μ-law, encodez. Utilisez éventuellement une table de conversion PCM->μ-law (256 valeurs) pour performance.

Encapsuler en message JSON Telnyx : il faut renvoyer sur la socket Telnyx un message de type media contenant le payload base64 du buffer audio
developers.telnyx.com
. En Node, ça ressemble à :

wsTelnyx.send(JSON.stringify({
  event: "media",
  media: { payload: bufferAudio.toString('base64') }
}));


Telnyx jouera immédiatement ce chunk dans l’appel. Pour assurer une lecture fluide, essayez d’envoyer les chunks sortants au rythme approprié. Par exemple, si vous recevez 40 ms d’audio de l’IA dans un chunk, vous pouvez le pousser aussitôt à Telnyx, mais sachez que Telnyx ne jouera pas plus vite que le temps réel. Il est généralement acceptable d’envoyer dès disponibilité, Telnyx mettra en tampon interne si nécessaire quelques millisecondes. Le protocole RTP implique de toute façon un horodatage dans timestamp que Telnyx utilise pour synchroniser (Telnyx mentionne que timestamp peut être utilisé pour ordonnancer)
developers.telnyx.com
.

Répéter jusqu’à ce que l’événement de fin de réponse (response.output_item.done) soit reçu, indiquant que l’IA a fini de parler. À ce moment, vous savez que l’utilisateur peut répondre de nouveau.

Gestion de la conversation multi-tours : Le bridge doit être prêt à boucler. Après une réponse IA terminée, l’utilisateur parle de nouveau, ce qui relance le flux inbound, etc. Normalement, tout cela continue tant que l’appel est ouvert. Vous pouvez éventuellement implémenter une logique d’arrêt : par exemple, si l’IA ou l’utilisateur dit “au revoir” ou si un certain temps de silence prolongé est détecté, votre application peut décider de terminer l’appel. Dans ce cas, vous pouvez appeler l’API Telnyx /calls/{call_control_id}/actions/hangup pour raccrocher, ou simplement laisser l’utilisateur raccrocher.

Fin d’appel et nettoyage : Lorsque l’appel est terminé (call.hangup webhook reçu)
developers.telnyx.com
, ou si l’un des deux interlocuteurs raccroche, il faut nettoyer proprement. Cela signifie :

Fermer la connexion WebSocket Telnyx (Telnyx la fermera de son côté de toute façon après stop, mais vous pouvez aussi la fermer côté serveur).

Fermer la connexion WebSocket OpenAI (envoyer éventuellement un message {"type": "session.close"} si spécifié, sinon juste couper). OpenAI enverra peut-être un response.done ou simplement constatera la fermeture.

Libérer toute ressource (buffers, timers).

Points d’attention particuliers :

Synchronisation et latence : le parcours utilisateur → Telnyx → Node → OpenAI → Node → Telnyx → utilisateur introduit de la latence. En pratique, Telnyx WS + traitement + OpenAI streaming est optimisé pour du quasi temps réel, mais attendez-vous à ~200ms à 500ms de délai total aller-retour dans le meilleur des cas (variable selon la vitesse de génération du modèle et la longueur de réponse). Ce n’est pas un problème pour conversation, mais évitez de superposer les voix (pas de full duplex où les deux parlent en même temps, ce serait confus). Si l’utilisateur parle pendant que l’IA parle, OpenAI VAD le détectera et la réponse IA peut être tronquée. Vous pourriez implémenter une pause de l’IA si une interruption est détectée côté Telnyx (hors du scope basique).

Conversion audio efficace : utilisez des bibliothèques natives si possible pour μ-law <-> PCM et resampling. En Node pure JS, ces opérations sur chaque paquet 20 ms peuvent consommer du CPU, mais restent faisables en temps réel étant donné le volume modeste (8kHz 8-bit -> 64kbps, ou 128kbps PCM16). Testez sur votre machine et surveillez l’utilisation CPU pour la montée en charge.

Gestion d’erreurs : si la connexion OpenAI se ferme inopinément (erreur, quota dépassé, etc.), arrêtez le pont et éventuellement faites raccrocher l’appel (en jouant un message d’erreur préenregistré ou une phrase de clôture via Telnyx TTS, en dernier recours). De même, si Telnyx WS se coupe (par ex. l’appelant a raccroché), assurez-vous de fermer OpenAI proprement pour éviter de continuer à consommer des tokens inutilement.

Scalabilité : pour chaque appel en cours, vous avez 2 websockets et un pipeline de traitement. Veillez à ce que votre serveur Node puisse supporter le nombre simultané d’appels attendu. Node.js est capable d’en gérer un bon nombre en parallèle grâce à son modèle événementiel, mais attention à la charge CPU des transformations audio.

En pseudo-code, le coeur du bridge ressemble à ceci (pour l’option μ-law par ex.) :

// Telnyx WebSocket server "connection" event
telnyxWSS.on('connection', (wsTelnyx, req) => {
  authenticate(req); // vérifier token dans req.url
  wsTelnyx.on('message', async (msg) => {
    let data = JSON.parse(msg);
    if(data.event === 'media' && data.media && data.media.payload) {
      // Inbound audio from caller
      let audioBuf = Buffer.from(data.media.payload, 'base64');  // μ-law bytes
      // (Si nécessaire: transcode μ-law->PCM16LE here)
      openAIWS.send(audioBuf); // forward to OpenAI
    }
    // ... handle other Telnyx events like 'start', 'stop' if needed ...
  });
  // Save wsTelnyx for sending later
});

// OpenAI WebSocket client
openAIWS.on('message', (msg) => {
  // msg could be binary (Buffer) or text (JSON)
  if(Buffer.isBuffer(msg)) {
    // Assuming OpenAI audio output is binary (in practice might be JSON)
    let audioBuf = msg;
    // (Si nécessaire: transcode PCM->μ-law here)
    wsTelnyx.send(JSON.stringify({
      event: 'media',
      media: { payload: audioBuf.toString('base64') }
    }));
  } else {
    let data = JSON.parse(msg);
    if(data.type === 'response.audio.delta' && data.audio) {
      // Possibly audio data in JSON (base64 or array of int16)
      // Handle similar to above after extracting audio bytes...
    }
    // handle transcripts or done events if needed
  }
});


Le code réel sera plus détaillé, mais c’est l’idée centrale. En parallèle, il faudra initialiser openAIWS suite à call.answered (ou avant si anticipé), et gérer la fermeture (sur call.hangup, call openAIWS.close() etc.).

10. Sécurité (authentification, validation Telnyx events, sécurisation du WebSocket OpenAI)

La double intégration nécessite de considérer la sécurité sur deux fronts : les webhooks/WS de Telnyx et l’accès à l’API OpenAI.

Authentification des requêtes Telnyx (webhooks HTTP) : Telnyx signe ses webhooks V2 pour que vous puissiez vérifier qu’ils proviennent bien de Telnyx et n’ont pas été altérés
support.telnyx.com
. Lors de chaque webhook (événement call.* ou streaming.* envoyé en HTTP), Telnyx inclut typiquement des en-têtes comme Telnyx-Signature-Ed25519 et Telnyx-Timestamp. Vous devez implémenter la vérification : Telnyx fournit une clé publique (disponible dans le portail ou via API) que vous utiliserez pour vérifier la signature Ed25519 du JSON (ou utilise leur SDK qui propose une méthode utilitaire, e.g. telnyx.webhooks.signature.verifySignature(...) en Node
github.com
). Ne négligez pas cette vérification – sinon, quelqu’un pourrait appeler votre webhook URL et déclencher de fausses actions. Concrètement, conservez le payload brut et le timestamp, concaténez eux, et utilisez la signature pour vérifier via la clé publique Telnyx (documenté sur Telnyx Developer docs). Si la signature ne correspond pas, rejetez la requête (HTTP 400).

Sécurisation du WebSocket serveur Telnyx : Telnyx va se connecter à votre WebSocket sans méthode d’auth standard (pas de Basic Auth possible facilement sur WS). Pour éviter qu’un tiers ne tente d’envoyer de l’audio à votre serveur, utilisez une URL difficile à deviner et/ou un token. Comme suggéré en section 6, incluez un paramètre de requête dans stream_url (par ex. ?token=<long_random>) généré par votre application lors de l’initiation d’appel. Quand votre serveur reçoit une connexion WS, l’URL demandée est accessible (via req.url ou équivalent). Vérifiez la présence du token et sa validité (par ex., stockez-le en mémoire lors de la requête d’appel, associé à call_control_id, et validez qu’il correspond). Si invalide, fermez la connexion immédiatement. De plus, vous pouvez restreindre par IP – Telnyx publie les plages d’IP sources de ses Webhooks et médias (ex. us-east, us-west, etc.). Si votre infra le permet, autorisez uniquement ces IP sur le port WS.

Veillez aussi à servir le WebSocket en wss:// (TLS) : procurez-vous un certificat SSL pour votre domaine. Une solution rapide en dev est d’utiliser un tunnel type ngrok qui fournit du TLS, ou d’avoir votre serveur Node écouter en HTTPS/WSS avec un cert Let’s Encrypt ou autre. C’est essentiel car l’audio transite en clair sinon.

Authentification à l’API OpenAI : Utilisez la clé secrète API fournie par OpenAI. Ne l’exposez jamais côté client (ici tout se passe côté serveur, donc c’est bien). Chargez-la depuis une variable d’environnement ou un store sécurisé. À la connexion WebSocket, passez-la en header Authorization
evilmartians.com
. Si vous utilisez le SDK openai, il gèrera peut-être ça. OpenAI n’utilise pas de signature supplémentaire sur chaque message (la connexion WS une fois établie fait foi), donc assurez-vous simplement de ne pas laisser traîner la clé ou le handshake en log.

Permissions OpenAI : Vérifiez que votre clé API a accès au modèle GPT-Realtime (c’est en bêta/alpha, possiblement il faut avoir l’accès activé). Sur Azure OpenAI, assurez-vous que le déploiement du modèle realtime est fait et utilisez l’URL et clé correspondantes du service Azure.

Validation des événements OpenAI : Il n’y a pas de signature comme pour Telnyx, car la communication est sur une connexion sortante initiée par vous. On fait confiance à la connexion TLS pour l’authenticité du serveur (vérification du certificat api.openai.com). Donc pas de mécanisme particulier à implémenter, hormis éventuellement un timeout / watchdog – par ex., si plus aucun message n’est reçu d’OpenAI pendant un certain temps alors qu’on attend une réponse, il y a peut-être un souci (vous pourriez alors relancer la session ou abandonner).

Limitation d’accès : Si votre API de rappel est exposée (par ex. endpoint HTTP pour déclencher le rappel), assurez-vous de l’authentifier aussi (par ex. cookie de session utilisateur ou token OAuth). On veut éviter que n’importe qui puisse abuser du système en déclenchant des appels ou en se connectant à votre WebSocket. De plus, gérez bien les quotas : l’API OpenAI coûte par minute audio (Whisper + voix synthèse), donc implémentez une limite de durée d’appel si pertinent.

Autres considérations :

Veillez à utiliser des versions à jour de TLS (TLS1.2+) et des bibliothèques WS maintenues pour éviter les vulnérabilités.

Isoler ce service sur des machines à part peut aider à réduire l’impact en cas de compromission.

Ne logguez pas de données sensibles en clair (le contenu de la conversation peut être confidentiel, traitez-le avec soin si vous le stockez).

Conformez-vous aux politiques d’utilisation d’OpenAI: pas d’utilisation à des fins prohibées, etc., et assurez-vous de pouvoir stocker/traiter les données vocales de l’utilisateur de manière conforme à la vie privée (GDPR si applicable, par ex. mentionnez dans vos CGU l’usage de ces services).

En validant les signatures Telnyx et en protégeant vos endpoints, vous aurez un système robustement sécurisé contre les appels ou injections non sollicitées.

11. Checklist de configuration (Telnyx, OpenAI, DNS, HTTPS)

Avant de lancer en production, passez en revue cette liste de vérification :

Telnyx Account : Compte créé et crédité (solde suffisant pour émettre des appels). API Key générée pour l’auth des requêtes API (et stockée dans votre app)
developers.telnyx.com
.

Numéro Telnyx : Numéro de téléphone acheté/provisionné
developers.telnyx.com
, avec les documents de vérification éventuellement requis (ex. certains pays demandent des justificatifs pour les numéros).

Voice API Application : Créée et configurée (voir section 1). Webhook URL principale (et failover) configurée
developers.telnyx.com
, version API v2, DTMF en RFC2833 (par défaut) suffisent.

Inbound Settings : SIP Subdomain laissé vide ou configuré selon besoins (pas indispensable ici)
developers.telnyx.com
. Codecs inbound : assurez-vous que le codec que vous allez utiliser est coché dans les codecs supportés de l’application
support.telnyx.com
. Par ex., si vous comptez utiliser l’OPUS 16k, cochez OPUS dans la liste et éventuellement décochez le reste pour forcer. Généralement, laisser PCMU/PCMA cochés par défaut ne pose pas de problème si vous utilisez L16, Telnyx fera la conversion, mais pour cohérence, cochez L16 aussi si disponible.

Outbound Settings : Outbound Voice Profile assigné à l’application
support.telnyx.com
. Channel limit éventuellement ajustée.

Phone Numbers : Le numéro d’appelant Telnyx est bien assigné à l’application (sinon les appels sortants avec ce numéro pourraient être refusés)
developers.telnyx.com
.

Outbound Voice Profile : Configuré (voir section 2) – destinations autorisées couvrant votre cas (par ex. si vous appelez uniquement en France, autorisez la France). Si vous voyez des erreurs “Destination not allowed”, ajustez cette liste.

Telnyx API : Clé API Telnyx (Bearer token) configurée dans votre application backend. Droits suffisant (généralement la clé par défaut a tous les droits sur voix).

Webhook handling : Votre application a une route HTTP accessible pour recevoir les webhooks Telnyx (par ex. via Express). Si en dev local, utilisez ngrok pour tester les webhooks.

Signature Webhook : Récupérez la clé publique Telnyx (depuis Mission Control > Auth > Webhooks je crois) et implémentez la vérification. Testez-la avec un webhook réel.

DNS : Un nom de domaine configuré qui pointe vers votre serveur Node.js (pour le WebSocket Telnyx). Assurez-vous que le domaine dans stream_url est résolu publiquement et que le port utilisé (par ex. 443 ou autre) est ouvert.

TLS/HTTPS : Certificat SSL valide pour votre domaine. Si vous n’avez pas de CA, utilisez Let’s Encrypt via Certbot ou une solution intégrée. Vous pouvez configurer votre Node.js server avec HTTPS (ex. utiliser le module https de Node avec les clés). Alternativement, placez un proxy Nginx en front qui gère TLS et forwarde vers votre Node en WS. Tester wss://yourdomain/path avec un client WS simple pour s’assurer que la couche TLS et upgrade WS fonctionnent.

OpenAI API Access : Clé API OpenAI stockée. Vérifiez qu’elle fonctionne (par ex. testez un appel REST trivial au modèle GPT-3 pour valider le key, ou utilisez l’endpoint de transcription audio non realtime en test). Pour GPT-Realtime, l’endpoint étant en bêta, assurez-vous d’avoir l’accès (éventuellement essayez avec l’exemple de code openai-realtime-beta).

OpenAI Model ID : Notez le paramètre model= à utiliser dans l’URL WS. S’il faut une version spécifique (ex. gpt-realtime vs gpt-4o-realtime-preview), configurez-le. Sur OpenAI public, probablement model=gpt-realtime fonctionne
learn.microsoft.com
, sur Azure, ce sera le deployment name.

OpenAI Settings : Choisissez la voix si souhaité (sinon défaut). Préparez le prompt système/instructions (par ex. “Parle en français, de manière polie et concise.” si nécessaire). Ce prompt pourra être envoyé via session.update initial.

Node.js env : Ayez installé les packages nécessaires :

ws pour implémenter le serveur WS Telnyx et client WS OpenAI,

éventuellement @openai/realtime-api-beta si vous voulez utiliser la lib (facultatif, pas obligatoire),

libs de traitement audio si utilisées (mulaw conversion, sox etc.).

Un framework web (Express, Fastify) pour les webhooks HTTP.

Firewall : Ouvrez le port 443 (ou celui choisi) pour les connexions entrantes Telnyx sur votre WS. Ouvrez les ports sortants vers OpenAI (443 aussi).

Testing numbers : Utilisez un vrai numéro destinataire test (le vôtre) pour valider le flux complet. Attention, si vous testez sur un téléphone mobile, utilisez de préférence un casque ou mettez le volume faible lors des tests pour éviter de créer un larsen ou que le micro du téléphone repasse la voix de l’IA à Telnyx (bouclage écho).

Logging : Activez des logs détaillés en dev (affichez chaque event reçu/emis sur Telnyx WS et OpenAI WS) pour faciliter le débogage.

Quota & Rate-limit : OpenAI a des limites de débit de requêtes ; monitorer les éventuelles erreurs 429. Telnyx a un rate-limit d’envoi média (1 par sec pour MP3, et environ 50/s pour RTP c’est ok). Assurez-vous de respecter cela (ne pas envoyer plus de ~1 message media par 20ms sur WS Telnyx).

Failover : Configurez la Webhook failover URL chez Telnyx pour redondance (peut pointer vers un second serveur).

Cleanup : Prévoir un mécanisme en cas d’appel abandonné/incomplet. Par ex., si OpenAI ne répond pas ou Telnyx call.failed, nettoyer et éventuellement réessayer plus tard ou notifier l’échec à l’utilisateur.

Cette checklist vous aide à éviter les erreurs de configuration courantes (ex. “Why no audio? – Oups, WS non accessible en wss://” ou “Telnyx refused call – OVP manquant”).

12. Plan de test audio (latence, perte, écho, silence) et validation

Une fois tout configuré, effectuez des tests approfondis :

Test de base – parcours heureux : Déclenchez un rappel vers votre propre téléphone. Vérifiez que :

vous entendez une réponse de l’IA (ex. salutations),

l’IA comprend ce que vous dites (réponses cohérentes),

la conversation peut enchaîner sur plusieurs tours.
Mesurez la latence entre la fin de votre question et le début de réponse de l’IA. Cela devrait idéalement être de l’ordre de 1 seconde ou moins. Si c’est beaucoup plus (plus de 2-3 sec), il peut y avoir un problème de traitement ou un paramètre mal réglé (logs d’OpenAI utiles pour voir si la transcription traîne, etc.).

Qualité audio : Évaluez si la voix de l’IA est intelligible par téléphone. En μ-law 8k, elle devrait être similaire à une voix humaine au téléphone (quoique synthétique). En PCM 16k → G.722 potentiellement, si vous appelez d’un mobile récent, vous pourriez percevoir plus de clarté. Assurez-vous qu’il n’y a pas de distorsion majeure, de son haché ou accéléré. Si vous entendez du “slow/low audio”, c’est souvent un problème de sample rate mal converti (ex. jouer un 24kHz comme du 8kHz donne une voix lente et grave). Dans ce cas, vérifiez votre pipeline de conversion, un resampling manquant ou un mauvais codec (ce type de problème a été signalé par des développeurs qui n’avaient pas converti du 24k audio et obtenaient une voix ralentie
community.openai.com
).

Écho : Normalement, l’infrastructure téléphonique a de l’écho cancellation. Toutefois, si le volume de l’IA est trop fort et que votre micro de téléphone le reprend, Telnyx pourrait renvoyer l’écho à OpenAI. OpenAI pourrait alors entendre sa propre voix et potentiellement répondre à côté (“pardon je n’ai pas compris” – parlant en fait à elle-même!). Pour tester, montez le volume et voyez si l’IA se met à confondre sa voix. Si oui, vous pourriez implémenter un traitement anti-écho : par exemple, couper temporairement le flux inbound Telnyx pendant que vous envoyez l’audio de l’IA (demi-duplex). Telnyx ne propose pas nativement d’annulation d’écho sur Media Streams, c’est à gérer côté OpenAI ou application. Vous pouvez peut-être atténuer l’entrée micro via OpenAI (ils n’offrent pas de param direct, mais vous pourriez couper l’envoi de paquets Telnyx quand vous savez que c’est l’IA qui parle). Ce point est complexe ; l’idéal est que l’utilisateur utilise le combiné ou un bon écho cancellation naturel.

Silence et VAD : Testez en ne parlant pas du tout après connexion. OpenAI devrait ne rien faire tant qu’il n’entend rien. Au bout d’un certain temps, vous pouvez décider de raccrocher automatiquement (par ex. si 30 sec de silence). Testez aussi en parlant très brièvement, ou en faisant des pauses longues au milieu de phrases. Vérifiez que OpenAI ne coupe pas la parole trop vite. Vous pouvez ajuster la sensibilité du VAD côté OpenAI si exposé (paramètre éventuellement disponible).

Interruption : Parlez par-dessus la voix de l’IA délibérément pour voir le comportement. C’est un cas extrême. Par défaut, l’IA ne s’arrêtera pas seule. Telnyx toutefois continuera d’envoyer votre voix. OpenAI aura deux flux concurrents (pas bien gérés actuellement). En général, ce test montrera que l’IA continue et ne vous entend pas en même temps. Il faudrait implémenter un stop manuel si c’était critique, mais souvent on accepte de ne pas gérer l’interruption.

Perte de paquets / Jitter : Étant en TCP (WebSocket sur TLS sur TCP), les pertes de paquets réseau se manifestent plutôt par de la latence qu’une vraie perte audio. Simulez éventuellement une dégradation : utilisez un outil pour ralentir la connexion ou provoquer du jitter. Voyez si l’audio arrive haché ou en rafale. Telnyx fournit des stats de qualité dans call.hangup (MOS, jitter)
developers.telnyx.com
, consultez-les après un test, surtout en conditions dégradées. Si MOS très bas (<3), c’est signe de problème réseau. Votre application n’y peut pas grand-chose, mais c’est bon de monitorer.

Durée : Testez un appel de longue durée (plusieurs minutes). Assurez-vous qu’aucune fuite de mémoire ne se produit (observer l’usage mémoire du process Node). Telnyx envoie régulièrement des paquets RTCP pour garder l’appel (à moins que vous ayez désactivé “hang-up on timeout” ou mis un temps très long). Un appel inactif pourrait se terminer selon la config Telnyx (paramètre “timeout” mentionné section 1). Vous pouvez le régler plus haut si besoin.

Multi-utilisateurs : Simulez deux appels simultanés (si possible, appelez deux téléphones ou deux testeurs). Vérifiez que votre serveur gère bien deux sessions en parallèle sans interférences (chaque WS Telnyx envoie à la bonne WS OpenAI). Monitorer CPU à 2 appels, 5 appels, etc., pour planifier la capacité.

Scénarios conversationnels : Posez diverses questions à l’IA, y compris des cas difficiles ou hors sujet, pour voir comment elle répond. Assurez-vous qu’elle respecte bien vos instructions (si vous lui avez dit de se nommer d’une certaine façon ou de ne pas dire certaines choses). Cela permet de valider la couche GPT plus que la technique, mais c’est important dans un test bout en bout.

Edge cases Telnyx : Appelez et ne décrochez pas (voir comment l’appel est annulé, vous devriez recevoir un call.hangup avec cause timeout). Appelez un répondeur, voyez si vous avez activé AMD ou pas. Ici on n’a pas mis de Answering Machine Detection, donc l’IA pourrait parler à un répondeur – évaluez si c’est un souci (sinon, Telnyx propose AMD en option pour détecter les répondeurs).

Pour chaque test, collectez les logs et ajustez les paramètres. Par exemple, si la latence est un peu haute, vous pourriez réduire la taille des chunks audio IA (peut-être envoyer plus fréquemment des petits paquets, au risque d’overhead – à tuner). Si la qualité est mauvaise, vérifiez le codec utilisé ou essayez une autre option (OPUS 16k par ex., en gardant conversion).

Validation finale : Un test complet consiste à avoir une conversation de bout en bout avec l’IA où elle répond correctement et l’expérience utilisateur est fluide. Une fois obtenu, documentez ces résultats et passez en production en surveillant en continu la qualité des appels (Telnyx offre des metrics appel par appel, OpenAI aura la facturation par durée d’audio transcrit/généré pour vérifier les coûts).

13. Exemples de code Node.js pour les étapes critiques

Nous fournissons ci-dessous des extraits de code Node.js illustrant les étapes clés. Ils sont simplifiés pour lisibilité ; il faudra les intégrer dans une architecture robuste (gestion d’erreurs, contextes par appel, etc.).

(a) Lancement d’un appel Telnyx (HTTP REST) – Utilisation du module axios pour envoyer la requête POST d’appel sortant avec Media Streams :

const axios = require('axios');
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
async function startCall(toNumber) {
  const payload = {
    connection_id: TELNYX_CONNECTION_ID,
    to: toNumber,
    from: TELNYX_NUMBER,
    stream_url: `wss://myserver.com/media?token=${generateToken()}`,
    stream_track: 'inbound_track',
    stream_bidirectional_mode: 'rtp',
    stream_bidirectional_codec: 'PCMU'  // ou 'L16'
  };
  const res = await axios.post('https://api.telnyx.com/v2/calls', payload, {
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` }
  });
  console.log('Call initiated, Telnyx response:', res.data);
  return res.data.data.call_control_id;
}


Ici, TELNYX_CONNECTION_ID est l’ID de l’application (ex: "1684641123236054244"), TELNYX_NUMBER votre numéro format +E.164. La fonction generateToken() génère un token unique (stocké quelque part pour vérifier la connexion WS entrante). Après l’appel, on loggue la réponse qui contient call_control_id. (En situation réelle, on attendrait peut-être le webhook call.answered avant de continuer, voir plus bas.)

(b) Démarrage du WebSocket server Telnyx – Utilisation de la bibliothèque ws pour écouter les connexions sur /media (via un serveur HTTPS Node). Supposons qu’on ait déjà un serveur HTTPS httpServer (par ex. créé avec Express). On le passe à WebSocket.Server :

const WebSocket = require('ws');
const wssTelnyx = new WebSocket.Server({ server: httpServer, path: '/media' });

wssTelnyx.on('connection', (ws, req) => {
  // Authentifier via token dans l’URL
  const params = new URLSearchParams(req.url.split('?')[1]);
  const token = params.get('token');
  if (!isTokenValid(token)) {
    console.log('WS Telnyx invalid token, closing');
    ws.close();
    return;
  }
  console.log('Telnyx WS connected');

  ws.on('message', (msg) => {
    // Telnyx envoie du texte JSON
    let data;
    try { data = JSON.parse(msg); } catch(e) { 
      console.error('Invalid Telnyx WS message', e);
      return;
    }
    if (data.event === 'media' && data.media && data.media.payload) {
      // Audio entrant de Telnyx
      const payload = data.media.payload;
      const audioBuf = Buffer.from(payload, 'base64');
      handleInboundAudio(ws, audioBuf); // on traite plus loin
    } else if (data.event === 'start') {
      console.log(`Media stream started: codec=${data.start.media_format.encoding}`);
    } else if (data.event === 'stop') {
      console.log('Media stream stopped');
      // Telnyx va probablement fermer le WS juste après
    }
    // (gérer d'autres events comme dtmf si besoin)
  });

  ws.on('close', () => {
    console.log('Telnyx WS disconnected');
    // Optionnel: nettoyer état, fermer WS OpenAI associé
  });
});


Ici on utilise path: '/media' et on extrait le token. On appelle une fonction handleInboundAudio(ws, audioBuf) pour traiter l’audio entrant (transmettre à OpenAI). On loggue start et stop. Note : ws ici représente la connexion spécifique pour un appel; si plusieurs appels, on aura plusieurs instances. Il faudra faire le lien avec la connexion OpenAI correspondante. Une approche est de stocker un objet contexte, par ex. ws.callId = ... ou maintenir un Map de callId -> { wsTelnyx, wsOpenAI }.

(c) Connexion au WebSocket OpenAI et envoi config :

const openAIWS = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
  headers: { 
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Organization': ORG_ID  // si applicable, ou Beta header si requis
  }
});

openAIWS.on('open', () => {
  console.log('OpenAI WS connected');
  // Envoyer configuration de session
  const sessionConfig = {
    type: 'session.update',
    session: {
      input_audio_format: 'pcmu',  // g711 μ-law
      output_audio_format: 'pcmu',
      input_audio_transcription: { model: 'whisper-1' },
      // voice: 'alloy',  // choisir une voix si on veut
      // instructions: 'Réponds poliment à l\'utilisateur.' 
    }
  };
  openAIWS.send(JSON.stringify(sessionConfig));
});

// Recevoir messages OpenAI
openAIWS.on('message', (msg) => {
  if (typeof msg === 'string') {
    const data = JSON.parse(msg);
    if (data.type === 'response.audio.delta' && data.audio !== undefined) {
      // OpenAI audio chunk in JSON
      let audioBuf;
      if (Array.isArray(data.audio)) {
        // audio en tableau d'int16
        audioBuf = Int16Array.from(data.audio).buffer;
        audioBuf = Buffer.from(audioBuf);
      } else if (typeof data.audio === 'string') {
        // audio en base64
        audioBuf = Buffer.from(data.audio, 'base64');
      }
      if (audioBuf) {
        handleOutboundAudio(callId, audioBuf);
      }
    } else if (data.type === 'response.audio_transcript.delta') {
      const txt = data.transcripts?.[0];
      console.log('Partial transcript:', txt);
    } else if (data.type === 'response.audio_transcript.done') {
      const finalTxt = data.transcripts?.[0];
      console.log('Transcription finale:', finalTxt);
    } else if (data.type === 'response.output_item.done') {
      console.log('IA finished speaking this turn.');
      // Optionnel: marquer qu’on peut reprendre l’écoute utilisateur 
    }
  } else {
    // Binary message (selon design OpenAI, on pourrait recevoir audio direct)
    const audioBuf = Buffer.from(msg);
    handleOutboundAudio(callId, audioBuf);
  }
});


Dans cet extrait, on ouvre la WS OpenAI, on envoie le session.update avec config (ici 'pcmu' pour μ-law – note: parfois c’est 'g711_ulaw', à vérifier selon doc, mais on suppose 'pcmu' alias). On écoute les messages : s’ils sont texte, on parse. On distingue le type. Pour response.audio.delta, on extrait l’audio. OpenAI peut fournir data.audio sous forme d’Int16Array (selon leur client JS) ou base64. On gère les deux. Puis on appelle handleOutboundAudio(callId, audioBuf). Il faudra savoir à quel appel rattacher ce message – ici l’exemple suppose que vous avez lié le openAIWS à un callId ou un contexte. Possibly vous avez closuré le callId lors de la création du openAIWS.

handleOutboundAudio(callId, audioBuf) devra retrouver le WS Telnyx de cet appel et lui envoyer le buffer encodé base64 dans un message media.

(d) Envoi d’audio vers Telnyx (Outbound vers utilisateur) :

function handleOutboundAudio(callId, audioBuf) {
  // Récupérer WS Telnyx de cet appel
  const wsTelnyx = callIdToTelnyxWS.get(callId);
  if (!wsTelnyx || wsTelnyx.readyState !== WebSocket.OPEN) {
    console.error('Telnyx WS not available for call', callId);
    return;
  }
  // Si nécessaire: transcodage audioBuf du format OpenAI->Telnyx
  // (ex: si PCM -> mu-law, convertir ici)
  const payloadBase64 = audioBuf.toString('base64');
  const msg = JSON.stringify({ event: 'media', media: { payload: payloadBase64 } });
  wsTelnyx.send(msg, (err) => { if (err) console.error('Send Telnyx WS err', err); });
}


Ceci est appelé à chaque chunk IA. On suppose une Map callIdToTelnyxWS maintenue. L’envoi se fait simplement comme décrit auparavant. Veiller à gérer le cas où le WS Telnyx est fermé (ne pas envoyer, ça éviterait une exception).

(e) Envoi audio vers OpenAI (Inbound utilisateur) : C’est l’inverse, appelé dans handleInboundAudio(wsTelnyx, audioBuf) plus haut :

function handleInboundAudio(wsTelnyx, audioBuf) {
  const callId = telnyxWsToCallId.get(wsTelnyx);
  const openAIWS = callIdToOpenAiWS.get(callId);
  if (!openAIWS || openAIWS.readyState !== WebSocket.OPEN) {
    return console.error('OpenAI WS not ready for call', callId);
  }
  // Si nécessaire: transcodage audioBuf format Telnyx->OpenAI
  // (ex: mu-law->PCM, endianness swap, resample)
  openAIWS.send(audioBuf, (err) => { if (err) console.error('Send OpenAI WS err', err); });
}


Ici on récupère le lien callId ↔ openAIWS pour envoyer les bytes audio. Aucune transformation si on a calibré les formats. Si on devait transformer, par ex. de μ-law vers PCM16, on appellerait une fonction de conversion sur audioBuf avant openAIWS.send.

(f) Gestion de fin d’appel : Par exemple, sur webhook call.hangup (reçu via Express route), ou sur événement WS Telnyx close, on veut fermer OpenAI WS :

app.post('/webhook', express.json(), (req, res) => {
  const event = req.body.data;
  if (event.event_type === 'call.hangup') {
    const callId = event.payload.call_control_id;
    console.log(`Call ${callId} ended, cause: ${event.payload.hangup_cause}`);
    // Fermer WS OpenAI associé
    const openAIWS = callIdToOpenAiWS.get(callId);
    if (openAIWS) openAIWS.close();
    // Fermer WS Telnyx - Telnyx l'a sans doute déjà fermé de son côté
    const telnyxWS = callIdToTelnyxWS.get(callId);
    if (telnyxWS) telnyxWS.close();
    // Cleanup maps
    callIdToOpenAiWS.delete(callId);
    callIdToTelnyxWS.delete(callId);
    telnyxWsToCallId.delete(telnyxWS);
  }
  res.sendStatus(200);
});


On suppose que callIdToTelnyxWS etc. sont des Maps globales. Vous aurez construit ces maps au moment de call.answered ou connection en liant tout ensemble. Ce code assure qu’on ferme bien ce qui reste ouvert.

Ce sont des exemples modulaires. Dans une implémentation réelle, on gérerait mieux le couplage callId ↔ websockets, potentiellement en créant une classe ou structure par session d’appel.

14. Schéma de séquence général (du landing page au fin d’appel)

Décrivons le scénario complet sous forme de séquence pour bien comprendre chaque interaction entre les composants :

1. Utilisateur clique “Rappelez-moi” sur le site.
– Son navigateur envoie une requête à votre backend (par ex. via REST API /call). Il peut fournir son numéro de téléphone et peut-être un identifiant de demande.

2. Backend Node.js initie l’appel via Telnyx.
– Votre serveur reçoit la demande, génère éventuellement un token pour WS, puis appelle POST /v2/calls de Telnyx
developers.telnyx.com
 avec les paramètres (numéro de l’utilisateur en to, votre numéro en from, etc.).
– Telnyx renvoie immédiatement une réponse d’acceptation contenant call_control_id. Votre backend répond au navigateur (par ex. “Appel en cours, vous allez recevoir un appel.”).

3. Telnyx appelle le numéro de l’utilisateur.
– La plateforme Telnyx sortante compose le numéro de téléphone. L’utilisateur voit un appel entrant (votre numéro Telnyx).
– En parallèle, Telnyx ouvre une connexion WebSocket vers stream_url spécifié. Votre serveur WS accepte la connexion (après avoir validé le token). -> (Point A) sur le diagramme.
– Telnyx envoie sur ce WS un event connected puis attend que l’appel soit effectivement établi.

4. L’utilisateur décroche le téléphone.
– Telnyx détecte que l’appel est answer. Il envoie un webhook HTTP call.answered à votre serveur
developers.telnyx.com
 -> (Point B).
– Telnyx envoie aussi sur le WS média l’événement start avec format audio
developers.telnyx.com
 -> (Point C).
– À ce moment, la communication audio est ouverte mais l’IA n’a pas encore été lancée. L’utilisateur peut dire “Allô ?” – ces quelques premières vibrations vocales arrivent sur le WS Telnyx en events media. Si votre OpenAI WS n’est pas encore prêt, vous pourriez bufferiser brièvement.

5. Backend établit la connexion OpenAI.
– Suite au call.answered (ou vous auriez pu le faire dès call.initiated pour gagner du temps), votre serveur ouvre le WebSocket client vers OpenAI
evilmartians.com
 -> (Point D).
– La connexion s’établit, vous envoyez session.update (config codec, etc.)
evilmartians.com
.
– Vous pourriez aussi envoyer un premier prompt d’instruction ou même un message utilisateur initial si besoin (ex. si vous voulez que l’IA commence la conversation sans attendre que l’utilisateur parle, vous enverriez une sendUserMessageContent comme dans l’exemple WorkAdventure
docs.workadventu.re
). Dans notre cas, on suppose que l’appelant parle d’abord.

6. L’utilisateur parle, audio relayé vers OpenAI.
– Chaque fragment de parole de l’utilisateur (capture micro du téléphone) est envoyé par Telnyx sur le WS (media inbound) -> (Point E). Votre Node reçoit ces events continuellement.
– Pour chacun, il décode base64, convertit si besoin, et fait un openAIWS.send(binary) -> (Point F).
– OpenAI reçoit le flux audio utilisateur en direct. Il commence la transcription. Il envoie des events de transcription partiels que votre Node peut logguer -> (Point G), et après silence, un event transcription final. À ce stade, l’IA a le texte de la question.

7. L’IA génère sa réponse vocale.
– Dès que GPT a assez compris la question, il commence à formuler la réponse. Il envoie les premiers paquets audio de sa voix de synthèse -> (Point H) des events response.audio.delta.
– Votre Node les reçoit (par ex. Int16 PCM), il les convertit en base64 (ou autre encodage requis) et les envoie sur WS Telnyx -> (Point I). Telnyx les place en file immédiatement pour lecture.
– L’utilisateur commence à entendre la voix de l’IA. Pendant ce temps, OpenAI continue d’envoyer la suite de l’audio de réponse, chunk par chunk. Node transfère chaque chunk à Telnyx sans attendre, assurant un streaming fluide.
– Si l’utilisateur tente d’interrompre, Telnyx enverra la voix de l’utilisateur aussi. Selon votre implémentation, vous déciderez d’en tenir compte ou non. Par défaut, on laisse l’IA finir.

8. L’IA finit sa réponse.
– OpenAI envoie un event response.output_item.done que votre Node peut utiliser pour savoir que le tour est fini -> (Point J).
– Telnyx aura reçu le dernier paquet audio à jouer. Il joue jusqu’au bout. L’utilisateur entend la fin de la phrase.

9. Nouvel échange (boucle).
– Maintenant l’utilisateur parle à nouveau en réaction à la réponse. Retour à l’étape 6. Le cycle se répète pour chaque tour de conversation. Pendant ce temps, Telnyx maintient l’appel actif.

10. Fin de l’appel.
– Soit l’utilisateur raccroche (par ex. en appuyant sur terminer appel), soit votre application décide de couper (vous pouvez faire un hangup via API Telnyx).
– Imaginons que l’utilisateur raccroche. Telnyx détecte la fin et envoie call.hangup webhook -> (Point K).
– Telnyx envoie aussi sur le WS media un event stop puis ferme la connexion WS -> (Point L).
– Votre Node, via le webhook, ferme la WS OpenAI -> (Point M).
– Tout est terminé. Vous pouvez éventuellement consigner la conversation (transcriptions, etc. récupérables via vos logs).

Pour récapituler simplement :

Landing Page → (HTTP demande) → Backend Node (init call) → (API Call) → Telnyx (call) → (rings user, opens WS) → Node WS srv → (answered) → Node opens WS OpenAI → (audio flows user→Telnyx WS→Node→OpenAI WS, and AI→Node→Telnyx WS→user) in loop → (hangup) → Node closes OpenAI WS.

Ce schéma garantit que du premier contact utilisateur (clic) jusqu’à la fin de l’appel, chaque composant interagit au bon moment. Il est recommandé de dessiner un diagramme de séquence visuel reprenant ces points pour l’équipe, mais la description ci-dessus en couvre les étapes majeures.

15. Annexes – Documentation Telnyx et OpenAI (sources)

Pour référence future, voici quelques extraits utiles de la documentation officielle utilisés dans ce rapport :

Telnyx – Media Streaming via Call Control (API v2) : “The requesting dial command can be extended to request streaming using WebSockets”
developers.telnyx.com
developers.telnyx.com
. Telnyx montre l’ajout de stream_url et stream_track dans la requête d’appel. De même, l’exemple de answer avec streaming
developers.telnyx.com
developers.telnyx.com
. La doc détaille les events envoyés sur le WebSocket : “When the WebSocket connection is established, the following event is being sent: {"event": "connected", "version": "1.0.0"}”
developers.telnyx.com
, puis “An event over WebSockets which contains ... media_format ... {"event": "start", ... "media_format": {"encoding": "PCMU", "sample_rate": 8000, "channels": 1}}”
developers.telnyx.com
developers.telnyx.com
. Chaque paquet audio : “The payload contains a base64-encoded RTP payload (no headers).”
developers.telnyx.com
. En envoi : “The RTP stream can be sent to the call using websocket ... send { "event": "media", "media": {"payload": "<base64 RTP>"} }”
developers.telnyx.com
, “Provided chunks of audio can be in a size of 20 milliseconds to 30 seconds.”
developers.telnyx.com
. Codecs supportés : “PCMU, PCMA (8k), G722 (8k), OPUS (8k,16k), AMR-WB (8k,16k), L16 (16k)”
developers.telnyx.com
. Avantage L16 : “eliminating transcoding overhead when interfacing with many AI platforms that natively support linear PCM audio.”
developers.telnyx.com
.

Telnyx – Webhooks et events : Exemples de payloads v2 : call.initiated
developers.telnyx.com
, call.answered
developers.telnyx.com
, call.hangup avec cause et stats
developers.telnyx.com
developers.telnyx.com
. Events streaming webhooks: streaming.started
developers.telnyx.com
, streaming.stopped
developers.telnyx.com
. Events WS: dtmf example
developers.telnyx.com
, error codes
developers.telnyx.com
.

OpenAI – Realtime API : Bien que la documentation OpenAI soit en évolution, on note l’existence de l’API temps réel permettant du voice-to-voice. Azure OpenAI résume : “GPT real-time models... support low-latency speech in, speech out... via WebRTC or WebSocket”
learn.microsoft.com
. L’endpoint est sécurisé wss avec query model=
learn.microsoft.com
. L’échange se fait via events JSON : “Events can be sent and received in parallel ... events each take the form of a JSON object.”
learn.microsoft.com
learn.microsoft.com
. Le guide WorkAdventure indique : “audio chunks sent by Realtime API are PCM16 at 24kHz, 1 channel, little-endian”
docs.workadventu.re
, et comment convertir en float pour lecture. Concernant l’API Node beta : “npm install openai/openai-realtime-api-beta” et usage du RealtimeClient, mais nous avons opté pour l’approche bas-niveau.

Evil Martians (Twilio + OpenAI blog) : Ce billet illustre une intégration similaire. On y voit la connexion WS OpenAI avec config : "input_audio_format": "g711_ulaw", "output_audio_format": "g711_ulaw", "input_audio_transcription": {"model":"whisper-1"} envoyé juste après dial
evilmartians.com
. Les types d’events OpenAI gérés: response.audio.delta, response.audio_transcript.delta, etc.
evilmartians.com
evilmartians.com
, et la manière de router ces events vers Twilio. Cela corrobore notre stratégie pour Telnyx.

En cas de doute, référez-vous aux docs officielles citées ci-dessus pour les détails d’implémentation. Ce rapport étant conçu pour être exhaustif, il devrait vous éviter d’avoir à y retourner fréquemment, mais il est toujours bon de vérifier les mises à jour de la documentation Telnyx et OpenAI, ces services évoluant rapidement.

Enfin, en combinant les informations de ce rapport, vous devriez disposer d’une feuille de route complète pour reconstruire de zéro votre service de rappel téléphonique automatisé utilisant Telnyx pour la couche téléphonie et GPT-Realtime d’OpenAI pour l’intelligence vocale. Bonne implémentation ! Rappel téléphonique automatisé avec Telnyx et OpenAI GPT-Realtime – Rapport technique
1. Configuration d’une application Telnyx Voice API (Media Streams WebSocket)

Pour utiliser la Voice API v2 de Telnyx, commencez par créer une Voice API Application (application de contrôle d’appel) depuis le portail Telnyx
developers.telnyx.com
. Cette application définira le comportement des appels et permettra la diffusion du média en temps réel. Lors de la création :

Nom de l’application – Donnez un nom descriptif (par ex. “Callback AI”).

Webhook URL (événements d’appel) – Indiquez l’URL publique de votre serveur (Node.js) qui recevra les webhooks Telnyx (événements comme call.initiated, call.answered, etc.)
developers.telnyx.com
. Utilisez HTTPS (Telnyx exige un schéma https://). Assurez-vous d’opter pour l’API V2 des webhooks (format v2 recommandé)
developers.telnyx.com
. Cette URL de webhook n’a pas de lien avec le flux audio ; elle sert uniquement aux notifications d’état d’appel.

Ancrage de site (Anchor site) – Laissez par défaut (“latency”) pour que Telnyx choisisse automatiquement le point de présence optimal afin de minimiser la latence média
developers.telnyx.com
.

Timeout de commande – Activez éventuellement “Hang-up on timeout” avec un délai si vous voulez que Telnyx raccroche si votre application ne répond pas aux webhooks dans un temps imparti
developers.telnyx.com
.

Une fois l’application créée, assignez un numéro de téléphone à cette application dans l’onglet “Numbers” pour les appels entrants (si nécessaire)
developers.telnyx.com
. Pour notre cas de rappel sortant, le numéro sera principalement utilisé en tant qu’identifiant d’appelant (from), mais lier le numéro à l’application garantit que Telnyx saura utiliser cette application pour tout appel impliquant ce numéro
developers.telnyx.com
.

⚠ Distinction TeXML : Telnyx propose deux approches de contrôle d’appels : les applications Voice API (Call Control API v2, orientées API/JSON) et les applications TeXML (basées sur un XML de pilotage, similaire à TwiML). Ici, nous utilisons la Voice API v2 et non TeXML, car elle permet le streaming audio WebSocket. Veillez donc à créer une “Voice API Application” (parfois appelée Call Control App) et non une application TeXML. Dans la console Telnyx, cela signifie choisir l’option “Programmable Voice API” lors de la configuration de l’application
telnyx.com
.

2. Paramétrage de l’Outbound Voice Profile et mapping avec l’application

Telnyx requiert un Outbound Voice Profile (OVP) pour émettre des appels sortants. Ce profil définit les réglages de terminaison d’appel (plan de tarification, destinations autorisées, limite de canaux, etc.)
support.telnyx.com
support.telnyx.com
. Créez un OVP dans le portail Telnyx (menu Outbound Voice Profiles). Donnez-lui un nom (p.ex. “Profile Rappel AI”) et configurez au minimum :

Destinations autorisées – Sélectionnez les pays ou régions vers lesquels les appels peuvent être émis
support.telnyx.com
 (ajustez selon votre cas d’usage). Pour des appels nationaux standard, cette étape peut être minimale, mais pour des appels internationaux, assurez-vous d’inclure les pays requis.

Méthode de facturation – Laissez “Rate Deck” par défaut (tarification par préfixe)
support.telnyx.com
.

Limite de canaux sortants – Vous pouvez restreindre le nombre d’appels simultanés sur ce profil (par ex. limiter à 1 si vous ne voulez qu’un rappel à la fois durant les tests)
support.telnyx.com
.

Autres réglages – Par défaut, la limite de dépense quotidienne et l’enregistrement des appels sont désactivés, à configurer selon vos besoins. (Exemple : vous pouvez activer Record Outbound Calls pour enregistrer les appels sortants – choisir format WAV/MP3 et mono/stéréo
support.telnyx.com
 – mais cela n’est pas indispensable pour la fonctionnalité de rappel elle-même.)

Une fois l’OVP créé, assignez-le à votre application Voice API. Dans le profil, utilisez la section “Associated Connections and Applications” pour ajouter votre application (elle apparaîtra avec le label “APP” suivi de son nom)
support.telnyx.com
. Inversement, vous pouvez aussi ouvrir la configuration de l’application Voice API et sélectionner le Outbound Voice Profile correspondant dans les paramètres de sortie
developers.telnyx.com
. Cette association est obligatoire pour autoriser les appels sortants via l’application
support.telnyx.com
. Sans profil de sortie assigné, toute tentative d’appel sortant sera bloquée par Telnyx.

Enfin, notez le Connection ID / Application ID de votre application (identifiant unique) : il sera nécessaire pour initier les appels via l’API
support.telnyx.com
. Dans la console, l’ID de l’application apparaît dans les détails de l’application une fois créée.

3. Format audio des flux Telnyx Media Streams (codec, échantillonnage, format)

Telnyx Media Streams fournit le son de l’appel en temps réel via WebSocket, sous forme de paquets audio encodés. Par défaut, l’audio est encodé en PCMU (G.711 μ-law) à 8 kHz, mono
developers.telnyx.com
developers.telnyx.com
. Telnyx supporte plusieurs codecs pour le streaming bidirectionnel :

PCMU (G.711 μ-law), 8 kHz (par défaut)
developers.telnyx.com

PCMA (G.711 A-law), 8 kHz
developers.telnyx.com

G.722, 8 kHz (codec wideband 50–7000 Hz souvent utilisé en VoIP HD)
developers.telnyx.com

OPUS, 8 kHz ou 16 kHz
developers.telnyx.com

AMR-WB, 8 kHz ou 16 kHz
developers.telnyx.com

L16 (PCM linéaire 16 bit), 16 kHz
developers.telnyx.com

Les flux Telnyx utilisent le protocole RTP sur WebSocket, mais Telnyx envoie uniquement la charge utile audio encodée, sans en-têtes RTP, encodée en base64 dans un JSON
developers.telnyx.com
developers.telnyx.com
. Concrètement, chaque message audio reçu sur le WebSocket Telnyx a la structure suivante :

{
  "event": "media",
  "sequence_number": "...",
  "media": {
    "track": "inbound", 
    "chunk": "2", 
    "timestamp": "5",
    "payload": "<données audio base64>"
  },
  "stream_id": "..."
}


Le champ payload contient les données audio brutes encodées en base64 (par exemple, des trames RTP G.711 sans en-tête)
developers.telnyx.com
. Chaque message correspond à un fragment temporel d’audio. Telnyx envoie typiquement des paquets de l’ordre de 20 ms chacun pour un flux en temps réel à faible latence (valeur commune pour RTP en téléphonie). Le numéro de chunk et le timestamp peuvent aider à réordonner si des paquets arrivent hors séquence, bien que l’ordre de livraison ne soit normalement pas garanti par Telnyx (s’appuyant sur TCP)
developers.telnyx.com
.

Conteneur et framing : Aucun conteneur de haut niveau (WAV, etc.) n’est utilisé. Les données sont brutes, continuees, et découpées en trames successives. Par exemple, en PCMU 8 kHz, une trame de 20 ms représente 160 échantillons codés sur 8 bits (soit 160 octets, encodés en base64 dans ~216 octets JSON). En L16 16 kHz, 20 ms représentent 320 échantillons PCM 16-bit (640 octets). Telnyx enveloppe chaque fragment audio dans un message JSON comme illustré ci-dessus.

Résumé format Telnyx : Codec (ex. PCMU), échantillonnage (8 kHz par défaut, ou jusqu’à 16 kHz avec codecs comme OPUS/L16), canaux (mono 1 canal)
developers.telnyx.com
, fragments (20 ms typiquement, encodés base64 dans des événements media). Aucune métadonnée audio (ex. taux de bits) n’est à gérer puisqu’on est en flux non compressé (ou compressé standard télécom).

4. Format audio de l’OpenAI GPT-Realtime via WebSocket (codec, sample rate, canaux)

L’API OpenAI Realtime (modèle GPT-Realtime) permet une interaction speech-to-speech en continu. Par défaut, OpenAI utilise du PCM 16 bits linéaire, 24 kHz, mono pour l’audio
docs.workadventu.re
. Concrètement, les chunks audio échangés sont en format PCM signé 16-bit little-endian (S16LE), 1 canal, échantillonnés à 24000 Hz.

Côté entrée (voix utilisateur vers OpenAI) : OpenAI attend normalement un flux audio PCM 24 kHz 16 bits. Ce flux est généralement envoyé sous forme binaire sur le WebSocket (chaque message binaire contenant un segment d’audio). Si l’audio fourni n’est pas en 24 kHz, OpenAI ne le traitera pas correctement – il faudra donc convertir ou informer l’API via la configuration de session (voir section compatibilité audio).

Côté sortie (voix générée par l’IA) : OpenAI génère des réponses audio également en PCM 16 bits 24 kHz par défaut. L’API envoie ces données par morceaux (streaming), permettant de commencer la lecture avant que la phrase complète ne soit produite. Par exemple, dès que l’IA commence à parler, des chunks audio (Int16) sont émis progressivement. Dans l’implémentation JavaScript côté client, on reçoit ces données sous forme de tableau d’entiers 16-bit, qu’il faut convertir en floats pour Web Audio
docs.workadventu.re
.

Taille de trame et latence : OpenAI ne documente pas explicitement la taille de chaque chunk envoyé. D’après les tests, les paquets audio de sortie peuvent correspondre à quelques dizaines de millisecondes chacun, selon le débit de génération du modèle. Le protocole étant optimisé pour la faible latence, OpenAI envoie l’audio dès qu’il est disponible, par petits incréments.

Configuration personnalisée : L’API GPT-Realtime permet de changer le format audio via des paramètres de session. Par exemple, on peut demander du PCM 16 kHz au lieu de 24 kHz, ou du G.711, afin de faciliter l’interfaçage avec une source externe. Ceci se fait en envoyant un message de type session.update après l’ouverture du WebSocket, avec des champs input_audio_format et output_audio_format appropriés
evilmartians.com
. Les valeurs supportées incluent notamment :

"pcm_s16le_16000" – PCM 16 kHz 16-bit little-endian
community.openai.com

"pcm_s16le_24000" – (valeur par défaut implicite, 24 kHz)

"g711_ulaw" – G.711 μ-law 8 kHz
evilmartians.com

"g711_alaw" – G.711 A-law 8 kHz (supporté également d’après la documentation OpenAI)

En outre, on peut configurer d’autres paramètres via session.update : par ex. choisir le modèle de transcription (ex. whisper-1 pour la reconnaissance vocale entrante)
evilmartians.com
, activer la détection de fin de parole (Voice Activity Detection, mode server_vad par défaut), ou sélectionner une voix spécifique pour la synthèse vocale de sortie (OpenAI propose plusieurs voix pré-entraînées, telles que “alloy” utilisée dans certains exemples
docs.workadventu.re
docs.workadventu.re
).

Résumé format OpenAI : Codec : PCM 16 bits (sauf configuration contraire), sample rate : 24000 Hz par défaut (peut être ajusté à 16000 Hz), canaux : mono. Les données transitent généralement en binaire (suite d’octets PCM) sur le WebSocket. Si on utilise la librairie OpenAI Realtime, elle nous fournit directement les tableaux Int16 en sortie et gère l’envoi en entrée.

5. Compatibilité audio Telnyx ↔ OpenAI et transcodage dans le bridge

Étant donné les formats ci-dessus, il est crucial d’aligner le format audio entre Telnyx et OpenAI pour éviter toute distorsion ou absence de son. Voici un tableau des correspondances possibles et des ajustements nécessaires :

Option A : G.711 μ-law 8 kHz des deux côtés. Telnyx utilise par défaut PCMU 8 kHz, et OpenAI peut être configuré pour accepter et produire du g711_ulaw (8 kHz). Avantage : aucun transcodage lourd côté Node – on peut relayer les données quasi directement. Inconvénient : qualité téléphonique standard (bande étroite), pouvant réduire la précision de reconnaissance et la qualité vocale de l’IA. Néanmoins, OpenAI a prévu ce cas et sait gérer du μ-law. Pour activer ce mode, envoyez {"type": "session.update", "session": {"input_audio_format": "g711_ulaw", "output_audio_format": "g711_ulaw", ...}} juste après la connexion au WebSocket OpenAI
evilmartians.com
. Ainsi, le bridge Node.js n’a qu’à décoder le base64 de Telnyx (obtenant les octets G.711) et les envoyer tels quels en binaire à OpenAI, puis prendre les octets G.711 en sortie d’OpenAI et les renvoyer en base64 à Telnyx. Pas de resampling, pas de conversion d’échantillonnage – juste un décodage/encodage base64 et éventuellement un remaniement d’enveloppe JSON. (Telnyx et OpenAI traitent le μ-law comme flux audio compressé standard.)
evilmartians.com

Option B : PCM linéaire 16 kHz. Pour améliorer la qualité, on peut configurer Telnyx en L16 16 kHz (codec PCM 16 bits)
developers.telnyx.com
 et configurer OpenAI en PCM 16 kHz (pcm_s16le_16000) pour l’entrée et la sortie
community.openai.com
. Ainsi, la qualité audio est large bande (16 kHz) avec moins de pertes. Avantage : meilleure précision de transcription potentielle et voix de synthèse plus claire (bien que limitée à 8 kHz de bande passante si l’appel PSTN ne supporte pas le HD). Inconvénient : cela nécessite une conversion légère car Telnyx transmettra du PCM 16 kHz en big-endian (RTP standard) alors qu’OpenAI attend du little-endian. Le Node.js devra donc réordonner les octets de chaque échantillon (swap du byte high/low de chaque entier 16-bit). C’est une opération peu coûteuse en CPU. Pas de resampling requis si les deux sont à 16000 Hz, on ajuste juste l’endian-ness. (À vérifier : Telnyx ne documente pas explicitement l’endianness de L16, mais le RTP standard étant big-endian, on peut supposer qu’il faille convertir en little-endian pour OpenAI). Cette option élimine toute compression, au bénéfice d’une latence potentiellement légèrement moindre et d’une intégration propre avec de nombreux moteurs AI (Telnyx souligne que L16 évite les conversions inutiles avec les plateformes IA)
developers.telnyx.com
.

Option C : PCM 16 kHz ↔ PCM 24 kHz (resampling). Si on souhaite utiliser le format par défaut d’OpenAI (24 kHz PCM) tout en maximisant la qualité, on peut configurer Telnyx en L16 16 kHz et résampler audio en temps réel de 16 kHz vers 24 kHz (en entrée vers OpenAI) et de 24 kHz vers 16 kHz (en sortie vers Telnyx). Avantage : l’IA travaille à son taux optimal (24 kHz) pour la synthèse vocale, potentiellement une voix un peu plus naturelle. Inconvénient : le resampling temps réel est consommateur de CPU et ajoute un poil de latence. De plus, l’audio provient d’une ligne téléphonique 8 kHz réelle, donc passer à 24 kHz n’apporte pas de nouvelles informations (juste des échantillons interpolés). Cette solution peut donc être superflue, sauf si OpenAI n’acceptait pas d’autres taux (mais il accepte 16 kHz comme vu). À n’utiliser que si, pour une raison spécifique, vous ne pouvez pas configurer OpenAI autrement. Si vous deviez le faire, envisagez l’utilisation de bibliothèques optimisées (par ex. SoX, ffmpeg ou un module Node natif comme sox-audio ou praat pour le resampling polyphase).

Option D : Opus 16 kHz. Telnyx et OpenAI supportent le codec Opus (Telnyx via OPUS 16 kHz
developers.telnyx.com
, OpenAI via WebRTC natif). Cependant, via WebSocket OpenAI, il n’est pas documenté que l’on puisse envoyer directement de l’Opus. OpenAI recommande WebRTC si on veut profiter d’Opus (faible bande passante)
learn.microsoft.com
learn.microsoft.com
. L’implémentation par WebSocket, elle, est pensée plutôt pour PCM ou G.711. Donc, à moins de passer sur une connexion WebRTC (complexifiant beaucoup le bridge), l’utilisation d’Opus nécessiterait que votre Node.js décode Opus de Telnyx puis envoie du PCM à OpenAI, ce qui annule l’intérêt. Conclusion : on évite Opus dans ce cas d’usage, sauf contrainte réseau extrême.

En résumé, la solution la plus simple est Option A (tout en G.711) ou Option B (tout en PCM 16 kHz), selon vos priorités entre simplicité et qualité. Option A minimise complètement le traitement : Telnyx et OpenAI échangent du μ-law 8 kHz que votre code transfère tel quel (après base64). Option B offre une meilleure qualité audio (et possiblement de compréhension IA) avec un coût de conversion très faible (changement d’endianness). Notez que la qualité finale sera de toute façon limitée par le téléphone de l’utilisateur : la plupart des appels classiques sont restreints à 8 kHz μ-law sur le réseau RTC. Certains appels mobile-HD ou VoLTE supportent du G.722 ou AMR-WB (wideband) – si Telnyx détecte un codec HD avec l’opérateur, utiliser L16 16 kHz permettra de ne pas dégrader ce flux HD (sinon, tout flux PSTN standard sera déjà en 8 kHz).

Recommandation : Utilisez de préférence L16 16k côté Telnyx et pcm_s16le_16000 côté OpenAI pour un compromis optimal entre qualité et complexité. Cela correspond aux suggestions de Telnyx pour les intégrations voix-IA (audio linéaire sans perte)
developers.telnyx.com
. Si toutefois vous constatez des problèmes de performance, la solution μ-law 8k fonctionnera de manière robuste également.

6. Exemple d’appel API Telnyx pour lancer un appel sortant avec Media Streams

Pour initier un appel de rappel automatisé, votre application Node.js devra appeler l’API Telnyx pour démarrer un appel sortant. L’endpoint à utiliser est POST https://api.telnyx.com/v2/calls 
developers.telnyx.com
. Vous devrez fournir dans le corps JSON toutes les informations nécessaires :

connection_id : l’ID de votre application Voice API Telnyx (identifiant de connexion/app obtenu lors de la config, cf. section 1)
developers.telnyx.com
.

to : le numéro de destination (numéro du client à rappeler) au format E.164, par ex. "+33123456789"
developers.telnyx.com
.

from : le numéro d’appelant, c’est-à-dire votre numéro Telnyx acheté, au format E.164 également
developers.telnyx.com
. Ce numéro doit être associé à l’application.

stream_url : l’URL wss:// de votre serveur WebSocket qui gérera le streaming média
developers.telnyx.com
. C’est l’URL où Telnyx enverra la voix de l’appel et attendra en retour l’audio à jouer. Exemple : "wss://api.mondomain.com/media" (doit être accessible publiquement en WS sécurisé).

stream_track : indique quelle voie audio streamer : "inbound_track", "outbound_track" ou "both_tracks"
developers.telnyx.com
. Pour une intégration avec un agent IA, il est courant d’écouter l’audio de l’appelant uniquement (inbound_track par défaut) et d’injecter des réponses. Cependant, pour un bridge full-duplex, vous pouvez choisir "both_tracks" afin de recevoir aussi l’audio sortant (par ex. utile si vous souhaitez éventuellement transcrire ce que l’IA dit ou vérifier ce qui a été envoyé).

stream_bidirectional_mode : pour activer l’audio bidirectionnel (envoi et réception via WebSocket), spécifiez "rtp"
developers.telnyx.com
developers.telnyx.com
. Sans ce paramètre, Telnyx n’enverra que le flux en écoute (mode “fork” unidirectionnel). "rtp" signifie qu’on utilisera le protocole RTP simulé pour injecter de l’audio en retour.

stream_bidirectional_codec : le codec à utiliser si on active le mode bidirectionnel. Choisissez parmi les codecs supportés (voir section 3) en fonction de la stratégie décidée
developers.telnyx.com
. Par ex., "PCMU" pour μ-law 8k, ou "L16" pour PCM 16k. Important : Ce codec doit être cohérent avec la configuration côté OpenAI/bridge (voir section 5). S’il diffère du codec négocié avec le réseau téléphonique, Telnyx effectuera une conversion avec risque de perte de qualité
developers.telnyx.com
. (Telnyx fait en sorte de transcoder si besoin, mais mieux vaut éviter : ex. si l’appel PSTN est en G.711 et que vous demandez L16, Telnyx convertira G.711→PCM16; cela ajoute un poil de latence et de distorsion, mais c’est généralement acceptable.)

Voici un exemple de requête cURL complète combinant ces éléments (valeurs fictives) :

curl -X POST "https://api.telnyx.com/v2/calls" \
  -H "Authorization: Bearer <TELNYX_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "connection_id": "1684641123236054244",
    "to": "+33612345678",
    "from": "+33123456789",
    "stream_url": "wss://ai.example.com/media-stream/abc123?token=XYZ",
    "stream_track": "inbound_track",
    "stream_bidirectional_mode": "rtp",
    "stream_bidirectional_codec": "PCMU"
  }'


Dans cet exemple, on initie un appel du +33 1 23 45 67 89 (votre numéro) vers le +33 6 12 34 56 78 (client). Le flux WebSocket ira vers wss://ai.example.com/media-stream/abc123?.... Notez l’ajout d’un paramètre token=XYZ dans l’URL : vous pouvez utiliser un jeton d’authentification (généré par votre app) pour sécuriser la connexion WS (Telnyx retransmettra la query string lors de la connexion). Nous y reviendrons en section 10 (sécurité).

Telnyx répondra à cet appel API avec un JSON contenant notamment un call_control_id (identifiant unique de l’appel)
developers.telnyx.com
. Conservez-le si vous comptez éventuellement contrôler l’appel par la suite (par ex. raccrocher manuellement via API, etc.), même si pour ce cas d’usage, ce n’est pas nécessaire car l’appel suivra son cours automatiquement.

Webhook d’initiation : Immédiatement après l’appel API réussi, Telnyx enverra un webhook call.initiated à votre URL (voir section 7) confirmant le début de l’appel
developers.telnyx.com
. Vous pouvez l’utiliser pour logguer ou lier l’appel à une session utilisateur côté application.

7. Structure des événements Telnyx (call.initiated, call.answered, media.start, media.stop, etc.)

Telnyx notifie votre application des changements d’état de l’appel via des webhooks HTTP (POST vers votre Webhook URL configuré). Chaque événement est envoyé au format JSON v2 contenant un champ event_type et un payload. Parallèlement, pour le streaming audio, des messages WebSocket spécifiques transitent sur la connexion media. Détaillons les principaux événements :

Événements d’appel (webhooks HTTP) :

call.initiated – Indique que l’appel a été initié (composition en cours). Le payload inclut l’ID de contrôle d’appel (call_control_id), l’ID de session, le numéro appelant (from), le numéro appelé (to), la direction (outgoing dans ce cas), et l’état (bridging lors de la sonnerie)
developers.telnyx.com
developers.telnyx.com
. Vous recevez ce webhook juste après votre requête d’appel sortant.

call.answered – Envoyé lorsque le destinataire a décroché. Le payload indique state: "answered" et fournit l’horodatage de début d’appel effectif
developers.telnyx.com
developers.telnyx.com
. À ce stade, la communication audio est établie. Dans notre contexte, la réception de call.answered signifie qu’on peut démarrer l’envoi du flux audio à OpenAI (si ce n’est pas déjà fait via déclenchement par media event, voir plus bas).

streaming.started – Cet événement confirme que Telnyx a bien établi la connexion de streaming vers votre WebSocket et a commencé à forker l’audio
developers.telnyx.com
developers.telnyx.com
. Le payload contient le call_control_id et l’URL du stream. Vous pouvez l’utiliser pour logguer ou vérifier que le WS audio a démarré. (Telnyx envoie généralement ce webhook juste après le call.answered si le streaming a été demandé dans la commande d’appel).

streaming.stopped – Indique que le streaming média a pris fin
developers.telnyx.com
developers.telnyx.com
, généralement lorsque l’appel se termine ou que vous arrêtez le stream. Payload semblable à streaming.started.

call.hangup – Indique que l’appel est terminé (raccroché)
developers.telnyx.com
developers.telnyx.com
. Le payload fournit la raison (hangup_cause) – e.g. "hangup_cause": "normal_clearing" pour fin d’appel normale – et qui a raccroché (hangup_source: “caller” ou “callee”)
developers.telnyx.com
developers.telnyx.com
. C’est votre signal pour nettoyer la session côté serveur (fermer la connexion OpenAI, libérer ressources).

Telnyx peut envoyer d’autres événements (par ex. call.failed si l’appel n’aboutit pas, call.machine_detected si AMD activé, etc.), mais les quatre ci-dessus couvrent le cycle de vie nominal d’un appel de rappel.

Événements du WebSocket media (messages JSON sur la connexion WebSocket Telnyx) :

connected – Message envoyé immédiatement lors de l’établissement de la connexion WS par Telnyx
developers.telnyx.com
. Il s’agit d’un simple JSON : {"event": "connected", "version": "1.0.0"} indiquant que la socket est prête. Votre serveur doit l’ignorer ou s’en servir pour logguer la connexion.

start – Indique le début effectif du streaming audio. Contient des métadonnées sur le flux : media_format avec codec, sample rate et nombre de canaux
developers.telnyx.com
developers.telnyx.com
, ainsi qu’un stream_id unique. Exemple de media_format reçu : "encoding": "PCMU", "sample_rate": 8000, "channels": 1
developers.telnyx.com
. Ce message confirme quel codec Telnyx utilise (au cas où vous n’auriez pas explicitement fixé le codec côté API). Dans notre contexte, on s’attendra par ex. à "encoding": "PCMU" (si μ-law) ou "L16" (si PCM) etc. Une fois ce message reçu, Telnyx va commencer à envoyer les paquets audio.

media – C’est l’événement principal, envoyé de manière répétitive. Chaque événement de ce type contient un fragment audio de la conversation. Le JSON inclut track (“inbound” ou “outbound”), sequence_number, timestamp, chunk (index de paquet) et surtout le payload audio en base64
developers.telnyx.com
developers.telnyx.com
. Telnyx enverra typiquement des événements media pour le track inbound (voix de l’utilisateur) si vous avez choisi inbound_track. Si vous aviez both_tracks, vous recevriez aussi des media avec track: "outbound" (contenu de ce qui est joué à l’utilisateur). Votre Node.js doit décoder ces payloads et les transmettre à OpenAI (voir section 9). Telnyx attend également que vous puissiez envoyer des messages media en retour pour jouer du son (voir ci-après Sending RTP).

stop – Indique la fin du flux audio sur la socket, généralement juste après que l’appel soit raccroché
developers.telnyx.com
. Structure : {"event": "stop", "sequence_number": "...", "stop": { "call_control_id": "...", ... }, "stream_id": "..."}. Après cet événement, Telnyx fermera la connexion WebSocket.

Événements spéciaux :

mark – Marqueurs optionnels utilisés pour synchroniser la fin de lecture de médias injectés
developers.telnyx.com
. Peu pertinent dans notre cas sauf si vous gérez des files audio complexes.

clear – Confirmation après envoi d’une commande clear (pour stopper tout média en cours de lecture sur la socket)
developers.telnyx.com
.

dtmf – Notification si un DTMF (touche) est détecté dans l’appel
developers.telnyx.com
. Cela apparaît si l’utilisateur presse une touche téléphonique. Le payload fournit la digit
developers.telnyx.com
. Vous pourriez l’exploiter pour ajouter des commandes via clavier, mais par défaut on n’en a pas besoin.

error – Indique une erreur sur le flux WS
developers.telnyx.com
 (ex : frame mal formée, débit dépassé, etc.). En particulier, si vous envoyez des données non base64 ou trop fréquemment, Telnyx peut renvoyer un event: "error" avec un code (ex. 100003 malformed_frame ou 100005 rate_limit_reached)
developers.telnyx.com
. Vous devez gérer ces erreurs éventuelles (log et éventuellement corriger l’envoi).

Injection audio (Telnyx WebSocket en écriture) : le WebSocket n’est pas qu’en lecture – grâce au mode bidirectionnel activé, votre serveur peut envoyer des messages sur la socket Telnyx pour jouer de l’audio sur l’appel. Deux types d’envoi existent :

Envoi RTP direct : en mode "rtp", on peut envoyer un message media contenant un payload base64 représentant des paquets RTP audio à jouer
developers.telnyx.com
. Format identique aux paquets reçus, sauf qu’ici c’est vous qui fournissez le payload. Telnyx l’injectera comme audio sortant (track outbound) vers l’appelant en temps réel. Taille : Telnyx accepte des chunks entre 20 ms minimum et 30 s maximum
developers.telnyx.com
. Pour une conversation temps réel, vous enverrez typiquement des petits chunks (20 ms à quelques centaines de ms) successifs pour constituer la parole de l’IA.

Envoi de fichiers (MP3) : Alternativement, Telnyx autorise l’envoi de médias sous forme de fichier audio complet encodé en base64 (actuellement MP3 uniquement)
developers.telnyx.com
. Dans ce cas, Telnyx placera le média dans une file d’attente et le jouera en entier. Cependant, cette méthode n’est pas adaptée au full-duplex ou aux réponses dynamiques mot-à-mot, car Telnyx impose une limite d’un fichier par seconde maximum
developers.telnyx.com
 et attend la fin de la lecture. C’est plutôt pour diffuser un message préenregistré. Pour notre besoin (streaming de la voix IA en temps réel), on utilisera l’envoi RTP direct plutôt que le MP3 file.

En résumé, votre Node.js recevra des événements media (inbound) sur la socket Telnyx, et devra envoyer des événements media (payload outbound) sur la même socket pour faire parler l’IA. Le tout en respectant le format (base64 RTP) et le timing (pas saturer plus de ~50 messages/s pour rester dans ~20 ms chacun, et éviter l’erreur de rate-limit).

8. Structure des messages WebSocket OpenAI GPT-Realtime

L’interaction avec l’API OpenAI Realtime se fait entièrement via le WebSocket que vous établissez vers wss://api.openai.com/v1/realtime (ou l’endpoint Azure équivalent si vous utilisez Azure OpenAI). Une fois connecté et authentifié, les échanges se font sous forme d’événements JSON pouvant contenir du texte ou de l’audio, émis asynchronement dans les deux sens
learn.microsoft.com
learn.microsoft.com
. Voici les principaux types de messages et leur rôle :

Authentification / Configuration : Lors de la connexion, vous devez fournir votre clé API OpenAI. Cela peut se faire soit via l’en-tête Authorization: Bearer <API_KEY> au handshake WebSocket (ce qui est recommandé côté serveur)
evilmartians.com
evilmartians.com
, soit en ajoutant ?api-key=... dans l’URL (évitez en production car bien que chiffré en wss, mieux vaut l’entête). OpenAI peut aussi exiger un header d’opt-in si l’API est en bêta (par ex., OpenAI-Beta: realtime=v1 lors des phases preview)
evilmartians.com
evilmartians.com
. Une fois la connexion établie, OpenAI envoie typiquement un événement session.created (ou équivalent) pour confirmer la session
evilmartians.com
. Immédiatement après, vous avez la possibilité d’envoyer un événement de configuration de session. Il s’agit d’un message JSON de type session.update où vous pouvez spécifier les paramètres tels que input_audio_format, output_audio_format, input_audio_transcription.model (ex. whisper-1), voice (choix de la voix de synthèse) ou encore des instructions système pour le modèle
docs.workadventu.re
docs.workadventu.re
. Exemple minimal : {"type": "session.update", "session": { "input_audio_format": "g711_ulaw", "output_audio_format": "g711_ulaw", "input_audio_transcription": {"model": "whisper-1"} } }
evilmartians.com
. OpenAI répondra éventuellement par un événement session.updated pour accuser réception (non strictement nécessaire si pas de changement critique).

Envoi de l’audio utilisateur (input) : Pour transmettre la voix de l’appelant à OpenAI, vous envoyez des messages binaires sur le WS. Chaque message binaire contient un fragment audio (ex. 20 ms) encodé selon le format attendu (PCM ou μ-law selon config). Vous n’avez pas besoin d’envelopper cela dans du JSON : le protocole considère tout message binaire entrant comme un morceau de signal audio utilisateur. Ces paquets peuvent être envoyés en continu pendant que l’utilisateur parle. OpenAI effectuera la reconnaissance vocale en temps réel sur ce flux, avec Voice Activity Detection (VAD) pour déterminer quand le locuteur a fini sa phrase
docs.workadventu.re
. Vous n’obtiendrez pas de confirmation pour chaque chunk envoyé, c’est un flux aveugle type streaming.

Transcription en temps réel (events de sortie) : Tandis que l’utilisateur parle, OpenAI peut commencer à renvoyer des éléments de transcription partiels. Ces messages arrivent sous forme d’événements JSON de type response.audio_transcript.delta (pour un morceau de transcription)
evilmartians.com
. Le champ delta contiendra par exemple un ou quelques mots reconnus jusqu’à présent. Votre application peut les utiliser pour afficher du texte live ou logguer ce que dit l’utilisateur. Quand OpenAI a déterminé que l’utilisateur a terminé sa phrase (via VAD ou silence), il envoie un événement response.audio_transcript.done contenant la transcription complète de l’énoncé utilisateur
evilmartians.com
. Vous pouvez exploiter ce message si vous voulez avoir le texte complet de la requête (par ex. pour journalisation ou pour une autre logique). Toutefois, pour simplement faire suivre à l’IA, ce n’est pas nécessaire : OpenAI passe automatiquement à l’étape suivante.

Réponse de l’IA (audio de sortie) : Après la fin de la parole utilisateur, le modèle LLM génère une réponse (sous forme textuelle) puis la convertit en audio (via un TTS interne), le tout de manière streamée. Vous recevrez des événements response.audio.delta contenant chacun un chunk audio de la réponse vocale
evilmartians.com
. Ces chunks sont typiquement des tableaux d’entiers 16-bit (Int16) si le format est PCM, ou potentiellement encodés (ex. μ-law) selon output_audio_format. Dans l’implémentation Node, si vous utilisez la librairie OpenAI realtime, l’event peut vous fournir event.delta.audio directement sous forme d’Int16Array
docs.workadventu.re
docs.workadventu.re
. Si vous n’utilisez pas de librairie, le message JSON contiendra probablement l’audio encodé en base64 ou en structure compressée – mais d’après les exemples (Evil Martians), on voit qu’ils reçoivent un JSON, puis décodent dedans l’audio. Il est possible qu’OpenAI envoie l’audio sous forme de données binaires séparées ou encapsulées dans du JSON. Supposons pour la simplicité qu’on obtienne l’audio brut. Votre serveur recevra donc ces chunks successifs jusqu’à ce que la réponse soit complète. OpenAI signale la fin de sa réponse par un événement response.output_item.done (ou response.done)
evilmartians.com
, indiquant que l’item de réponse est terminé. À ce moment, l’IA attend à nouveau une éventuelle prochaine entrée utilisateur (nouvelle turn de conversation).

Messages textuels et autres : En parallèle des audio, vous pourriez recevoir des messages contenant du texte pur (par ex. si l’IA décide d’effectuer un appel de fonction ou retourne un résultat textuel). Dans le cas du modèle GPT-Realtime standard, la sortie principale est audio + texte transcrit de ce qu’elle dit. Vous pouvez capter le texte de la réponse IA via des events response.message.* ou via les champs transcripts inclus parfois dans les deltas audio
docs.workadventu.re
. Par exemple, certains events conversation.updated contiendront un delta.transcripts avec les mots que l’IA est en train de prononcer ou a prononcés
docs.workadventu.re
. Ce sont en fait la transcription texte de l’audio de l’IA. Cela peut servir si vous voulez afficher les sous-titres de la réponse IA en live, ou analyser le contenu généré. Ce n’est pas strictement nécessaire pour le fonctionnement vocal, mais c’est une donnée utile en annexe.

Contrôle de tour : OpenAI GPT-Realtime gère par défaut le tour de rôle grâce au VAD (on a configuré turn_detection: server_vad dans l’exemple WorkAdventure
docs.workadventu.re
). Cela signifie que l’IA attend le silence de l’utilisateur pour répondre, et parle sans interruption jusqu’à la fin de sa réponse (puis attend de nouveau l’utilisateur). Il est possible d’implémenter un barge-in (interruption de l’IA par l’utilisateur), mais c’est complexe : il faudrait couper l’audio de l’IA en cours si on détecte de la voix entrante. Par défaut, considérez l’échange comme un tour par tour strict (ce qui correspond aux événements décrits : transcript → réponse → etc.).

En synthèse, sur le WebSocket OpenAI : vous envoyez l’audio utilisateur en binaire (et éventuellement un message initial de session.update), et vous recevez des messages JSON indiquant la transcription utilisateur et l’audio de la réponse IA. Votre code Node doit gérer ces messages asynchrones, en particulier assembler les chunks audio de réponse pour les envoyer en continu à Telnyx.

9. Spécification du bridge Node.js (audio duplex Telnyx ↔ OpenAI)

Cette section décrit comment construire le pont audio full-duplex en Node.js reliant Telnyx (appel téléphonique) et OpenAI GPT-Realtime (IA vocale). L’architecture globale est la suivante : votre serveur Node agit comme intermédiaire, à la fois serveur WebSocket (pour Telnyx) et client WebSocket (pour OpenAI), transférant l’audio dans les deux sens et orchestrant le dialogue.

Étapes de flux (événementiel) :

Démarrage du rappel : Un utilisateur (depuis une landing page, par ex.) demande un rappel. Votre backend déclenche l’appel sortant via Telnyx (API /calls comme en section 6). Vous obtenez immédiatement un call_control_id et peu après le webhook call.initiated de Telnyx
developers.telnyx.com
.

Mise en place des connexions WS :

Dès la requête d’appel effectuée, ou au plus tard dès réception de call.answered
developers.telnyx.com
, votre Node.js doit ouvrir la connexion WebSocket vers OpenAI. Il s’agit d’établir la session GPT-Realtime. Incluez le header d’auth Authorization: Bearer <OPENAI_API_KEY> et connectez à wss://api.openai.com/v1/realtime?model=gpt-realtime (ou modèle exact déployé)
learn.microsoft.com
. Si la connexion réussit, vous recevrez un événement session.created (de façon asynchrone). À ce stade, envoyez immédiatement le message session.update pour configurer le format audio et les paramètres (voir section 8). Par ex., input_audio_format = "PCMU" (alias g711_ulaw) si on reste en μ-law, ou "pcm_s16le_16000" si on utilise PCM, etc., de manière cohérente avec Telnyx
evilmartians.com
. Configurez aussi input_audio_transcription.model: "whisper-1" (modèle de STT, recommandé), et éventuellement voice pour la voix de synthèse (OpenAI propose par ex. "voice": "alloy" pour une voix féminine naturelle). Vous pouvez aussi envoyer des instructions (système prompt) ici, qui définissent la personnalité ou le contexte du modèle (par ex. « Tu es un assistant vocal au téléphone… » etc.). Cette configuration initiale de session garantit qu’OpenAI est prêt à échanger l’audio dans le bon format.

Simultanément, Telnyx va tenter de se connecter à votre WebSocket serveur (à l’URL stream_url fourni). Vous devez avoir un serveur WebSocket Node écoutant sur le chemin en question, capable d’accepter la connexion entrante de Telnyx. Libraries utiles : ws (pour WebSocket) ou tout framework supportant les WS (SockJS, etc.). À l’arrivée de la connexion, vérifiez éventuellement un token d’auth (voir section 10). Une fois accepté, Telnyx enverra le message {"event": "connected"}
developers.telnyx.com
, puis après l’établissement de l’appel, le message start avec media_format
developers.telnyx.com
developers.telnyx.com
. À la réception de start, vous savez quel codec et sample rate Telnyx utilise (utile pour valider qu’il correspond à ce que vous attendiez/configuré côté OpenAI). Par exemple, vous verrez media_format.encoding = "PCMU" si μ-law 8k. S’il y a une discordance, logguez une alerte (mais idéalement, en ayant configuré explicitement via stream_bidirectional_codec, il n’y aura pas de surprise).

Boucle de streaming inbound (utilisateur → IA) : Lorsque l’utilisateur parle, Telnyx envoie des événements media (inbound track) contenant le son en base64
developers.telnyx.com
. Votre code doit, pour chaque message media reçu de Telnyx :

Extraire le payload base64 et le décoder en bytes (Buffer binaire).

Si nécessaire, convertir le format vers celui d’OpenAI : par exemple, si Telnyx envoie du μ-law 8k et qu’OpenAI attend du μ-law 8k, pas de conversion ; si Telnyx envoie du PCM16 16k big-endian et qu’OpenAI attend du PCM16 16k little-endian, convertir l’endianness (swap bytes) sur le buffer; si Telnyx 16k → OpenAI 24k, appliquer un resampler.

Envoyer le buffer résultant sur le WebSocket OpenAI en tant que message binaire. Aucune enveloppe JSON n’est requise, on envoie les raw bytes.

(Optionnel) Si OpenAI tarde à répondre et que l’utilisateur fait une pause longue, vous pourriez décider d’arrêter d’envoyer pour économiser de la bande passante. Ce n’est généralement pas nécessaire, OpenAI VAD gère cela.

Ce mécanisme se poursuit de façon fluide. Pensez à implémenter un tampon ou backpressure : si pour une raison quelconque OpenAI ne pouvait pas consommer aussi vite que Telnyx émet (peu probable vu qu’on est en temps réel), évitez d’empiler infiniment les messages. En Node.js, utilisez par exemple les événements ws.send avec un callback ou gérez l’état socket.bufferedAmount. En pratique, la vitesse d’envoi de Telnyx (p. ex ~50 msg/s de 20 ms) est supportée par OpenAI temps réel.

Boucle de streaming outbound (IA → utilisateur) : Dès que l’IA commence à formuler une réponse, OpenAI va envoyer des événements response.audio.delta avec du son IA. Votre code doit, pour chaque message audio de l’IA reçu :

Récupérer les données audio. Si vous recevez un Int16Array directement (via la lib), convertissez-le en Buffer binaire (souvent il suffira de faire Buffer.from(int16array.buffer)). Si vous recevez une chaîne base64 dans un JSON, décodez-la en Buffer. Si vous recevez un Buffer binaire (OpenAI pourrait potentiellement envoyer l’audio en binaire aussi), utilisez-le directement.

Convertir le format vers celui de Telnyx : ex. OpenAI PCM 24k little-endian → Telnyx μ-law 8k nécessite décodage PCM → ré-échantillonnage 24→8k → encodage μ-law (il existe des libs télécom pour PCM->μ-law). Mais encore une fois, si configuré judicieusement, vous pouvez éviter. Idéalement : OpenAI a été configuré pour produire du μ-law 8k directement (output_audio_format: g711_ulaw), alors peut-être qu’il vous envoie déjà des octets μ-law (ou alors il renvoie du PCM16 qu’il vous incombe de compresser : à vérifier, car un utilisateur sur GitHub notait que malgré g711_ulaw configuré, l’API renvoyait un Int16Array
github.com
 – possiblement un bug ou la lib qui décodait?). Par prudence, préparez la conversion : si OpenAI vous donne PCM16 16k et Telnyx attend PCM16 16k, convertissez endianness si besoin; si Telnyx attend μ-law, encodez. Utilisez éventuellement une table de conversion PCM->μ-law (256 valeurs) pour performance.

Encapsuler en message JSON Telnyx : il faut renvoyer sur la socket Telnyx un message de type media contenant le payload base64 du buffer audio
developers.telnyx.com
. En Node, ça ressemble à :

wsTelnyx.send(JSON.stringify({
  event: "media",
  media: { payload: bufferAudio.toString('base64') }
}));


Telnyx jouera immédiatement ce chunk dans l’appel. Pour assurer une lecture fluide, essayez d’envoyer les chunks sortants au rythme approprié. Par exemple, si vous recevez 40 ms d’audio de l’IA dans un chunk, vous pouvez le pousser aussitôt à Telnyx, mais sachez que Telnyx ne jouera pas plus vite que le temps réel. Il est généralement acceptable d’envoyer dès disponibilité, Telnyx mettra en tampon interne si nécessaire quelques millisecondes. Le protocole RTP implique de toute façon un horodatage dans timestamp que Telnyx utilise pour synchroniser (Telnyx mentionne que timestamp peut être utilisé pour ordonnancer)
developers.telnyx.com
.

Répéter jusqu’à ce que l’événement de fin de réponse (response.output_item.done) soit reçu, indiquant que l’IA a fini de parler. À ce moment, vous savez que l’utilisateur peut répondre de nouveau.

Gestion de la conversation multi-tours : Le bridge doit être prêt à boucler. Après une réponse IA terminée, l’utilisateur parle de nouveau, ce qui relance le flux inbound, etc. Normalement, tout cela continue tant que l’appel est ouvert. Vous pouvez éventuellement implémenter une logique d’arrêt : par exemple, si l’IA ou l’utilisateur dit “au revoir” ou si un certain temps de silence prolongé est détecté, votre application peut décider de terminer l’appel. Dans ce cas, vous pouvez appeler l’API Telnyx /calls/{call_control_id}/actions/hangup pour raccrocher, ou simplement laisser l’utilisateur raccrocher.

Fin d’appel et nettoyage : Lorsque l’appel est terminé (call.hangup webhook reçu)
developers.telnyx.com
, ou si l’un des deux interlocuteurs raccroche, il faut nettoyer proprement. Cela signifie :

Fermer la connexion WebSocket Telnyx (Telnyx la fermera de son côté de toute façon après stop, mais vous pouvez aussi la fermer côté serveur).

Fermer la connexion WebSocket OpenAI (envoyer éventuellement un message {"type": "session.close"} si spécifié, sinon juste couper). OpenAI enverra peut-être un response.done ou simplement constatera la fermeture.

Libérer toute ressource (buffers, timers).

Points d’attention particuliers :

Synchronisation et latence : le parcours utilisateur → Telnyx → Node → OpenAI → Node → Telnyx → utilisateur introduit de la latence. En pratique, Telnyx WS + traitement + OpenAI streaming est optimisé pour du quasi temps réel, mais attendez-vous à ~200ms à 500ms de délai total aller-retour dans le meilleur des cas (variable selon la vitesse de génération du modèle et la longueur de réponse). Ce n’est pas un problème pour conversation, mais évitez de superposer les voix (pas de full duplex où les deux parlent en même temps, ce serait confus). Si l’utilisateur parle pendant que l’IA parle, OpenAI VAD le détectera et la réponse IA peut être tronquée. Vous pourriez implémenter une pause de l’IA si une interruption est détectée côté Telnyx (hors du scope basique).

Conversion audio efficace : utilisez des bibliothèques natives si possible pour μ-law <-> PCM et resampling. En Node pure JS, ces opérations sur chaque paquet 20 ms peuvent consommer du CPU, mais restent faisables en temps réel étant donné le volume modeste (8kHz 8-bit -> 64kbps, ou 128kbps PCM16). Testez sur votre machine et surveillez l’utilisation CPU pour la montée en charge.

Gestion d’erreurs : si la connexion OpenAI se ferme inopinément (erreur, quota dépassé, etc.), arrêtez le pont et éventuellement faites raccrocher l’appel (en jouant un message d’erreur préenregistré ou une phrase de clôture via Telnyx TTS, en dernier recours). De même, si Telnyx WS se coupe (par ex. l’appelant a raccroché), assurez-vous de fermer OpenAI proprement pour éviter de continuer à consommer des tokens inutilement.

Scalabilité : pour chaque appel en cours, vous avez 2 websockets et un pipeline de traitement. Veillez à ce que votre serveur Node puisse supporter le nombre simultané d’appels attendu. Node.js est capable d’en gérer un bon nombre en parallèle grâce à son modèle événementiel, mais attention à la charge CPU des transformations audio.

En pseudo-code, le coeur du bridge ressemble à ceci (pour l’option μ-law par ex.) :

// Telnyx WebSocket server "connection" event
telnyxWSS.on('connection', (wsTelnyx, req) => {
  authenticate(req); // vérifier token dans req.url
  wsTelnyx.on('message', async (msg) => {
    let data = JSON.parse(msg);
    if(data.event === 'media' && data.media && data.media.payload) {
      // Inbound audio from caller
      let audioBuf = Buffer.from(data.media.payload, 'base64');  // μ-law bytes
      // (Si nécessaire: transcode μ-law->PCM16LE here)
      openAIWS.send(audioBuf); // forward to OpenAI
    }
    // ... handle other Telnyx events like 'start', 'stop' if needed ...
  });
  // Save wsTelnyx for sending later
});

// OpenAI WebSocket client
openAIWS.on('message', (msg) => {
  // msg could be binary (Buffer) or text (JSON)
  if(Buffer.isBuffer(msg)) {
    // Assuming OpenAI audio output is binary (in practice might be JSON)
    let audioBuf = msg;
    // (Si nécessaire: transcode PCM->μ-law here)
    wsTelnyx.send(JSON.stringify({
      event: 'media',
      media: { payload: audioBuf.toString('base64') }
    }));
  } else {
    let data = JSON.parse(msg);
    if(data.type === 'response.audio.delta' && data.audio) {
      // Possibly audio data in JSON (base64 or array of int16)
      // Handle similar to above after extracting audio bytes...
    }
    // handle transcripts or done events if needed
  }
});


Le code réel sera plus détaillé, mais c’est l’idée centrale. En parallèle, il faudra initialiser openAIWS suite à call.answered (ou avant si anticipé), et gérer la fermeture (sur call.hangup, call openAIWS.close() etc.).

10. Sécurité (authentification, validation Telnyx events, sécurisation du WebSocket OpenAI)

La double intégration nécessite de considérer la sécurité sur deux fronts : les webhooks/WS de Telnyx et l’accès à l’API OpenAI.

Authentification des requêtes Telnyx (webhooks HTTP) : Telnyx signe ses webhooks V2 pour que vous puissiez vérifier qu’ils proviennent bien de Telnyx et n’ont pas été altérés
support.telnyx.com
. Lors de chaque webhook (événement call.* ou streaming.* envoyé en HTTP), Telnyx inclut typiquement des en-têtes comme Telnyx-Signature-Ed25519 et Telnyx-Timestamp. Vous devez implémenter la vérification : Telnyx fournit une clé publique (disponible dans le portail ou via API) que vous utiliserez pour vérifier la signature Ed25519 du JSON (ou utilise leur SDK qui propose une méthode utilitaire, e.g. telnyx.webhooks.signature.verifySignature(...) en Node
github.com
). Ne négligez pas cette vérification – sinon, quelqu’un pourrait appeler votre webhook URL et déclencher de fausses actions. Concrètement, conservez le payload brut et le timestamp, concaténez eux, et utilisez la signature pour vérifier via la clé publique Telnyx (documenté sur Telnyx Developer docs). Si la signature ne correspond pas, rejetez la requête (HTTP 400).

Sécurisation du WebSocket serveur Telnyx : Telnyx va se connecter à votre WebSocket sans méthode d’auth standard (pas de Basic Auth possible facilement sur WS). Pour éviter qu’un tiers ne tente d’envoyer de l’audio à votre serveur, utilisez une URL difficile à deviner et/ou un token. Comme suggéré en section 6, incluez un paramètre de requête dans stream_url (par ex. ?token=<long_random>) généré par votre application lors de l’initiation d’appel. Quand votre serveur reçoit une connexion WS, l’URL demandée est accessible (via req.url ou équivalent). Vérifiez la présence du token et sa validité (par ex., stockez-le en mémoire lors de la requête d’appel, associé à call_control_id, et validez qu’il correspond). Si invalide, fermez la connexion immédiatement. De plus, vous pouvez restreindre par IP – Telnyx publie les plages d’IP sources de ses Webhooks et médias (ex. us-east, us-west, etc.). Si votre infra le permet, autorisez uniquement ces IP sur le port WS.

Veillez aussi à servir le WebSocket en wss:// (TLS) : procurez-vous un certificat SSL pour votre domaine. Une solution rapide en dev est d’utiliser un tunnel type ngrok qui fournit du TLS, ou d’avoir votre serveur Node écouter en HTTPS/WSS avec un cert Let’s Encrypt ou autre. C’est essentiel car l’audio transite en clair sinon.

Authentification à l’API OpenAI : Utilisez la clé secrète API fournie par OpenAI. Ne l’exposez jamais côté client (ici tout se passe côté serveur, donc c’est bien). Chargez-la depuis une variable d’environnement ou un store sécurisé. À la connexion WebSocket, passez-la en header Authorization
evilmartians.com
. Si vous utilisez le SDK openai, il gèrera peut-être ça. OpenAI n’utilise pas de signature supplémentaire sur chaque message (la connexion WS une fois établie fait foi), donc assurez-vous simplement de ne pas laisser traîner la clé ou le handshake en log.

Permissions OpenAI : Vérifiez que votre clé API a accès au modèle GPT-Realtime (c’est en bêta/alpha, possiblement il faut avoir l’accès activé). Sur Azure OpenAI, assurez-vous que le déploiement du modèle realtime est fait et utilisez l’URL et clé correspondantes du service Azure.

Validation des événements OpenAI : Il n’y a pas de signature comme pour Telnyx, car la communication est sur une connexion sortante initiée par vous. On fait confiance à la connexion TLS pour l’authenticité du serveur (vérification du certificat api.openai.com). Donc pas de mécanisme particulier à implémenter, hormis éventuellement un timeout / watchdog – par ex., si plus aucun message n’est reçu d’OpenAI pendant un certain temps alors qu’on attend une réponse, il y a peut-être un souci (vous pourriez alors relancer la session ou abandonner).

Limitation d’accès : Si votre API de rappel est exposée (par ex. endpoint HTTP pour déclencher le rappel), assurez-vous de l’authentifier aussi (par ex. cookie de session utilisateur ou token OAuth). On veut éviter que n’importe qui puisse abuser du système en déclenchant des appels ou en se connectant à votre WebSocket. De plus, gérez bien les quotas : l’API OpenAI coûte par minute audio (Whisper + voix synthèse), donc implémentez une limite de durée d’appel si pertinent.

Autres considérations :

Veillez à utiliser des versions à jour de TLS (TLS1.2+) et des bibliothèques WS maintenues pour éviter les vulnérabilités.

Isoler ce service sur des machines à part peut aider à réduire l’impact en cas de compromission.

Ne logguez pas de données sensibles en clair (le contenu de la conversation peut être confidentiel, traitez-le avec soin si vous le stockez).

Conformez-vous aux politiques d’utilisation d’OpenAI: pas d’utilisation à des fins prohibées, etc., et assurez-vous de pouvoir stocker/traiter les données vocales de l’utilisateur de manière conforme à la vie privée (GDPR si applicable, par ex. mentionnez dans vos CGU l’usage de ces services).

En validant les signatures Telnyx et en protégeant vos endpoints, vous aurez un système robustement sécurisé contre les appels ou injections non sollicitées.

11. Checklist de configuration (Telnyx, OpenAI, DNS, HTTPS)

Avant de lancer en production, passez en revue cette liste de vérification :

Telnyx Account : Compte créé et crédité (solde suffisant pour émettre des appels). API Key générée pour l’auth des requêtes API (et stockée dans votre app)
developers.telnyx.com
.

Numéro Telnyx : Numéro de téléphone acheté/provisionné
developers.telnyx.com
, avec les documents de vérification éventuellement requis (ex. certains pays demandent des justificatifs pour les numéros).

Voice API Application : Créée et configurée (voir section 1). Webhook URL principale (et failover) configurée
developers.telnyx.com
, version API v2, DTMF en RFC2833 (par défaut) suffisent.

Inbound Settings : SIP Subdomain laissé vide ou configuré selon besoins (pas indispensable ici)
developers.telnyx.com
. Codecs inbound : assurez-vous que le codec que vous allez utiliser est coché dans les codecs supportés de l’application
support.telnyx.com
. Par ex., si vous comptez utiliser l’OPUS 16k, cochez OPUS dans la liste et éventuellement décochez le reste pour forcer. Généralement, laisser PCMU/PCMA cochés par défaut ne pose pas de problème si vous utilisez L16, Telnyx fera la conversion, mais pour cohérence, cochez L16 aussi si disponible.

Outbound Settings : Outbound Voice Profile assigné à l’application
support.telnyx.com
. Channel limit éventuellement ajustée.

Phone Numbers : Le numéro d’appelant Telnyx est bien assigné à l’application (sinon les appels sortants avec ce numéro pourraient être refusés)
developers.telnyx.com
.

Outbound Voice Profile : Configuré (voir section 2) – destinations autorisées couvrant votre cas (par ex. si vous appelez uniquement en France, autorisez la France). Si vous voyez des erreurs “Destination not allowed”, ajustez cette liste.

Telnyx API : Clé API Telnyx (Bearer token) configurée dans votre application backend. Droits suffisant (généralement la clé par défaut a tous les droits sur voix).

Webhook handling : Votre application a une route HTTP accessible pour recevoir les webhooks Telnyx (par ex. via Express). Si en dev local, utilisez ngrok pour tester les webhooks.

Signature Webhook : Récupérez la clé publique Telnyx (depuis Mission Control > Auth > Webhooks je crois) et implémentez la vérification. Testez-la avec un webhook réel.

DNS : Un nom de domaine configuré qui pointe vers votre serveur Node.js (pour le WebSocket Telnyx). Assurez-vous que le domaine dans stream_url est résolu publiquement et que le port utilisé (par ex. 443 ou autre) est ouvert.

TLS/HTTPS : Certificat SSL valide pour votre domaine. Si vous n’avez pas de CA, utilisez Let’s Encrypt via Certbot ou une solution intégrée. Vous pouvez configurer votre Node.js server avec HTTPS (ex. utiliser le module https de Node avec les clés). Alternativement, placez un proxy Nginx en front qui gère TLS et forwarde vers votre Node en WS. Tester wss://yourdomain/path avec un client WS simple pour s’assurer que la couche TLS et upgrade WS fonctionnent.

OpenAI API Access : Clé API OpenAI stockée. Vérifiez qu’elle fonctionne (par ex. testez un appel REST trivial au modèle GPT-3 pour valider le key, ou utilisez l’endpoint de transcription audio non realtime en test). Pour GPT-Realtime, l’endpoint étant en bêta, assurez-vous d’avoir l’accès (éventuellement essayez avec l’exemple de code openai-realtime-beta).

OpenAI Model ID : Notez le paramètre model= à utiliser dans l’URL WS. S’il faut une version spécifique (ex. gpt-realtime vs gpt-4o-realtime-preview), configurez-le. Sur OpenAI public, probablement model=gpt-realtime fonctionne
learn.microsoft.com
, sur Azure, ce sera le deployment name.

OpenAI Settings : Choisissez la voix si souhaité (sinon défaut). Préparez le prompt système/instructions (par ex. “Parle en français, de manière polie et concise.” si nécessaire). Ce prompt pourra être envoyé via session.update initial.

Node.js env : Ayez installé les packages nécessaires :

ws pour implémenter le serveur WS Telnyx et client WS OpenAI,

éventuellement @openai/realtime-api-beta si vous voulez utiliser la lib (facultatif, pas obligatoire),

libs de traitement audio si utilisées (mulaw conversion, sox etc.).

Un framework web (Express, Fastify) pour les webhooks HTTP.

Firewall : Ouvrez le port 443 (ou celui choisi) pour les connexions entrantes Telnyx sur votre WS. Ouvrez les ports sortants vers OpenAI (443 aussi).

Testing numbers : Utilisez un vrai numéro destinataire test (le vôtre) pour valider le flux complet. Attention, si vous testez sur un téléphone mobile, utilisez de préférence un casque ou mettez le volume faible lors des tests pour éviter de créer un larsen ou que le micro du téléphone repasse la voix de l’IA à Telnyx (bouclage écho).

Logging : Activez des logs détaillés en dev (affichez chaque event reçu/emis sur Telnyx WS et OpenAI WS) pour faciliter le débogage.

Quota & Rate-limit : OpenAI a des limites de débit de requêtes ; monitorer les éventuelles erreurs 429. Telnyx a un rate-limit d’envoi média (1 par sec pour MP3, et environ 50/s pour RTP c’est ok). Assurez-vous de respecter cela (ne pas envoyer plus de ~1 message media par 20ms sur WS Telnyx).

Failover : Configurez la Webhook failover URL chez Telnyx pour redondance (peut pointer vers un second serveur).

Cleanup : Prévoir un mécanisme en cas d’appel abandonné/incomplet. Par ex., si OpenAI ne répond pas ou Telnyx call.failed, nettoyer et éventuellement réessayer plus tard ou notifier l’échec à l’utilisateur.

Cette checklist vous aide à éviter les erreurs de configuration courantes (ex. “Why no audio? – Oups, WS non accessible en wss://” ou “Telnyx refused call – OVP manquant”).

12. Plan de test audio (latence, perte, écho, silence) et validation

Une fois tout configuré, effectuez des tests approfondis :

Test de base – parcours heureux : Déclenchez un rappel vers votre propre téléphone. Vérifiez que :

vous entendez une réponse de l’IA (ex. salutations),

l’IA comprend ce que vous dites (réponses cohérentes),

la conversation peut enchaîner sur plusieurs tours.
Mesurez la latence entre la fin de votre question et le début de réponse de l’IA. Cela devrait idéalement être de l’ordre de 1 seconde ou moins. Si c’est beaucoup plus (plus de 2-3 sec), il peut y avoir un problème de traitement ou un paramètre mal réglé (logs d’OpenAI utiles pour voir si la transcription traîne, etc.).

Qualité audio : Évaluez si la voix de l’IA est intelligible par téléphone. En μ-law 8k, elle devrait être similaire à une voix humaine au téléphone (quoique synthétique). En PCM 16k → G.722 potentiellement, si vous appelez d’un mobile récent, vous pourriez percevoir plus de clarté. Assurez-vous qu’il n’y a pas de distorsion majeure, de son haché ou accéléré. Si vous entendez du “slow/low audio”, c’est souvent un problème de sample rate mal converti (ex. jouer un 24kHz comme du 8kHz donne une voix lente et grave). Dans ce cas, vérifiez votre pipeline de conversion, un resampling manquant ou un mauvais codec (ce type de problème a été signalé par des développeurs qui n’avaient pas converti du 24k audio et obtenaient une voix ralentie
community.openai.com
).

Écho : Normalement, l’infrastructure téléphonique a de l’écho cancellation. Toutefois, si le volume de l’IA est trop fort et que votre micro de téléphone le reprend, Telnyx pourrait renvoyer l’écho à OpenAI. OpenAI pourrait alors entendre sa propre voix et potentiellement répondre à côté (“pardon je n’ai pas compris” – parlant en fait à elle-même!). Pour tester, montez le volume et voyez si l’IA se met à confondre sa voix. Si oui, vous pourriez implémenter un traitement anti-écho : par exemple, couper temporairement le flux inbound Telnyx pendant que vous envoyez l’audio de l’IA (demi-duplex). Telnyx ne propose pas nativement d’annulation d’écho sur Media Streams, c’est à gérer côté OpenAI ou application. Vous pouvez peut-être atténuer l’entrée micro via OpenAI (ils n’offrent pas de param direct, mais vous pourriez couper l’envoi de paquets Telnyx quand vous savez que c’est l’IA qui parle). Ce point est complexe ; l’idéal est que l’utilisateur utilise le combiné ou un bon écho cancellation naturel.

Silence et VAD : Testez en ne parlant pas du tout après connexion. OpenAI devrait ne rien faire tant qu’il n’entend rien. Au bout d’un certain temps, vous pouvez décider de raccrocher automatiquement (par ex. si 30 sec de silence). Testez aussi en parlant très brièvement, ou en faisant des pauses longues au milieu de phrases. Vérifiez que OpenAI ne coupe pas la parole trop vite. Vous pouvez ajuster la sensibilité du VAD côté OpenAI si exposé (paramètre éventuellement disponible).

Interruption : Parlez par-dessus la voix de l’IA délibérément pour voir le comportement. C’est un cas extrême. Par défaut, l’IA ne s’arrêtera pas seule. Telnyx toutefois continuera d’envoyer votre voix. OpenAI aura deux flux concurrents (pas bien gérés actuellement). En général, ce test montrera que l’IA continue et ne vous entend pas en même temps. Il faudrait implémenter un stop manuel si c’était critique, mais souvent on accepte de ne pas gérer l’interruption.

Perte de paquets / Jitter : Étant en TCP (WebSocket sur TLS sur TCP), les pertes de paquets réseau se manifestent plutôt par de la latence qu’une vraie perte audio. Simulez éventuellement une dégradation : utilisez un outil pour ralentir la connexion ou provoquer du jitter. Voyez si l’audio arrive haché ou en rafale. Telnyx fournit des stats de qualité dans call.hangup (MOS, jitter)
developers.telnyx.com
, consultez-les après un test, surtout en conditions dégradées. Si MOS très bas (<3), c’est signe de problème réseau. Votre application n’y peut pas grand-chose, mais c’est bon de monitorer.

Durée : Testez un appel de longue durée (plusieurs minutes). Assurez-vous qu’aucune fuite de mémoire ne se produit (observer l’usage mémoire du process Node). Telnyx envoie régulièrement des paquets RTCP pour garder l’appel (à moins que vous ayez désactivé “hang-up on timeout” ou mis un temps très long). Un appel inactif pourrait se terminer selon la config Telnyx (paramètre “timeout” mentionné section 1). Vous pouvez le régler plus haut si besoin.

Multi-utilisateurs : Simulez deux appels simultanés (si possible, appelez deux téléphones ou deux testeurs). Vérifiez que votre serveur gère bien deux sessions en parallèle sans interférences (chaque WS Telnyx envoie à la bonne WS OpenAI). Monitorer CPU à 2 appels, 5 appels, etc., pour planifier la capacité.

Scénarios conversationnels : Posez diverses questions à l’IA, y compris des cas difficiles ou hors sujet, pour voir comment elle répond. Assurez-vous qu’elle respecte bien vos instructions (si vous lui avez dit de se nommer d’une certaine façon ou de ne pas dire certaines choses). Cela permet de valider la couche GPT plus que la technique, mais c’est important dans un test bout en bout.

Edge cases Telnyx : Appelez et ne décrochez pas (voir comment l’appel est annulé, vous devriez recevoir un call.hangup avec cause timeout). Appelez un répondeur, voyez si vous avez activé AMD ou pas. Ici on n’a pas mis de Answering Machine Detection, donc l’IA pourrait parler à un répondeur – évaluez si c’est un souci (sinon, Telnyx propose AMD en option pour détecter les répondeurs).

Pour chaque test, collectez les logs et ajustez les paramètres. Par exemple, si la latence est un peu haute, vous pourriez réduire la taille des chunks audio IA (peut-être envoyer plus fréquemment des petits paquets, au risque d’overhead – à tuner). Si la qualité est mauvaise, vérifiez le codec utilisé ou essayez une autre option (OPUS 16k par ex., en gardant conversion).

Validation finale : Un test complet consiste à avoir une conversation de bout en bout avec l’IA où elle répond correctement et l’expérience utilisateur est fluide. Une fois obtenu, documentez ces résultats et passez en production en surveillant en continu la qualité des appels (Telnyx offre des metrics appel par appel, OpenAI aura la facturation par durée d’audio transcrit/généré pour vérifier les coûts).

13. Exemples de code Node.js pour les étapes critiques

Nous fournissons ci-dessous des extraits de code Node.js illustrant les étapes clés. Ils sont simplifiés pour lisibilité ; il faudra les intégrer dans une architecture robuste (gestion d’erreurs, contextes par appel, etc.).

(a) Lancement d’un appel Telnyx (HTTP REST) – Utilisation du module axios pour envoyer la requête POST d’appel sortant avec Media Streams :

const axios = require('axios');
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
async function startCall(toNumber) {
  const payload = {
    connection_id: TELNYX_CONNECTION_ID,
    to: toNumber,
    from: TELNYX_NUMBER,
    stream_url: `wss://myserver.com/media?token=${generateToken()}`,
    stream_track: 'inbound_track',
    stream_bidirectional_mode: 'rtp',
    stream_bidirectional_codec: 'PCMU'  // ou 'L16'
  };
  const res = await axios.post('https://api.telnyx.com/v2/calls', payload, {
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` }
  });
  console.log('Call initiated, Telnyx response:', res.data);
  return res.data.data.call_control_id;
}


Ici, TELNYX_CONNECTION_ID est l’ID de l’application (ex: "1684641123236054244"), TELNYX_NUMBER votre numéro format +E.164. La fonction generateToken() génère un token unique (stocké quelque part pour vérifier la connexion WS entrante). Après l’appel, on loggue la réponse qui contient call_control_id. (En situation réelle, on attendrait peut-être le webhook call.answered avant de continuer, voir plus bas.)

(b) Démarrage du WebSocket server Telnyx – Utilisation de la bibliothèque ws pour écouter les connexions sur /media (via un serveur HTTPS Node). Supposons qu’on ait déjà un serveur HTTPS httpServer (par ex. créé avec Express). On le passe à WebSocket.Server :

const WebSocket = require('ws');
const wssTelnyx = new WebSocket.Server({ server: httpServer, path: '/media' });

wssTelnyx.on('connection', (ws, req) => {
  // Authentifier via token dans l’URL
  const params = new URLSearchParams(req.url.split('?')[1]);
  const token = params.get('token');
  if (!isTokenValid(token)) {
    console.log('WS Telnyx invalid token, closing');
    ws.close();
    return;
  }
  console.log('Telnyx WS connected');

  ws.on('message', (msg) => {
    // Telnyx envoie du texte JSON
    let data;
    try { data = JSON.parse(msg); } catch(e) { 
      console.error('Invalid Telnyx WS message', e);
      return;
    }
    if (data.event === 'media' && data.media && data.media.payload) {
      // Audio entrant de Telnyx
      const payload = data.media.payload;
      const audioBuf = Buffer.from(payload, 'base64');
      handleInboundAudio(ws, audioBuf); // on traite plus loin
    } else if (data.event === 'start') {
      console.log(`Media stream started: codec=${data.start.media_format.encoding}`);
    } else if (data.event === 'stop') {
      console.log('Media stream stopped');
      // Telnyx va probablement fermer le WS juste après
    }
    // (gérer d'autres events comme dtmf si besoin)
  });

  ws.on('close', () => {
    console.log('Telnyx WS disconnected');
    // Optionnel: nettoyer état, fermer WS OpenAI associé
  });
});


Ici on utilise path: '/media' et on extrait le token. On appelle une fonction handleInboundAudio(ws, audioBuf) pour traiter l’audio entrant (transmettre à OpenAI). On loggue start et stop. Note : ws ici représente la connexion spécifique pour un appel; si plusieurs appels, on aura plusieurs instances. Il faudra faire le lien avec la connexion OpenAI correspondante. Une approche est de stocker un objet contexte, par ex. ws.callId = ... ou maintenir un Map de callId -> { wsTelnyx, wsOpenAI }.

(c) Connexion au WebSocket OpenAI et envoi config :

const openAIWS = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
  headers: { 
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Organization': ORG_ID  // si applicable, ou Beta header si requis
  }
});

openAIWS.on('open', () => {
  console.log('OpenAI WS connected');
  // Envoyer configuration de session
  const sessionConfig = {
    type: 'session.update',
    session: {
      input_audio_format: 'pcmu',  // g711 μ-law
      output_audio_format: 'pcmu',
      input_audio_transcription: { model: 'whisper-1' },
      // voice: 'alloy',  // choisir une voix si on veut
      // instructions: 'Réponds poliment à l\'utilisateur.' 
    }
  };
  openAIWS.send(JSON.stringify(sessionConfig));
});

// Recevoir messages OpenAI
openAIWS.on('message', (msg) => {
  if (typeof msg === 'string') {
    const data = JSON.parse(msg);
    if (data.type === 'response.audio.delta' && data.audio !== undefined) {
      // OpenAI audio chunk in JSON
      let audioBuf;
      if (Array.isArray(data.audio)) {
        // audio en tableau d'int16
        audioBuf = Int16Array.from(data.audio).buffer;
        audioBuf = Buffer.from(audioBuf);
      } else if (typeof data.audio === 'string') {
        // audio en base64
        audioBuf = Buffer.from(data.audio, 'base64');
      }
      if (audioBuf) {
        handleOutboundAudio(callId, audioBuf);
      }
    } else if (data.type === 'response.audio_transcript.delta') {
      const txt = data.transcripts?.[0];
      console.log('Partial transcript:', txt);
    } else if (data.type === 'response.audio_transcript.done') {
      const finalTxt = data.transcripts?.[0];
      console.log('Transcription finale:', finalTxt);
    } else if (data.type === 'response.output_item.done') {
      console.log('IA finished speaking this turn.');
      // Optionnel: marquer qu’on peut reprendre l’écoute utilisateur 
    }
  } else {
    // Binary message (selon design OpenAI, on pourrait recevoir audio direct)
    const audioBuf = Buffer.from(msg);
    handleOutboundAudio(callId, audioBuf);
  }
});


Dans cet extrait, on ouvre la WS OpenAI, on envoie le session.update avec config (ici 'pcmu' pour μ-law – note: parfois c’est 'g711_ulaw', à vérifier selon doc, mais on suppose 'pcmu' alias). On écoute les messages : s’ils sont texte, on parse. On distingue le type. Pour response.audio.delta, on extrait l’audio. OpenAI peut fournir data.audio sous forme d’Int16Array (selon leur client JS) ou base64. On gère les deux. Puis on appelle handleOutboundAudio(callId, audioBuf). Il faudra savoir à quel appel rattacher ce message – ici l’exemple suppose que vous avez lié le openAIWS à un callId ou un contexte. Possibly vous avez closuré le callId lors de la création du openAIWS.

handleOutboundAudio(callId, audioBuf) devra retrouver le WS Telnyx de cet appel et lui envoyer le buffer encodé base64 dans un message media.

(d) Envoi d’audio vers Telnyx (Outbound vers utilisateur) :

function handleOutboundAudio(callId, audioBuf) {
  // Récupérer WS Telnyx de cet appel
  const wsTelnyx = callIdToTelnyxWS.get(callId);
  if (!wsTelnyx || wsTelnyx.readyState !== WebSocket.OPEN) {
    console.error('Telnyx WS not available for call', callId);
    return;
  }
  // Si nécessaire: transcodage audioBuf du format OpenAI->Telnyx
  // (ex: si PCM -> mu-law, convertir ici)
  const payloadBase64 = audioBuf.toString('base64');
  const msg = JSON.stringify({ event: 'media', media: { payload: payloadBase64 } });
  wsTelnyx.send(msg, (err) => { if (err) console.error('Send Telnyx WS err', err); });
}


Ceci est appelé à chaque chunk IA. On suppose une Map callIdToTelnyxWS maintenue. L’envoi se fait simplement comme décrit auparavant. Veiller à gérer le cas où le WS Telnyx est fermé (ne pas envoyer, ça éviterait une exception).

(e) Envoi audio vers OpenAI (Inbound utilisateur) : C’est l’inverse, appelé dans handleInboundAudio(wsTelnyx, audioBuf) plus haut :

function handleInboundAudio(wsTelnyx, audioBuf) {
  const callId = telnyxWsToCallId.get(wsTelnyx);
  const openAIWS = callIdToOpenAiWS.get(callId);
  if (!openAIWS || openAIWS.readyState !== WebSocket.OPEN) {
    return console.error('OpenAI WS not ready for call', callId);
  }
  // Si nécessaire: transcodage audioBuf format Telnyx->OpenAI
  // (ex: mu-law->PCM, endianness swap, resample)
  openAIWS.send(audioBuf, (err) => { if (err) console.error('Send OpenAI WS err', err); });
}


Ici on récupère le lien callId ↔ openAIWS pour envoyer les bytes audio. Aucune transformation si on a calibré les formats. Si on devait transformer, par ex. de μ-law vers PCM16, on appellerait une fonction de conversion sur audioBuf avant openAIWS.send.

(f) Gestion de fin d’appel : Par exemple, sur webhook call.hangup (reçu via Express route), ou sur événement WS Telnyx close, on veut fermer OpenAI WS :

app.post('/webhook', express.json(), (req, res) => {
  const event = req.body.data;
  if (event.event_type === 'call.hangup') {
    const callId = event.payload.call_control_id;
    console.log(`Call ${callId} ended, cause: ${event.payload.hangup_cause}`);
    // Fermer WS OpenAI associé
    const openAIWS = callIdToOpenAiWS.get(callId);
    if (openAIWS) openAIWS.close();
    // Fermer WS Telnyx - Telnyx l'a sans doute déjà fermé de son côté
    const telnyxWS = callIdToTelnyxWS.get(callId);
    if (telnyxWS) telnyxWS.close();
    // Cleanup maps
    callIdToOpenAiWS.delete(callId);
    callIdToTelnyxWS.delete(callId);
    telnyxWsToCallId.delete(telnyxWS);
  }
  res.sendStatus(200);
});


On suppose que callIdToTelnyxWS etc. sont des Maps globales. Vous aurez construit ces maps au moment de call.answered ou connection en liant tout ensemble. Ce code assure qu’on ferme bien ce qui reste ouvert.

Ce sont des exemples modulaires. Dans une implémentation réelle, on gérerait mieux le couplage callId ↔ websockets, potentiellement en créant une classe ou structure par session d’appel.

14. Schéma de séquence général (du landing page au fin d’appel)

Décrivons le scénario complet sous forme de séquence pour bien comprendre chaque interaction entre les composants :

1. Utilisateur clique “Rappelez-moi” sur le site.
– Son navigateur envoie une requête à votre backend (par ex. via REST API /call). Il peut fournir son numéro de téléphone et peut-être un identifiant de demande.

2. Backend Node.js initie l’appel via Telnyx.
– Votre serveur reçoit la demande, génère éventuellement un token pour WS, puis appelle POST /v2/calls de Telnyx
developers.telnyx.com
 avec les paramètres (numéro de l’utilisateur en to, votre numéro en from, etc.).
– Telnyx renvoie immédiatement une réponse d’acceptation contenant call_control_id. Votre backend répond au navigateur (par ex. “Appel en cours, vous allez recevoir un appel.”).

3. Telnyx appelle le numéro de l’utilisateur.
– La plateforme Telnyx sortante compose le numéro de téléphone. L’utilisateur voit un appel entrant (votre numéro Telnyx).
– En parallèle, Telnyx ouvre une connexion WebSocket vers stream_url spécifié. Votre serveur WS accepte la connexion (après avoir validé le token). -> (Point A) sur le diagramme.
– Telnyx envoie sur ce WS un event connected puis attend que l’appel soit effectivement établi.

4. L’utilisateur décroche le téléphone.
– Telnyx détecte que l’appel est answer. Il envoie un webhook HTTP call.answered à votre serveur
developers.telnyx.com
 -> (Point B).
– Telnyx envoie aussi sur le WS média l’événement start avec format audio
developers.telnyx.com
 -> (Point C).
– À ce moment, la communication audio est ouverte mais l’IA n’a pas encore été lancée. L’utilisateur peut dire “Allô ?” – ces quelques premières vibrations vocales arrivent sur le WS Telnyx en events media. Si votre OpenAI WS n’est pas encore prêt, vous pourriez bufferiser brièvement.

5. Backend établit la connexion OpenAI.
– Suite au call.answered (ou vous auriez pu le faire dès call.initiated pour gagner du temps), votre serveur ouvre le WebSocket client vers OpenAI
evilmartians.com
 -> (Point D).
– La connexion s’établit, vous envoyez session.update (config codec, etc.)
evilmartians.com
.
– Vous pourriez aussi envoyer un premier prompt d’instruction ou même un message utilisateur initial si besoin (ex. si vous voulez que l’IA commence la conversation sans attendre que l’utilisateur parle, vous enverriez une sendUserMessageContent comme dans l’exemple WorkAdventure
docs.workadventu.re
). Dans notre cas, on suppose que l’appelant parle d’abord.

6. L’utilisateur parle, audio relayé vers OpenAI.
– Chaque fragment de parole de l’utilisateur (capture micro du téléphone) est envoyé par Telnyx sur le WS (media inbound) -> (Point E). Votre Node reçoit ces events continuellement.
– Pour chacun, il décode base64, convertit si besoin, et fait un openAIWS.send(binary) -> (Point F).
– OpenAI reçoit le flux audio utilisateur en direct. Il commence la transcription. Il envoie des events de transcription partiels que votre Node peut logguer -> (Point G), et après silence, un event transcription final. À ce stade, l’IA a le texte de la question.

7. L’IA génère sa réponse vocale.
– Dès que GPT a assez compris la question, il commence à formuler la réponse. Il envoie les premiers paquets audio de sa voix de synthèse -> (Point H) des events response.audio.delta.
– Votre Node les reçoit (par ex. Int16 PCM), il les convertit en base64 (ou autre encodage requis) et les envoie sur WS Telnyx -> (Point I). Telnyx les place en file immédiatement pour lecture.
– L’utilisateur commence à entendre la voix de l’IA. Pendant ce temps, OpenAI continue d’envoyer la suite de l’audio de réponse, chunk par chunk. Node transfère chaque chunk à Telnyx sans attendre, assurant un streaming fluide.
– Si l’utilisateur tente d’interrompre, Telnyx enverra la voix de l’utilisateur aussi. Selon votre implémentation, vous déciderez d’en tenir compte ou non. Par défaut, on laisse l’IA finir.

8. L’IA finit sa réponse.
– OpenAI envoie un event response.output_item.done que votre Node peut utiliser pour savoir que le tour est fini -> (Point J).
– Telnyx aura reçu le dernier paquet audio à jouer. Il joue jusqu’au bout. L’utilisateur entend la fin de la phrase.

9. Nouvel échange (boucle).
– Maintenant l’utilisateur parle à nouveau en réaction à la réponse. Retour à l’étape 6. Le cycle se répète pour chaque tour de conversation. Pendant ce temps, Telnyx maintient l’appel actif.

10. Fin de l’appel.
– Soit l’utilisateur raccroche (par ex. en appuyant sur terminer appel), soit votre application décide de couper (vous pouvez faire un hangup via API Telnyx).
– Imaginons que l’utilisateur raccroche. Telnyx détecte la fin et envoie call.hangup webhook -> (Point K).
– Telnyx envoie aussi sur le WS media un event stop puis ferme la connexion WS -> (Point L).
– Votre Node, via le webhook, ferme la WS OpenAI -> (Point M).
– Tout est terminé. Vous pouvez éventuellement consigner la conversation (transcriptions, etc. récupérables via vos logs).

Pour récapituler simplement :

Landing Page → (HTTP demande) → Backend Node (init call) → (API Call) → Telnyx (call) → (rings user, opens WS) → Node WS srv → (answered) → Node opens WS OpenAI → (audio flows user→Telnyx WS→Node→OpenAI WS, and AI→Node→Telnyx WS→user) in loop → (hangup) → Node closes OpenAI WS.

Ce schéma garantit que du premier contact utilisateur (clic) jusqu’à la fin de l’appel, chaque composant interagit au bon moment. Il est recommandé de dessiner un diagramme de séquence visuel reprenant ces points pour l’équipe, mais la description ci-dessus en couvre les étapes majeures.

15. Annexes – Documentation Telnyx et OpenAI (sources)

Pour référence future, voici quelques extraits utiles de la documentation officielle utilisés dans ce rapport :

Telnyx – Media Streaming via Call Control (API v2) : “The requesting dial command can be extended to request streaming using WebSockets”
developers.telnyx.com
developers.telnyx.com
. Telnyx montre l’ajout de stream_url et stream_track dans la requête d’appel. De même, l’exemple de answer avec streaming
developers.telnyx.com
developers.telnyx.com
. La doc détaille les events envoyés sur le WebSocket : “When the WebSocket connection is established, the following event is being sent: {"event": "connected", "version": "1.0.0"}”
developers.telnyx.com
, puis “An event over WebSockets which contains ... media_format ... {"event": "start", ... "media_format": {"encoding": "PCMU", "sample_rate": 8000, "channels": 1}}”
developers.telnyx.com
developers.telnyx.com
. Chaque paquet audio : “The payload contains a base64-encoded RTP payload (no headers).”
developers.telnyx.com
. En envoi : “The RTP stream can be sent to the call using websocket ... send { "event": "media", "media": {"payload": "<base64 RTP>"} }”
developers.telnyx.com
, “Provided chunks of audio can be in a size of 20 milliseconds to 30 seconds.”
developers.telnyx.com
. Codecs supportés : “PCMU, PCMA (8k), G722 (8k), OPUS (8k,16k), AMR-WB (8k,16k), L16 (16k)”
developers.telnyx.com
. Avantage L16 : “eliminating transcoding overhead when interfacing with many AI platforms that natively support linear PCM audio.”
developers.telnyx.com
.

Telnyx – Webhooks et events : Exemples de payloads v2 : call.initiated
developers.telnyx.com
, call.answered
developers.telnyx.com
, call.hangup avec cause et stats
developers.telnyx.com
developers.telnyx.com
. Events streaming webhooks: streaming.started
developers.telnyx.com
, streaming.stopped
developers.telnyx.com
. Events WS: dtmf example
developers.telnyx.com
, error codes
developers.telnyx.com
.

OpenAI – Realtime API : Bien que la documentation OpenAI soit en évolution, on note l’existence de l’API temps réel permettant du voice-to-voice. Azure OpenAI résume : “GPT real-time models... support low-latency speech in, speech out... via WebRTC or WebSocket”
learn.microsoft.com
. L’endpoint est sécurisé wss avec query model=
learn.microsoft.com
. L’échange se fait via events JSON : “Events can be sent and received in parallel ... events each take the form of a JSON object.”
learn.microsoft.com
learn.microsoft.com
. Le guide WorkAdventure indique : “audio chunks sent by Realtime API are PCM16 at 24kHz, 1 channel, little-endian”
docs.workadventu.re
, et comment convertir en float pour lecture. Concernant l’API Node beta : “npm install openai/openai-realtime-api-beta” et usage du RealtimeClient, mais nous avons opté pour l’approche bas-niveau.

Evil Martians (Twilio + OpenAI blog) : Ce billet illustre une intégration similaire. On y voit la connexion WS OpenAI avec config : "input_audio_format": "g711_ulaw", "output_audio_format": "g711_ulaw", "input_audio_transcription": {"model":"whisper-1"} envoyé juste après dial
evilmartians.com
. Les types d’events OpenAI gérés: response.audio.delta, response.audio_transcript.delta, etc.
evilmartians.com
evilmartians.com
, et la manière de router ces events vers Twilio. Cela corrobore notre stratégie pour Telnyx.

En cas de doute, référez-vous aux docs officielles citées ci-dessus pour les détails d’implémentation. Ce rapport étant conçu pour être exhaustif, il devrait vous éviter d’avoir à y retourner fréquemment, mais il est toujours bon de vérifier les mises à jour de la documentation Telnyx et OpenAI, ces services évoluant rapidement.

Enfin, en combinant les informations de ce rapport, vous devriez disposer d’une feuille de route complète pour reconstruire de zéro votre service de rappel téléphonique automatisé utilisant Telnyx pour la couche téléphonie et GPT-Realtime d’OpenAI pour l’intelligence vocale. Bonne implémentation ! 