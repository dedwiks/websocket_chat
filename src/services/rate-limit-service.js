const { command } = require("../infra/redis");

async function checkRateLimit({ key, limit, windowSeconds = 1 }) {
  const current = await command.incr(key);
  if (current === 1) {
    await command.expire(key, windowSeconds);
  }
  return {
    allowed: current <= limit,
    current,
    limit
  };
}

module.exports = {
  checkRateLimit
};
