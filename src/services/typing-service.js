const config = require("../config");
const { command, publisher } = require("../infra/redis");

function key(conversationId, userId) {
  return `typing:${conversationId}:${userId}`;
}

async function startTyping({ conversationId, userId }) {
  await command.set(key(conversationId, userId), "1", "EX", config.typingTtlSeconds);
  await publisher.publish(
    `conversation:${conversationId}`,
    JSON.stringify({ type: "user_typing", cid: conversationId, uid: userId })
  );
}

async function stopTyping({ conversationId, userId }) {
  await command.del(key(conversationId, userId));
  await publisher.publish(
    `conversation:${conversationId}`,
    JSON.stringify({ type: "typing.stop", cid: conversationId, uid: userId })
  );
}

module.exports = {
  startTyping,
  stopTyping
};
