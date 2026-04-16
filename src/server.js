process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 UNHANDLED REJECTION:", err);
});

const http = require("node:http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const config = require("./config");
const { route } = require("./http/router");
const pool = require("./infra/postgres");

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
  const url = new URL(request.url, "http://localhost");
  const token = url.searchParams.get("token");

  let payload;
  try {
    payload = jwt.verify(token, process.env.AUTH_TOKEN_SECRET);
  } catch (err) {
    console.error("Invalid token:", err);
    ws.close();
    return;
  }

  ws.user = payload;
  console.log("WS CONNECTED USER:", payload.usr);

  ws.on("message", async (msg) => {
    console.log("RAW MESSAGE:", msg.toString());

    let data;
    try {
      data = JSON.parse(msg.toString());
      console.log("PARSED DATA:", data);
    } catch (err) {
      console.error("JSON PARSE ERROR:", err);
      return;
    }

    console.log("MESSAGE TYPE:", data.type);

    try {
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

      if (data.type === "message") {
        const cid = data.cid;
        const room = rooms.get(cid);

        if (!room) {
          console.error("Room not found:", cid);
          return;
        }

        console.log("ENTERED MESSAGE BLOCK");
        console.log("ABOUT TO INSERT:", {
          cid: data.cid,
          sender: ws.user?.sub,
          msg: data.msg
        });

        try {
          await pool.query(
            `INSERT INTO messages (client_id, conversation_id, sender_id, content)
             VALUES ($1, $2, $3, $4)`,
            [data.clid, data.cid, ws.user.sub, data.msg]
          );
          console.log("DB INSERT SUCCESS");
        } catch (err) {
          console.error("DB INSERT ERROR:", err);
        }

        for (const client of room) {
          if (client !== ws && client.readyState === 1) {
            client.send(JSON.stringify({
              type: "message",
              cid: cid,
              msg: data.msg
            }));
          }
        }

        ws.send(JSON.stringify({
          type: "ack",
          clid: data.clid
        }));

        console.log("MESSAGE BROADCASTED:", cid, data.msg);
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
