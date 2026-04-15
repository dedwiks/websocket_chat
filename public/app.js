(() => {
  const EMPTY_CHAT_MARKUP = '<div class="m-auto text-sm text-on-surface-variant">Select a user or search to start a direct connection.</div>';
  const EMPTY_HISTORY_MARKUP = '<div class="m-auto text-sm text-on-surface-variant">No messages yet. Start the conversation.</div>';

  const state = {
    accessToken: "",
    refreshToken: "",
    user: null,
    socket: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    queue: [],
    activeConversationId: "",
    conversations: [],
    typingTimeout: null
  };

  const UI = {
    loginView: document.getElementById("login-view"),
    chatView: document.getElementById("chat-view"),
    loginForm: document.getElementById("login-form"),
    usernameInput: document.getElementById("username"),
    passwordInput: document.getElementById("password"),
    loginError: document.getElementById("login-error"),
    loginErrorText: document.getElementById("login-error-text"),
    registerBtn: document.getElementById("register-btn"),
    logoutBtn: document.getElementById("logout-btn"),
    connIndicator: document.getElementById("connection-indicator"),
    connStatusText: document.getElementById("connection-status-text"),
    myAvatar: document.getElementById("my-avatar"),
    myUsername: document.getElementById("my-username"),
    userSearch: document.getElementById("user-search"),
    searchResults: document.getElementById("search-results"),
    convoList: document.getElementById("sidebar-conversations-list"),
    chatHeaderInfo: document.getElementById("chat-header-info"),
    activeChatAvatar: document.getElementById("active-chat-avatar"),
    activeChatName: document.getElementById("active-chat-name"),
    activeChatTyping: document.getElementById("active-chat-typing"),
    msgContainer: document.getElementById("chat-messages-container"),
    chatInputArea: document.getElementById("chat-input-area"),
    messageForm: document.getElementById("message-form"),
    messageInput: document.getElementById("message-input"),
    tplIncoming: document.getElementById("tpl-incoming-msg"),
    tplOutgoing: document.getElementById("tpl-outgoing-msg"),
    tplConvo: document.getElementById("tpl-convo-list-item")
  };

  function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async function request(path, method, body, auth = true) {
    const headers = { "Content-Type": "application/json" };
    if (auth && state.accessToken) {
      headers.Authorization = `Bearer ${state.accessToken}`;
    }

    const response = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "request failed");
    }
    return payload;
  }

  async function performLogin() {
    UI.loginError.classList.add("hidden");

    try {
      const result = await request("/login", "POST", {
        username: UI.usernameInput.value,
        password: UI.passwordInput.value
      }, false);

      state.accessToken = result.access_token;
      state.refreshToken = result.refresh_token;
      state.user = result.user;

      showChatView();
      connectSocket();
    } catch (error) {
      UI.loginError.classList.remove("hidden");
      UI.loginErrorText.textContent = error.message;
    }
  }

  async function refreshToken() {
    if (!state.refreshToken) {
      throw new Error("missing refresh token");
    }

    const result = await request("/refresh", "POST", { refresh_token: state.refreshToken }, false);
    state.accessToken = result.access_token;
    state.refreshToken = result.refresh_token;
    log("access token refreshed");
    return result;
  }

  function showChatView() {
    UI.loginView.classList.add("hidden");
    UI.chatView.classList.remove("hidden");
    UI.myUsername.textContent = state.user.username;
    UI.myAvatar.textContent = state.user.username[0].toUpperCase();
  }

  function showLoginView() {
    UI.chatView.classList.add("hidden");
    UI.loginView.classList.remove("hidden");
    UI.chatHeaderInfo.style.visibility = "hidden";
    UI.chatInputArea.classList.add("opacity-50", "pointer-events-none");
    UI.activeChatTyping.classList.add("hidden");
    UI.msgContainer.innerHTML = EMPTY_CHAT_MARKUP;
  }

  function updateConnState(status) {
    if (status === "connecting") {
      UI.connIndicator.className = "h-2.5 w-2.5 rounded-full bg-primary";
      UI.connStatusText.textContent = "Connecting...";
    } else if (status === "online") {
      UI.connIndicator.className = "h-2.5 w-2.5 rounded-full bg-primary";
      UI.connStatusText.textContent = "Online";
    } else {
      UI.connIndicator.className = "h-2.5 w-2.5 rounded-full bg-on-surface-variant";
      UI.connStatusText.textContent = "Offline";
    }
  }

  function resetSessionState() {
    state.accessToken = "";
    state.refreshToken = "";
    state.user = null;
    state.activeConversationId = "";
    state.conversations = [];
    state.queue = [];
    state.reconnectAttempts = 0;
    renderConversations();
    UI.loginForm.reset();
    UI.searchResults.classList.add("hidden");
    UI.userSearch.value = "";
  }

  function logoutToLogin() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    if (state.socket) {
      const socket = state.socket;
      state.socket = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch (error) {
        log(`socket close failed: ${error.message}`);
      }
    }

    resetSessionState();
    updateConnState("offline");
    showLoginView();
  }

  function scheduleReconnect() {
    if (state.reconnectTimer || !state.refreshToken) {
      return;
    }

    const delay = Math.min(30000, 500 * (2 ** state.reconnectAttempts));
    state.reconnectAttempts += 1;
    updateConnState("connecting");
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      try {
        await refreshToken();
        connectSocket();
      } catch (error) {
        log(`refresh failed before reconnect: ${error.message}`);
        logoutToLogin();
      }
    }, delay);
  }

  function flushQueue() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (state.queue.length > 0) {
      state.socket.send(state.queue.shift());
    }
    log("queued messages flushed");
  }

  function sendSocket(payload) {
    const serialized = JSON.stringify(payload);
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      state.queue.push(serialized);
      log(`queued offline event: ${payload.type}`);
      return;
    }
    state.socket.send(serialized);
  }

  function connectSocket() {
    if (!state.accessToken) {
      return;
    }
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    updateConnState("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    state.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.socket.onopen = () => {
      state.socket.send(JSON.stringify({ type: "auth", jwt: state.accessToken }));
    };

    state.socket.onmessage = async (event) => {
      const payload = JSON.parse(event.data);
      log(`recv WS: ${payload.type}`);

      switch (payload.type) {
        case "auth_success":
          updateConnState("online");
          state.reconnectAttempts = 0;
          flushQueue();
          if (state.activeConversationId) {
            sendSocket({ type: "join_conversation", cid: state.activeConversationId });
          }
          break;
        case "auth_error":
          try {
            await refreshToken();
            state.socket.close();
          } catch (error) {
            logoutToLogin();
          }
          break;
        case "message":
          if (payload.cid === state.activeConversationId && payload.uid !== state.user.id) {
            appendMessage(payload, false);
          }
          break;
        case "message_ack": {
          const el = document.getElementById(`msg-${payload.client_id}`);
          if (el) {
            const bubble = el.querySelector(".message-bubble");
            bubble.classList.remove("opacity-80");
            const icon = el.querySelector(".msg-status-icon");
            icon.textContent = "done_all";
            icon.classList.add("text-primary");
            icon.classList.remove("text-on-surface-variant");
          }
          break;
        }
        case "user_typing":
          if (payload.cid === state.activeConversationId && payload.uid !== state.user.id) {
            UI.activeChatTyping.classList.remove("hidden");
            clearTimeout(state.typingTimeout);
            state.typingTimeout = setTimeout(() => {
              UI.activeChatTyping.classList.add("hidden");
            }, 3000);
          }
          break;
        case "error":
          log(`server error: ${payload.msg}`);
          break;
      }
    };

    state.socket.onclose = () => {
      updateConnState("offline");
      scheduleReconnect();
    };
  }

  function appendMessage(data, isOutgoing) {
    const tpl = isOutgoing ? UI.tplOutgoing : UI.tplIncoming;
    const el = tpl.content.cloneNode(true);

    const timeStr = new Date(data.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    el.querySelector(".message-text").textContent = data.msg;
    el.querySelector(".message-time").textContent = timeStr;

    if (isOutgoing) {
      el.querySelector("div[id^='msg-']").id = `msg-${data.client_id}`;
    }

    UI.msgContainer.appendChild(el);
    UI.msgContainer.scrollTop = UI.msgContainer.scrollHeight;
  }

  async function loadConversationHistory(conversationId) {
    const result = await request(`/conversations/${conversationId}/messages`, "GET");
    UI.msgContainer.innerHTML = "";

    if (result.items.length === 0) {
      UI.msgContainer.innerHTML = EMPTY_HISTORY_MARKUP;
      return;
    }

    result.items.forEach((item) => {
      appendMessage({
        msg: item.content,
        ts: item.timestamp,
        client_id: item.clientId
      }, item.senderId === state.user.id);
    });
  }

  async function activateConversation(conversationId, peerName) {
    state.activeConversationId = conversationId;
    UI.chatHeaderInfo.style.visibility = "visible";
    UI.activeChatName.textContent = peerName;
    UI.activeChatAvatar.textContent = peerName[0].toUpperCase();
    UI.chatInputArea.classList.remove("opacity-50", "pointer-events-none");
    renderConversations();
    sendSocket({ type: "join_conversation", cid: conversationId });
    await loadConversationHistory(conversationId);
  }

  async function openDirectChat(peerId, peerName) {
    const result = await request("/conversations/direct", "POST", { userId: peerId });

    if (!state.conversations.find((entry) => entry.id === result.id)) {
      state.conversations.push({ id: result.id, name: peerName });
    }

    await activateConversation(result.id, peerName);
  }

  function renderConversations() {
    UI.convoList.innerHTML = "";
    state.conversations.forEach((conversation) => {
      const el = UI.tplConvo.content.cloneNode(true);
      el.querySelector(".convo-name").textContent = conversation.name;
      el.querySelector(".convo-icon").textContent = conversation.name[0].toUpperCase();

      const container = el.querySelector(".conversation-item");
      if (conversation.id === state.activeConversationId) {
        container.classList.add("bg-surface-container-highest", "border-l-2", "border-primary");
      }

      container.addEventListener("click", async () => {
        if (state.activeConversationId === conversation.id) {
          return;
        }
        await activateConversation(conversation.id, conversation.name);
      });

      UI.convoList.appendChild(el);
    });
  }

  UI.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    performLogin();
  });

  if (UI.registerBtn) {
    UI.registerBtn.addEventListener("click", () => {
      window.location.href = "/register";
    });
  }

  UI.logoutBtn.addEventListener("click", () => {
    logoutToLogin();
  });

  UI.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const msg = UI.messageInput.value.trim();
    if (!msg || !state.activeConversationId) {
      return;
    }

    const clientId = crypto.randomUUID();
    appendMessage({ msg, ts: Date.now(), client_id: clientId }, true);
    sendSocket({ type: "send_message", cid: state.activeConversationId, client_id: clientId, msg });
    UI.messageInput.value = "";
  });

  let typingDebounce;
  UI.messageInput.addEventListener("input", () => {
    if (!state.activeConversationId) {
      return;
    }
    clearTimeout(typingDebounce);
    sendSocket({ type: "typing", cid: state.activeConversationId });
    typingDebounce = setTimeout(() => {}, 2000);
  });

  let searchDebounce;
  UI.userSearch.addEventListener("input", () => {
    const q = UI.userSearch.value.trim();
    if (q.length < 2) {
      UI.searchResults.classList.add("hidden");
      return;
    }

    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(async () => {
      try {
        const res = await request(`/users/search?q=${encodeURIComponent(q)}`, "GET");
        UI.searchResults.innerHTML = "";

        if (res.items.length === 0) {
          UI.searchResults.innerHTML = '<div class="p-4 text-xs font-bold text-on-surface-variant uppercase tracking-widest text-center">No users found</div>';
        } else {
          res.items.forEach((user) => {
            const div = document.createElement("div");
            div.className = "p-3 hover:bg-surface-container rounded-lg cursor-pointer text-sm font-bold flex items-center gap-3 font-headline text-on-surface transition-colors";
            div.innerHTML = `<div class="w-8 h-8 rounded bg-primary-container text-on-primary-container flex justify-center items-center text-xs uppercase">${user.username[0]}</div> <span>${user.username}</span>`;
            div.onclick = async () => {
              UI.searchResults.classList.add("hidden");
              UI.userSearch.value = "";
              await openDirectChat(user.id, user.username);
            };
            UI.searchResults.appendChild(div);
          });
        }

        UI.searchResults.classList.remove("hidden");
      } catch (error) {
        log(`user search failed: ${error.message}`);
      }
    }, 400);
  });

  document.addEventListener("click", (event) => {
    if (!UI.userSearch.contains(event.target) && !UI.searchResults.contains(event.target)) {
      UI.searchResults.classList.add("hidden");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ type: "pong" }));
    }
  });
})();
