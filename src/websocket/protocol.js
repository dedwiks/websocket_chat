const config = require("../config");
const conversationRepo = require("../repos/conversation-repo");
const messageService = require("../services/message-service");
const typingService = require("../services/typing-service");
const { checkRateLimit } = require("../services/rate-limit-service");
const { compile, formatErrors } = require("../services/validator-service");
const wsSchemas = require("../models/ws-schemas");

const validators = compile(wsSchemas);

function sendError(registry, socketId, message, code = "bad_request") {
  registry.sendToSocket(socketId, { type: "error", code, msg: message });
}

function validatePayload(payload) {
  const validatorName = {
    join_conversation: "join_conversation",
    send_message: "send_message",
    typing: "typing",
    pong: "pong"
  }[payload?.type];

  if (!validatorName) {
    return { valid: false, reason: "Unknown event type" };
  }

  const validator = validators[validatorName];
  const valid = validator(payload);
  if (!valid) {
    return { valid: false, reason: formatErrors(validator) };
  }
  return { valid: true };
}

async function enforceWsRateLimits(userId, type) {
  const eventLimit = await checkRateLimit({
    key: `rl:ws:event:${userId}`,
    limit: config.wsEventLimitPerSecond
  });
  if (!eventLimit.allowed) {
    return { allowed: false, reason: "Too many events" };
  }

  if (type === "message") {
    const msgLimit = await checkRateLimit({
      key: `rl:ws:msg:${userId}`,
      limit: config.wsMessageLimitPerSecond
    });
    if (!msgLimit.allowed) {
      return { allowed: false, reason: "Too many messages" };
    }
  }

  return { allowed: true };
}

async function handleClientEvent({ registry, socketId, payload, ensureConversationSubscribed }) {
  const user = registry.getUser(socketId);
  if (!user) {
    return;
  }

  const validation = validatePayload(payload);
  if (!validation.valid) {
    sendError(registry, socketId, validation.reason, "invalid_payload");
    return;
  }

  const rateLimit = await enforceWsRateLimits(user.id, payload.type);
  if (!rateLimit.allowed) {
    sendError(registry, socketId, rateLimit.reason, "rate_limited");
    return;
  }

  switch (payload.type) {
    case "join_conversation": {
      const isMember = await conversationRepo.ensureMember(payload.cid, user.id);
      if (!isMember) {
        sendError(registry, socketId, "Conversation access denied", "forbidden");
        return;
      }
      registry.joinRoom(socketId, payload.cid);
      await ensureConversationSubscribed(payload.cid);
      break;
    }

    case "send_message": {
      await messageService.sendMessage({
        conversationId: payload.cid,
        senderId: user.id,
        clientId: payload.client_id,
        content: payload.msg
      });

      registry.sendToSocket(socketId, {
        type: "message_ack",
        client_id: payload.client_id
      });
      break;
    }

    case "typing":
      await typingService.startTyping({
        conversationId: payload.cid,
        userId: user.id
      });
      break;

    case "pong":
      registry.markPong(socketId);
      break;

    default:
      sendError(registry, socketId, "Unsupported event type");
  }
}

module.exports = {
  handleClientEvent
};
