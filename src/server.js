process.on("uncaughtException", (err) => {
  console.error("💥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 UNHANDLED REJECTION:", err);
});

const http = require("node:http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const config = require("./config");
const { route } = require("./http/router");
const pool = require("./infra/postgres");

const app = route;
const PORT = config.port;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error("Authentication error"));
  }

  try {
    const payload = jwt.verify(token, process.env.AUTH_TOKEN_SECRET);
    socket.user = payload;
    next();
  } catch (err) {
    next(new Error("Authentication error"));
  }
});

io.on("connection", (socket) => {
  console.log("SOCKET CONNECTED USER:", socket.user.usr);

  socket.on("join", (data) => {
    const cid = data.cid;
    if (!cid) {
      console.error("Missing cid in join");
      return;
    }

    socket.join(cid);
    console.log("JOINED ROOM:", cid);
  });

  socket.on("message", async (data) => {
    const cid = data.cid;
    const room = io.sockets.adapter.rooms.get(cid);

    if (!room) {
      console.error("Room not found:", cid);
      return;
    }

    console.log("ENTERED MESSAGE BLOCK");
    console.log("ABOUT TO INSERT:", {
      cid: data.cid,
      sender: socket.user?.sub,
      msg: data.msg
    });

    try {
      await pool.query(
        `INSERT INTO messages (client_id, conversation_id, sender_id, content)
         VALUES ($1, $2, $3, $4)`,
        [data.clid, data.cid, socket.user.sub, data.msg]
      );
      console.log("DB INSERT SUCCESS");
    } catch (err) {
      console.error("DB INSERT ERROR:", err);
    }

    // Broadcast to all clients in the room except sender
    socket.to(cid).emit("message", {
      cid: cid,
      msg: data.msg
    });

    // Send ack to sender
    socket.emit("ack", {
      client_id: data.clid
    });

    console.log("MESSAGE BROADCASTED:", cid, data.msg);
  });

  socket.on("disconnect", () => {
    console.log("SOCKET DISCONNECTED");
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
