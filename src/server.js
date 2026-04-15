process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 UNHANDLED REJECTION:", err);
});

console.log("==== ENV DEBUG START ====");
console.log("DATABASE_URL:", process.env.DATABASE_URL);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("All ENV keys:", Object.keys(process.env));
console.log("==== ENV DEBUG END ====");

const http = require("node:http");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");
const config = require("./config");
const { route } = require("./http/router");
const pool = require("./infra/postgres");
const { command, publisher, subscriber } = require("./infra/redis");
const userRepo = require("./repos/user-repo");
const presenceService = require("./services/presence-service");
const { verifyAccessToken } = require("./auth/tokens");
const ConnectionRegistry = require("./websocket/connection-registry");
const { handleClientEvent } = require("./websocket/protocol");

const registry = new ConnectionRegistry();
const server = http.createServer(route);
const wss = new WebSocketServer({ noServer: true });
const subscribedConversationChannels = new Set();
let isShuttingDown = false;

async function subscribeConversationChannel(conversationId) {
  const channel = `conversation:${conversationId}`;
  if (subscribedConversationChannels.has(channel)) {
    return;
  }

  await subscriber.subscribe(channel);
  subscribedConversationChannels.add(channel);
}

server.on("upgrade", (request, socket, head) => {
  if (isShuttingDown) {
    socket.destroy();
    return;
  }

  try {
    console.log("UPGRADE REQUEST:", request.url);

    const url = new URL(request.url, config.appBaseUrl);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    if (request.headers.origin && request.headers.origin !== config.clientOrigin) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } catch (err) {
    console.error("💥 UPGRADE ERROR:", err);
    socket.destroy();
  }
});

wss.on("connection", async (ws, request) => {
  console.log("WS CONNECTED");

  let socketId = null;
  let tokenExpiryTimer = null;

  try {
    const url = new URL(request.url, "http://localhost");
    const token = url.searchParams.get("token");

    if (!token) {
      console.error("Missing token");
      ws.send(JSON.stringify({ type: "auth_error", msg: "missing token" }));
      ws.close();
      return;
    }

    let tokenPayload;
    try {
      tokenPayload = verifyAccessToken(token);
    } catch (err) {
      console.error("Invalid token:", err);
      ws.send(JSON.stringify({ type: "auth_error", msg: "invalid token" }));
      ws.close();
      return;
    }

    const user = await userRepo.findById(tokenPayload.sub);
    if (!user) {
      console.error("Invalid token user:", tokenPayload.sub);
      ws.send(JSON.stringify({ type: "auth_error", msg: "unknown user" }));
      ws.close();
      return;
    }

    ws.user = user;
    ws.tokenExpMs = tokenPayload.exp ? tokenPayload.exp * 1000 : null;
    socketId = await registry.register(ws, ws.user);
    ws.socketId = socketId;
    ws.send(JSON.stringify({ type: "auth_success" }));
    console.log("WS CONNECTED:", tokenPayload.usr);

    if (ws.tokenExpMs) {
      const closeAfterMs = ws.tokenExpMs - Date.now();
      if (closeAfterMs <= 0) {
        ws.close(4001, "token expired");
        return;
      }

      tokenExpiryTimer = setTimeout(() => {
        ws.close(4001, "token expired");
      }, closeAfterMs);
      tokenExpiryTimer.unref();
    }
  } catch (err) {
    console.error("💥 CONNECTION ERROR:", err);
    ws.close();
    return;
  }

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log("WS EVENT:", data);

      await registry.refreshUserPresence(socketId);
      await handleClientEvent({
        registry,
        socketId,
        payload: data,
        ensureConversationSubscribed: subscribeConversationChannel
      });
    } catch (err) {
      console.error("💥 WS MESSAGE ERROR:", err);
      if (socketId) {
        registry.sendToSocket(socketId, {
          type: "error",
          code: "invalid_message",
          msg: err.message || "Invalid message"
        });
      }
    }
  });

  ws.on("error", (err) => {
    console.error("💥 WS SOCKET ERROR:", err);
  });

  ws.on("close", async (code, reason) => {
    try {
      console.log("WS CLOSED:", code, reason.toString());
      if (tokenExpiryTimer) {
        clearTimeout(tokenExpiryTimer);
      }
      if (socketId) {
        await registry.unregister(socketId);
      }
    } catch (err) {
      console.error("💥 WS CLOSE ERROR:", err);
    }
  });

  ws.on("pong", async () => {
    try {
      if (socketId) {
        registry.markPong(socketId);
        await registry.refreshUserPresence(socketId);
      }
    } catch (err) {
      console.error("💥 WS PONG ERROR:", err);
    }
  });
});

subscriber.on("message", (channel, message) => {
  const payload = JSON.parse(message);

  if (channel === "presence") {
    for (const roomId of registry.roomConnections.keys()) {
      registry.broadcastToRoom(roomId, payload);
    }
    return;
  }

  if (channel.startsWith("conversation:")) {
    const conversationId = channel.split(":")[1];
    const excludeUserId = payload.type === "user_typing" ? payload.uid : null;
    registry.broadcastToRoom(conversationId, payload, excludeUserId);
  }
});

async function start() {
  await pool.query("SELECT 1");
  await subscriber.subscribe("presence");

  const heartbeat = setInterval(async () => {
    const refreshes = [];
    for (const [socketId, connection] of registry.connections.entries()) {
      if (connection.socket.readyState === connection.socket.OPEN) {
        if (Date.now() - connection.lastPongAt > config.heartbeatIntervalMs * 2) {
          connection.socket.terminate();
          continue;
        }
        connection.socket.ping();
        refreshes.push(presenceService.refresh(connection.user.id));
      }
    }
    await Promise.allSettled(refreshes);
  }, config.heartbeatIntervalMs);

  heartbeat.unref();

  server.listen(config.port, () => {
    console.log(`chatbase listening on port ${config.port}`);
  });
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`received ${signal}, shutting down`);

  server.close();

  for (const [, connection] of registry.connections.entries()) {
    try {
      connection.socket.close(1001, "server shutting down");
    } catch (error) {
      connection.socket.terminate();
    }
  }

  await Promise.allSettled([
    command.quit(),
    publisher.quit(),
    subscriber.quit(),
    pool.end()
  ]);

  process.exit(0);
}

start().catch((error) => {
  console.error("failed to start server", error);
  process.exit(1);
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error("shutdown failed", error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error("shutdown failed", error);
    process.exit(1);
  });
});
