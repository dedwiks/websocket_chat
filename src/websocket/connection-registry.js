const { randomUUID } = require("node:crypto");
const presenceService = require("../services/presence-service");

class ConnectionRegistry {
  constructor() {
    this.connections = new Map();
    this.userConnections = new Map();
    this.roomConnections = new Map();
  }

  async register(socket, user) {
    const socketId = randomUUID();
    this.connections.set(socketId, {
      socket,
      user,
      rooms: new Set(),
      lastPongAt: Date.now()
    });

    const socketsForUser = this.userConnections.get(user.id) || new Set();
    const wasOffline = socketsForUser.size === 0;
    socketsForUser.add(socketId);
    this.userConnections.set(user.id, socketsForUser);

    if (wasOffline) {
      await presenceService.setOnline(user.id);
    } else {
      await presenceService.refresh(user.id);
    }

    return socketId;
  }

  async unregister(socketId) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    for (const roomId of connection.rooms) {
      this.leaveRoom(socketId, roomId);
    }

    this.connections.delete(socketId);
    const socketsForUser = this.userConnections.get(connection.user.id);
    if (!socketsForUser) {
      return;
    }

    socketsForUser.delete(socketId);
    if (socketsForUser.size === 0) {
      this.userConnections.delete(connection.user.id);
      await presenceService.setOffline(connection.user.id);
      return;
    }

    this.userConnections.set(connection.user.id, socketsForUser);
    await presenceService.refresh(connection.user.id);
  }

  markPong(socketId) {
    const connection = this.connections.get(socketId);
    if (connection) {
      connection.lastPongAt = Date.now();
    }
  }

  joinRoom(socketId, roomId) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    connection.rooms.add(roomId);
    const roomSockets = this.roomConnections.get(roomId) || new Set();
    roomSockets.add(socketId);
    this.roomConnections.set(roomId, roomSockets);
  }

  leaveRoom(socketId, roomId) {
    const connection = this.connections.get(socketId);
    if (connection) {
      connection.rooms.delete(roomId);
    }
    const roomSockets = this.roomConnections.get(roomId);
    if (!roomSockets) {
      return;
    }

    roomSockets.delete(socketId);
    if (roomSockets.size === 0) {
      this.roomConnections.delete(roomId);
    }
  }

  getUser(socketId) {
    return this.connections.get(socketId)?.user || null;
  }

  sendToSocket(socketId, payload) {
    const connection = this.connections.get(socketId);
    if (!connection || connection.socket.readyState !== connection.socket.OPEN) {
      return;
    }
    connection.socket.send(JSON.stringify(payload));
  }

  broadcastToRoom(roomId, payload, excludeUserId = null) {
    const roomSockets = this.roomConnections.get(roomId);
    if (!roomSockets) {
      return;
    }

    for (const socketId of roomSockets) {
      const connection = this.connections.get(socketId);
      if (!connection) {
        continue;
      }
      if (excludeUserId && connection.user.id === excludeUserId) {
        continue;
      }
      this.sendToSocket(socketId, payload);
    }
  }

  async refreshUserPresence(socketId) {
    const user = this.getUser(socketId);
    if (user) {
      await presenceService.refresh(user.id);
    }
  }
}

module.exports = ConnectionRegistry;
