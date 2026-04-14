const config = require("../config");
const conversationRepo = require("../repos/conversation-repo");
const messageRepo = require("../repos/message-repo");

async function getConversationHistory({ conversationId, userId, beforeTs, limit }) {
  const isMember = await conversationRepo.ensureMember(conversationId, userId);
  if (!isMember) {
    const error = new Error("User is not a member of this conversation");
    error.statusCode = 403;
    throw error;
  }

  return messageRepo.listMessages({
    conversationId,
    beforeTs,
    limit: Math.min(limit || config.messageHistoryPageSize, 100)
  });
}

module.exports = {
  getConversationHistory
};
