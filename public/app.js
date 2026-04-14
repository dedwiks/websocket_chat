(() => {
  const state = {
    accessToken: "",
    refreshToken: "",
    user: null,
    socket: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    queue: [],
    activeConversationId: "",
    conversations: [], // caches current conversations
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
    sendBtn: document.getElementById("send-btn"),
    
    tplIncoming: document.getElementById("tpl-incoming-msg"),
    tplOutgoing: document.getElementById("tpl-outgoing-msg"),
    tplConvo: document.getElementById("tpl-convo-list-item")
  };

  function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  // --- HTTP Layer ---
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

  // --- Authentication ---
  async function performAuth(action) {
    UI.loginError.classList.add("hidden");
    try {
      const endpoint = action === "login" ? "/login" : "/register";
      const result = await request(endpoint, "POST", {
        username: UI.usernameInput.value,
        password: UI.passwordInput.value
      }, false);
      
      state.accessToken = result.access_token;
      state.refreshToken = result.refresh_token;
      state.user = result.user;
      
      showChatView();
      connectSocket();
    } catch (err) {
      UI.loginError.classList.remove("hidden");
      UI.loginErrorText.textContent = err.message;
    }
  }

  async function refreshToken() {
    if (!state.refreshToken) throw new Error("missing refresh token");
    const result = await request("/refresh", "POST", { refresh_token: state.refreshToken }, false);
    state.accessToken = result.access_token;
    state.refreshToken = result.refresh_token;
    log("access token refreshed");
    return result;
  }

  // --- UI Switching ---
  function showChatView() {
    UI.loginView.classList.add("hidden");
    UI.chatView.classList.remove("hidden");
    UI.myUsername.textContent = state.user.username;
    UI.myAvatar.textContent = state.user.username[0].toUpperCase();
  }

  // --- WebSocket Layer ---
  function updateConnState(status) {
    if (status === "connecting") {
      UI.connIndicator.className = "w-2 h-2 rounded-full bg-error shadow-[0_0_8px_#ff716c] animate-pulse";
      UI.connStatusText.textContent = "Connecting...";
    } else if (status === "online") {
      UI.connIndicator.className = "w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_#3bbffa]";
      UI.connStatusText.textContent = "Online";
    } else {
      UI.connIndicator.className = "w-2 h-2 rounded-full bg-error shadow-[0_0_8px_#ff716c]";
      UI.connStatusText.textContent = "Offline";
    }
  }

  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    const delay = Math.min(30000, 500 * (2 ** state.reconnectAttempts));
    state.reconnectAttempts += 1;
    updateConnState("connecting");
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      try {
        await refreshToken();
      } catch (e) {
        log(`refresh failed before reconnect: ${e.message}`);
      }
      connectSocket();
    }, delay);
  }

  function flushQueue() {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
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
    if (!state.accessToken) return;
    if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    updateConnState("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    state.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.socket.onopen = () => {
      // Contract Requirement: Immediately send "auth" event with JWT
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
           state.socket.close();
           try { await refreshToken(); connectSocket(); } catch(e) { }
           break;
        case "message":
           if (payload.cid === state.activeConversationId && payload.uid !== state.user.id) {
             appendMessage(payload, false);
           }
           break;
        case "message_ack":
           const el = document.getElementById("msg-" + payload.client_id);
           if (el) {
             const bubble = el.querySelector(".message-bubble");
             bubble.classList.remove("opacity-80");
             const icon = el.querySelector(".msg-status-icon");
             icon.textContent = "done_all";
             icon.classList.add("text-primary");
             icon.classList.remove("text-on-surface-variant");
           }
           break;
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

    state.socket.onclose = (e) => {
      updateConnState("offline");
      scheduleReconnect();
    };
  }

  // --- Data / UI Rendering ---
  async function openDirectChat(peerId, peerName) {
    const result = await request("/conversations/direct", "POST", { userId: peerId });
    state.activeConversationId = result.id;
    
    // UI Visual Changes
    UI.chatHeaderInfo.style.visibility = "visible";
    UI.activeChatName.textContent = peerName;
    UI.activeChatAvatar.textContent = peerName[0].toUpperCase();
    UI.chatInputArea.classList.remove("opacity-50", "pointer-events-none");
    UI.msgContainer.innerHTML = "";
    
    sendSocket({ type: "join_conversation", cid: result.id });
    
    let conExists = state.conversations.find(c => c.id === result.id);
    if (!conExists) {
      state.conversations.push({ id: result.id, name: peerName });
      renderConversations();
    }
  }

  function renderConversations() {
    UI.convoList.innerHTML = "";
    state.conversations.forEach(c => {
       const el = UI.tplConvo.content.cloneNode(true);
       el.querySelector('.convo-name').textContent = c.name;
       el.querySelector('.convo-icon').textContent = c.name[0].toUpperCase();
       
       const container = el.querySelector('.conversation-item');
       if (c.id === state.activeConversationId) {
         container.classList.add("bg-surface-container-highest", "border-l-2", "border-primary");
       }
       
       container.addEventListener("click", () => {
          if (state.activeConversationId === c.id) return;
          state.activeConversationId = c.id;
          setupChatForId(c.id, c.name);
       });
       UI.convoList.appendChild(el);
    });
  }

  function setupChatForId(cid, name) {
     sendSocket({ type: "join_conversation", cid });
     UI.chatHeaderInfo.style.visibility = "visible";
     UI.activeChatName.textContent = name;
     UI.activeChatAvatar.textContent = name[0].toUpperCase();
     UI.chatInputArea.classList.remove("opacity-50", "pointer-events-none");
     UI.msgContainer.innerHTML = "";
     renderConversations(); // Updates highlight
  }

  function appendMessage(data, isOutgoing) {
    const tpl = isOutgoing ? UI.tplOutgoing : UI.tplIncoming;
    const el = tpl.content.cloneNode(true);
    
    const timeStr = new Date(data.ts).toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });
    el.querySelector('.message-text').textContent = data.msg;
    el.querySelector('.message-time').textContent = timeStr;
    
    if (isOutgoing) {
      el.querySelector("div[id^='msg-']").id = "msg-" + data.client_id;
    }
    
    UI.msgContainer.appendChild(el);
    UI.msgContainer.scrollTop = UI.msgContainer.scrollHeight;
  }

  // --- Handlers ---
  UI.loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    performAuth("login");
  });
  UI.registerBtn.addEventListener("click", () => {
    if (UI.usernameInput.value && UI.passwordInput.value) performAuth("register");
  });

  UI.messageForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = UI.messageInput.value.trim();
    if (!msg || !state.activeConversationId) return;
    
    const clid = crypto.randomUUID();
    const payload = { type: "send_message", cid: state.activeConversationId, client_id: clid, msg };
    
    // Contract Request: Optimistic local update
    appendMessage({ msg, ts: Date.now(), client_id: clid }, true);
    
    sendSocket(payload);
    UI.messageInput.value = "";
  });

  let typingDebounce;
  UI.messageInput.addEventListener("input", () => {
    if (!state.activeConversationId) return;
    clearTimeout(typingDebounce);
    sendSocket({ type: "typing", cid: state.activeConversationId });
    typingDebounce = setTimeout(() => {}, 2000);
  });

  // User Search
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
           res.items.forEach(u => {
              const div = document.createElement("div");
              div.className = "p-3 hover:bg-surface-container rounded-lg cursor-pointer text-sm font-bold flex items-center gap-3 font-headline text-on-surface transition-colors";
              div.innerHTML = `<div class="w-8 h-8 rounded bg-primary-container text-on-primary-container flex justify-center items-center text-xs uppercase">${u.username[0]}</div> <span>${u.username}</span>`;
              div.onclick = () => {
                 UI.searchResults.classList.add("hidden");
                 UI.userSearch.value = "";
                 openDirectChat(u.id, u.username);
              };
              UI.searchResults.appendChild(div);
           });
        }
        UI.searchResults.classList.remove("hidden");
      } catch (e) {
        // ignore
      }
    }, 400);
  });

  // Close search results if clicked outside
  document.addEventListener("click", (e) => {
    if (!UI.userSearch.contains(e.target) && !UI.searchResults.contains(e.target)) {
      UI.searchResults.classList.add("hidden");
    }
  });

  // Keep heartbeat alive by observing document visibility
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (state.socket && state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ type: "pong" }));
      }
    }
  });
})();
