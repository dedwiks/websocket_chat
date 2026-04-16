process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 UNHANDLED REJECTION:", err);
});

const http = require("node:http");
const WebSocket = require("ws");
const config = require("./config");
const { route } = require("./http/router");

const app = route;
const PORT = config.port;
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });
const rooms = new Map();

server.on("upgrade", (request, socket, head) => {
  try {
    console.log("UPGRADE REQUEST:", request.url);

    if (!request.url || !request.url.startsWith("/ws")) {
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

wss.on("connection", (ws, request) => {
  console.log("WS CONNECTED");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      console.log("WS EVENT:", data);

      if (data.type === "join") {
        const cid = data.cid;

        if (!cid) {
          console.error("Missing cid in join");
          return;
        }

        if (!rooms.has(cid)) {
          rooms.set(cid, new Set());
        }

        rooms.get(cid).add(ws);
        ws.cid = cid;

        console.log("JOINED ROOM:", cid);
      }
    } catch (err) {
      console.error("💥 WS MESSAGE ERROR:", err);
    }
  });

  ws.on("close", (code) => {
    console.log("WS CLOSED:", code);
  });

  ws.on("error", (err) => {
    console.error("WS ERROR:", err);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
