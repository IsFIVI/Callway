// Handles WebRTC session, tool calling and UX feedback for the landing page agent.
document.addEventListener("DOMContentLoaded", () => {
  const voiceButton = document.getElementById("btn-voice");
  const buttonText = document.getElementById("btn-text");
  const buttonLoader = document.getElementById("btn-loader");
  const audioWave = document.getElementById("audio-wave");
  const voiceStatus = document.getElementById("voice-status");
  const agentAudioEl = document.getElementById("agent-audio");

  if (!voiceButton || !buttonText || !audioWave || !agentAudioEl) {
    return;
  }

  const initialButtonText = buttonText.textContent?.trim() ?? "";
  const initialStatusText = voiceStatus?.textContent?.trim() ?? "";

  const apiBaseUrl = (window.CALLWAY_API_BASE || "").replace(/\/$/, "");

  let isActive = false;
  let greetingSent = false;
  let isPeerConnected = false;
  let audioContext = null;
  let mediaStream = null;
  let peerConnection = null;
  let dataChannel = null;

  const toolCallStates = new Map(); // itemId -> { name, responseId, argChunks: [], args }
  const processedToolCallIds = new Set();

  const getCountryHintFromNavigator = () => {
    const locale =
      navigator.language ||
      (Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages[0]
        : "") ||
      "";
    const match = /-([A-Za-z]{2})$/.exec(locale);
    return match ? match[1].toUpperCase() : null;
  };

  const resetSessionState = () => {
    toolCallStates.clear();
    processedToolCallIds.clear();
    greetingSent = false;
    isPeerConnected = false;
  };

  const setActiveState = (nextState, { errorMessage } = {}) => {
    isActive = nextState;

    if (isActive) {
      audioWave.classList.remove("hidden");
      audioWave.classList.add("active");
      voiceButton.classList.add("is-active");
      voiceButton.setAttribute("aria-pressed", "true");

      buttonText.textContent = "Connecting to Callway…";
      if (buttonLoader) {
        buttonLoader.classList.remove("hidden");
        buttonLoader.textContent = "●";
      }
      if (voiceStatus) {
        voiceStatus.textContent = "Enabling microphone access.";
      }
      return;
    }

    audioWave.classList.add("hidden");
    audioWave.classList.remove("active");
    voiceButton.classList.remove("is-active");
    voiceButton.setAttribute("aria-pressed", "false");

    buttonText.textContent = initialButtonText;
    if (buttonLoader) {
      buttonLoader.classList.add("hidden");
      buttonLoader.textContent = "";
    }
    if (voiceStatus) {
      voiceStatus.textContent = errorMessage
        ? `Error: ${errorMessage}`
        : initialStatusText;
    }

    if (peerConnection) {
      peerConnection.ontrack = null;
      peerConnection.onicecandidate = null;
      peerConnection.ondatachannel = null;
      peerConnection.close();
      peerConnection = null;
    }

    if (dataChannel) {
      dataChannel.onmessage = null;
      dataChannel.onopen = null;
      dataChannel.close();
      dataChannel = null;
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    agentAudioEl.srcObject = null;
    agentAudioEl.classList.add("hidden");

    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch(() => undefined);
    }
    audioContext = null;

    resetSessionState();
  };

  const waitForIceGatheringComplete = (pc) =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      const finish = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", finish);
          resolve();
        }
      };

      pc.addEventListener("icegatheringstatechange", finish);

      setTimeout(() => {
        pc.removeEventListener("icegatheringstatechange", finish);
        resolve();
      }, 1000);
    });

  const sendToolOutput = (toolCallId, callId, payload) => {
    if (!toolCallId || !callId) {
      return;
    }

    if (!dataChannel || dataChannel.readyState !== "open") {
      return;
    }

    try {
      dataChannel.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(payload),
          },
        })
      );
    } catch (error) {
      console.error("[agent] Failed to send function_call_output", error);
    }

    try {
      dataChannel.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions: null,
          },
        })
      );
    } catch (error) {
      console.error("[agent] Failed to trigger response after tool", error);
    }
  };

  const runSaveLeadTool = async (call) => {
    if (!call || call.name !== "save_lead") {
      return;
    }

    const toolCallId = call.toolCallId || call.itemId;
    const responseId = call.callId || call.responseId;

    if (!toolCallId) {
      console.warn("[agent] save_lead without toolCallId", call);
      return;
    }

    if (processedToolCallIds.has(toolCallId)) {
      return;
    }
    processedToolCallIds.add(toolCallId);

    if (!call.args || typeof call.args !== "object") {
      const payload = {
        success: false,
        error: "invalid_tool_arguments",
        details: call.args ?? null,
      };
      sendToolOutput(toolCallId, responseId, payload);
      return;
    }

    const countryHint = call.args.country_hint || getCountryHintFromNavigator();

    const requestPayload = {
      first_name: call.args.first_name,
      last_name: call.args.last_name,
      phone_raw: call.args.phone_raw,
      country_hint: countryHint,
      summary: call.args.summary,
      source: call.args.source,
    };

    try {
      console.info("[agent] save_lead request", requestPayload);
      const response = await fetch(`${apiBaseUrl}/api/tools/save_lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      const result = await response.json();

      const payload = {
        success: response.ok,
        data: response.ok ? result : null,
        error: response.ok ? null : result?.error || "tool_error",
        details: response.ok ? undefined : result?.details,
      };

      sendToolOutput(toolCallId, responseId, payload);

      if (voiceStatus) {
        voiceStatus.textContent = response.ok
          ? "Lead enregistré, Callway finalise votre demande…"
          : "Numéro non reconnu. L'agent va demander une précision.";
      }
    } catch (error) {
      console.error("[agent] save_lead request failed", error);
      const payload = {
        success: false,
        error: "network_error",
        details: error?.message ?? String(error),
      };
      sendToolOutput(toolCallId, responseId, payload);
      if (voiceStatus) {
        voiceStatus.textContent = "Erreur réseau. Merci de réessayer.";
      }
    }
  };

  const runTriggerCallTool = async (call) => {
    if (!call || call.name !== "trigger_call") {
      return;
    }

    const toolCallId = call.toolCallId || call.callId || call.itemId;

    if (toolCallId && processedToolCallIds.has(toolCallId)) {
      return;
    }
    const responseId = call.callId || call.responseId;

    if (!toolCallId) {
      console.warn("[agent] trigger_call without toolCallId", call);
      return;
    }

    if (processedToolCallIds.has(toolCallId)) {
      return;
    }
    processedToolCallIds.add(toolCallId);

    const leadId = call.args?.lead_id;
    const summary = call.args?.summary;

    if (!leadId) {
      const payload = {
        success: false,
        error: "missing_lead_id",
        details: call.args ?? null,
      };
      sendToolOutput(toolCallId, responseId, payload);
      return;
    }

    const requestPayload = {
      lead_id: leadId,
      summary: summary,
    };

    try {
      console.info("[agent] trigger_call request", requestPayload);
      const response = await fetch(`${apiBaseUrl}/api/tools/trigger_call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      const result = await response.json();

      const payload = {
        success: response.ok,
        data: response.ok ? result : null,
        error: response.ok ? null : result?.error || "tool_error",
        details: response.ok ? undefined : result?.details,
      };

      if (response.ok && voiceStatus) {
        voiceStatus.textContent =
          "Callway prépare le rappel. Restez près de votre téléphone.";
      } else if (!response.ok && voiceStatus) {
        voiceStatus.textContent =
          "Impossible de lancer l'appel. L'agent va réessayer.";
      }

      sendToolOutput(toolCallId, responseId, payload);
    } catch (error) {
      console.error("[agent] trigger_call request failed", error);
      const payload = {
        success: false,
        error: "network_error",
        details: error?.message ?? String(error),
      };
      sendToolOutput(toolCallId, responseId, payload);
      if (voiceStatus) {
        voiceStatus.textContent =
          "Erreur réseau sur le rappel. Merci de patienter.";
      }
    }
  };

  const processToolCall = (call) => {
    if (!call || !call.name) {
      console.warn("[agent] Tool call without name", call);
      return;
    }

    const toolCallId = call.toolCallId || call.callId || call.itemId;

    switch (call.name) {
      case "save_lead":
        runSaveLeadTool(call);
        break;
      case "trigger_call":
        runTriggerCallTool(call);
        break;
      default:
        console.warn("[agent] Unsupported tool call", call.name);
        if (toolCallId) {
          processedToolCallIds.add(toolCallId);
        }
        sendToolOutput(toolCallId, call.callId || call.responseId, {
          success: false,
          error: "unsupported_tool",
          details: call.name,
        });
    }
  };

  const parseToolArguments = (args) => {
    if (!args) {
      return {};
    }
    if (typeof args === "string") {
      try {
        return JSON.parse(args);
      } catch (error) {
        console.warn("[agent] Failed to parse tool arguments string", args);
        return {};
      }
    }
    if (typeof args === "object") {
      return { ...args };
    }
    return {};
  };

  const sendInitialGreetingIfReady = () => {
    if (
      greetingSent ||
      !isPeerConnected ||
      !dataChannel ||
      dataChannel.readyState !== "open"
    ) {
      return;
    }

    const greetingPayload = {
      type: "response.create",
      response: {
        modalities: ["audio", "text"],
        conversation: "none",
        instructions:
          "Réponds en français exactement avec la phrase suivante : \"Bonjour, c'est l'assistant Callway, en quoi puis-je vous aider ?\"",
        voice: "alloy",
      },
    };

    try {
      dataChannel.send(JSON.stringify(greetingPayload));
      greetingSent = true;
      if (voiceStatus) {
        voiceStatus.textContent = "Callway vous écoute. Parlez quand vous voulez.";
      }
    } catch (error) {
      console.error("[agent] Failed to send greeting", error);
    }
  };

  const handleRealtimeEvent = (messageEvent) => {
    try {
      const parsed = JSON.parse(messageEvent.data);

      if (parsed.type === "session.created") {
        sendInitialGreetingIfReady();
      }

    if (parsed.type === "response.created") {
      const toolCalls = parsed.response?.tool_calls;
      if (!Array.isArray(toolCalls)) {
        return;
      }

      toolCalls.forEach((toolCall) => {
        const callId =
          toolCall?.function?.call_id ??
          toolCall?.call_id ??
          toolCall?.id ??
          parsed.response?.id;
        if (!callId) {
          return;
        }

        const toolFunction = toolCall?.function || {};
        const name =
          toolCall?.name ||
          toolFunction?.name ||
          parsed.response?.name ||
          parsed.response?.tool;

        const args = parseToolArguments(
          toolFunction?.arguments ?? toolCall?.arguments
        );

        toolCallStates.set(callId, {
          name,
          responseId: parsed.response?.id ?? parsed.response?.response_id,
          toolCallId: callId,
          argChunks: [],
          args: Object.keys(args).length > 0 ? args : null,
        });

        if (name === "save_lead" && Object.keys(args).length > 0) {
          processToolCall({
            name,
            toolCallId: callId,
            callId,
            responseId: parsed.response?.id,
            args,
          });
        }
      });
      return;
    }

    if (parsed.type?.startsWith("response.function_call")) {
      const responseId = parsed.response_id ?? parsed.response?.id;
      const callId =
        parsed.call_id ?? parsed.item?.call_id ?? parsed.item?.id ?? parsed.item_id;
      if (!callId) {
        return;
      }

      if (!toolCallStates.has(callId)) {
        toolCallStates.set(callId, {
          name: undefined,
          responseId,
          toolCallId: callId,
          argChunks: [],
          args: null,
        });
      }

      const state = toolCallStates.get(callId);

      if (parsed.type === "response.function_call.delta" && parsed.delta?.name) {
        state.name = parsed.delta.name;
        return;
      }

      if (parsed.type === "response.function_call_arguments.delta") {
        state.argChunks.push(parsed.delta || "");
        return;
      }

      if (parsed.type === "response.function_call_arguments.done") {
        const serialized = state.argChunks.join("");
        toolCallStates.delete(callId);

        let parsedArguments = state.args || {};
        if (serialized) {
          try {
            const parsedJson = JSON.parse(serialized);
              if (parsedJson && typeof parsedJson === "object") {
                parsedArguments = parsedJson;
              }
            } catch (error) {
              console.warn("[agent] Unable to parse tool arguments JSON", serialized);
            }
        }

        const callName =
          state.name || parsed.name || parsed.function?.name || parsed.function_call?.name;

        if (
          parsedArguments &&
          typeof parsedArguments === "object" &&
          !Array.isArray(parsedArguments)
        ) {
          delete parsedArguments.phone_e164;
        }

        if (callName === "save_lead") {
          console.info("[agent] save_lead payload", parsedArguments);
        } else if (callName === "trigger_call") {
          console.info("[agent] trigger_call payload", parsedArguments);
        } else {
          console.info("[agent] Tool call payload", {
            name: callName,
            arguments: parsedArguments,
          });
        }

        processToolCall({
          name: callName,
          responseId,
          toolCallId: state.toolCallId,
          callId: state.toolCallId,
          args: parsedArguments,
        });
        return;
      }

        return;
      }

      if (parsed.type === "response.completed") {
        if (voiceStatus) {
          voiceStatus.textContent = "Conversation complete.";
        }
        console.info("[agent] Response completed", parsed.response?.id ?? "unknown");
        return;
      }

      if (parsed.type === "error" || parsed.type === "response.error") {
        const errMessage = parsed.error?.message || parsed.error?.code || parsed;
        console.error("[agent] Realtime error", errMessage, parsed);
        return;
      }

      if (parsed.type?.startsWith("input.audio")) {
        return;
      }

      console.debug("[agent] Realtime event", parsed);
    } catch (error) {
      console.warn("[agent] Received non-JSON realtime event", messageEvent.data);
    }
  };

  const connectToRealtime = async () => {
    try {
      resetSessionState();

      if (!audioContext || audioContext.state === "closed") {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      await audioContext.resume();

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      if (voiceStatus) {
        voiceStatus.textContent = "Microphone access granted. Negotiating connection…";
      }

      peerConnection = new RTCPeerConnection();

      dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannel.addEventListener("open", sendInitialGreetingIfReady);
      dataChannel.addEventListener("message", handleRealtimeEvent);

      peerConnection.ondatachannel = (event) => {
        if (!event.channel) {
          return;
        }
        dataChannel = event.channel;
        dataChannel.addEventListener("open", sendInitialGreetingIfReady);
        dataChannel.addEventListener("message", handleRealtimeEvent);
      };

      mediaStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) {
          return;
        }
        agentAudioEl.srcObject = remoteStream;
        agentAudioEl.classList.remove("hidden");
        agentAudioEl.play().catch(() => undefined);
        if (voiceStatus) {
          voiceStatus.textContent = "Connected. Say something to Callway.";
        }
      };

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        if (!voiceStatus) {
          return;
        }

        if (state === "connected") {
          voiceStatus.textContent = "Callway est connecté. Vous pouvez parler.";
          buttonText.textContent = "Hang up";
          isPeerConnected = true;
          sendInitialGreetingIfReady();
        } else if (state === "failed") {
          voiceStatus.textContent = "Connection failed. Please try again.";
          isPeerConnected = false;
          setActiveState(false, { errorMessage: "Connection failed" });
        } else if (state === "disconnected") {
          voiceStatus.textContent = "Disconnected. Tap again to reconnect.";
          isPeerConnected = false;
          setActiveState(false, { errorMessage: "Connection lost" });
        } else if (state === "closed") {
          isPeerConnected = false;
          setActiveState(false);
        }
      };

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await waitForIceGatheringComplete(peerConnection);

      const localDescription = peerConnection.localDescription;
      if (!localDescription?.sdp) {
        throw new Error("Local SDP missing after ICE gathering");
      }

      const tokenResponse = await fetch(`${apiBaseUrl}/api/realtime-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice: "alloy" }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`Token request failed: ${errorText}`);
      }

      const sessionPayload = await tokenResponse.json();
      const { client_secret: clientSecret, model } = sessionPayload;

      if (!clientSecret || !clientSecret.value) {
        throw new Error("No client secret returned by /api/realtime-token");
      }

      const realtimeUrl = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(
        model || "gpt-realtime"
      )}`;

      const realtimeResponse = await fetch(realtimeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
          Authorization: `Bearer ${clientSecret.value}`,
          "OpenAI-Beta": "realtime=v1",
        },
        body: localDescription.sdp,
      });

      if (!realtimeResponse.ok) {
        const errorText = await realtimeResponse.text();
        throw new Error(`Realtime SDP exchange failed: ${errorText}`);
      }

      const answer = await realtimeResponse.text();
      await peerConnection.setRemoteDescription({ type: "answer", sdp: answer });

      if (voiceStatus) {
        voiceStatus.textContent = "Connected to Callway. Say “Bonjour” to start.";
      }
    } catch (error) {
      console.error("[agent] Failed to connect to realtime", error);
      setActiveState(false, { errorMessage: error?.message ?? "Realtime connection failed" });
    }
  };

  voiceButton.addEventListener("click", () => {
    if (isActive) {
      setActiveState(false);
      return;
    }

    setActiveState(true);
    connectToRealtime();
  });

  setActiveState(false);
});
