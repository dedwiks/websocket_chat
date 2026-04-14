const conversationRepo = require("../repos/conversation-repo");
const messageRepo = require("../repos/message-repo");
const config = require("../config");
const { publisher } = require("../infra/redis");
const { sanitizeMessageContent } = require("../utils/security");

async function sendMessage({ conversationId, senderId, clientId, content }) {
  const isMember = await conversationRepo.ensureMember(conversationId, senderId);
  if (!isMember) {
    const error = new Error("User is not a member of this conversation");
    error.statusCode = 403;
    throw error;
  }

  const sanitizedContent = sanitizeMessageContent(content);
  if (!sanitizedContent || sanitizedContent.length > config.maxMessageLength) {
    const error = new Error("Message content is invalid");
    error.statusCode = 400;
    throw error;
  }

  const message = await messageRepo.createMessage({
    conversationId,
    senderId,
    clientId,
    content: sanitizedContent
  });

  await publisher.publish(
    `conversation:${conversationId}`,
    JSON.stringify({
      type: "message",
      cid: message.conversationId,
      uid: message.senderId,
      msg: message.content,
      ts: message.timestamp,
      client_id: message.clientId
    })
  );

  return message;
}

module.exports = {
  sendMessage
};
