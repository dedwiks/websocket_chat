const os = require("node:os");

function readNumber(name, fallback) {
  const raw = process.env[name];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  env: process.env.NODE_ENV || "development",
  port: readNumber("PORT", 8080),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:8080",
  clientOrigin: process.env.CLIENT_ORIGIN || process.env.APP_BASE_URL || "http://localhost:8080",
  databaseUrl: process.env.DATABASE_URL || "postgres://chat:chat@localhost:5432/chat_app",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  authTokenSecret: process.env.AUTH_TOKEN_SECRET || "change-me",
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || "change-me-too",
  accessTokenTtlSeconds: readNumber("ACCESS_TOKEN_TTL_SECONDS", 900),
  refreshTokenTtlSeconds: readNumber("REFRESH_TOKEN_TTL_SECONDS", 60 * 60 * 24 * 30),
  presenceTtlSeconds: readNumber("PRESENCE_TTL_SECONDS", 45),
  typingTtlSeconds: readNumber("TYPING_TTL_SECONDS", 5),
  heartbeatIntervalMs: readNumber("HEARTBEAT_INTERVAL_MS", 30000),
  messageHistoryPageSize: readNumber("MESSAGE_HISTORY_PAGE_SIZE", 50),
  maxMessageLength: readNumber("MAX_MESSAGE_LENGTH", 2000),
  httpLoginLimitPerSecond: readNumber("HTTP_LOGIN_LIMIT_PER_SECOND", 5),
  httpSearchLimitPerSecond: readNumber("HTTP_SEARCH_LIMIT_PER_SECOND", 5),
  wsMessageLimitPerSecond: readNumber("WS_MESSAGE_LIMIT_PER_SECOND", 10),
  wsEventLimitPerSecond: readNumber("WS_EVENT_LIMIT_PER_SECOND", 30),
  nodeId: process.env.NODE_ID || `${os.hostname()}-${process.pid}`
};
