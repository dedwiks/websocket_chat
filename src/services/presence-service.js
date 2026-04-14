const config = require("../config");
const { command, publisher } = require("../infra/redis");

function key(userId) {
  return `presence:user:${userId}`;
}

async function setOnline(userId) {
  const lastSeenAt = new Date().toISOString();
  await command
    .multi()
    .hset(key(userId), { status: "online", lastSeenAt, nodeId: config.nodeId })
    .expire(key(userId), config.presenceTtlSeconds)
    .exec();

  await publisher.publish(
    "presence",
    JSON.stringify({ type: "presence_update", uid: userId, status: "online", ts: lastSeenAt })
  );
}

async function refresh(userId) {
  const lastSeenAt = new Date().toISOString();
  await command
    .multi()
    .hset(key(userId), "lastSeenAt", lastSeenAt)
    .expire(key(userId), config.presenceTtlSeconds)
    .exec();
}

async function setOffline(userId) {
  const lastSeenAt = new Date().toISOString();
  await command.del(key(userId));
  await publisher.publish(
    "presence",
    JSON.stringify({ type: "presence_update", uid: userId, status: "offline", ts: lastSeenAt })
  );
}

module.exports = {
  setOnline,
  refresh,
  setOffline
};
