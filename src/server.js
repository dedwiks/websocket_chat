console.log("==== ENV DEBUG START ====");
console.log("DATABASE_URL:", process.env.DATABASE_URL);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("All ENV keys:", Object.keys(process.env));
console.log("==== ENV DEBUG END ====");

const http = require("node:http");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");
const { TokenExpiredError } = require("jsonwebtoken");
const config = require("./config");
const { route } = require("./http/router");
const { pool } = require("./infra/postgres");
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

function rejectUpgrade(socket, statusLine, message = "") {
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n${message}`);
  socket.destroy();
}

server.on("upgrade", async (req, socket, head) => {
  if (isShuttingDown) {
    rejectUpgrade(socket, "503 Service Unavailable");
    return;
  }

  try {
    const url = new URL(req.url, config.appBaseUrl);
    if (url.pathname !== "/ws") {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }
    if (req.headers.origin && req.headers.origin !== config.clientOrigin) {
      rejectUpgrade(socket, "403 Forbidden", "origin denied");
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.upgradeReq = req;
      wss.emit("connection", ws, req);
    });
  } catch (error) {
    rejectUpgrade(socket, "500 Internal Server Error");
  }
});

wss.on("connection", async (ws, req) => {
  let authTimer = setTimeout(() => {
    ws.close(4001, "auth timeout");
  }, 5000);

  let socketId = null;
  let tokenExpiryTimer = null;
  const queryToken = req ? new URL(req.url, config.appBaseUrl).searchParams.get("token") : null;

  async function authenticateWebSocket(jwt) {
    try {
      const jwtPayload = verifyAccessToken(jwt);
      const user = await userRepo.findById(jwtPayload.sub);
      if (!user) {
        ws.send(JSON.stringify({ type: "auth_error", msg: "unknown user" }));
        ws.close(4001, "unknown user");
        return false;
      }

      ws.user = user;
      ws.tokenExpMs = jwtPayload.exp ? jwtPayload.exp * 1000 : null;
      clearTimeout(authTimer);
      socketId = await registry.register(ws, ws.user);
      ws.socketId = socketId;
      ws.send(JSON.stringify({ type: "auth_success" }));

      if (ws.tokenExpMs) {
        const closeAfterMs = ws.tokenExpMs - Date.now();
        if (closeAfterMs <= 0) {
          ws.close(4001, "token expired");
        } else {
          tokenExpiryTimer = setTimeout(() => {
            ws.close(4001, "token expired");
          }, closeAfterMs);
          tokenExpiryTimer.unref();
        }
      }
      return true;
    } catch (err) {
      ws.send(JSON.stringify({ type: "auth_error", msg: "invalid token" }));
      ws.close(4001, "invalid token");
      return false;
    }
  }

  ws.on("message", async (raw) => {
    try {
      const payload = JSON.parse(raw.toString("utf8"));

      if (!socketId) {
        const authToken = payload?.type === "auth" ? payload.jwt : queryToken;
        if (!authToken) {
          ws.close(4001, "unauthenticated");
          return;
        }

        const authenticated = await authenticateWebSocket(authToken);
        if (!authenticated) {
          return;
        }

        if (payload.type === "auth") {
          return;
        }
      }

      await registry.refreshUserPresence(socketId);
      await handleClientEvent({
        registry,
        socketId,
        payload,
        ensureConversationSubscribed: subscribeConversationChannel
      });
    } catch (error) {
      if (socketId) {
        registry.sendToSocket(socketId, {
          type: "error",
          code: "invalid_message",
          msg: error.message || "Invalid message"
        });
      }
    }
  });

  ws.on("close", async () => {
    if (authTimer) clearTimeout(authTimer);
    if (tokenExpiryTimer) clearTimeout(tokenExpiryTimer);
    if (socketId) {
      await registry.unregister(socketId);
    }
  });

  ws.on("pong", async () => {
    if (socketId) {
      registry.markPong(socketId);
      await registry.refreshUserPresence(socketId);
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
        // If no pong arrives within two heartbeat windows, we assume a dead connection.
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
    console.log(`chat service listening on port ${config.port}`);
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
