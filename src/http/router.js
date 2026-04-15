const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");
const config = require("../config");
const { verifyAccessToken } = require("../auth/tokens");
const conversationRepo = require("../repos/conversation-repo");
const userRepo = require("../repos/user-repo");
const authService = require("../services/auth-service");
const historyService = require("../services/history-service");
const { checkRateLimit } = require("../services/rate-limit-service");
const { compile, formatErrors } = require("../services/validator-service");
const httpSchemas = require("../models/http-schemas");
const { sanitizeUsername } = require("../utils/security");
const {
  json,
  notFound,
  badRequest,
  unauthorized,
  serverError,
  readJson
} = require("../utils/http");

const validators = compile(httpSchemas);

const staticFiles = {
  "/": { file: path.join(__dirname, "../../public/index.html"), contentType: "text/html; charset=utf-8" },
  "/register": { file: path.join(__dirname, "../../public/register.html"), contentType: "text/html; charset=utf-8" },
  "/register.html": { file: path.join(__dirname, "../../public/register.html"), contentType: "text/html; charset=utf-8" },
  "/app.js": { file: path.join(__dirname, "../../public/app.js"), contentType: "text/javascript; charset=utf-8" }
};

function sendFile(res, buffer, contentType) {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": config.clientOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(buffer);
}

async function maybeServeStatic(req, res, pathname) {
  if (req.method !== "GET") {
    return false;
  }
  const def = staticFiles[pathname];
  if (!def) {
    return false;
  }
  const content = await fs.readFile(def.file);
  sendFile(res, content, def.contentType);
  return true;
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

async function authenticateHttp(req) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }
  try {
    const payload = verifyAccessToken(token);
    return await userRepo.findById(payload.sub);
  } catch (error) {
    return null;
  }
}

function validateBody(schemaName, payload) {
  const validator = validators[schemaName];
  const valid = validator(payload);
  if (valid) {
    return null;
  }
  return formatErrors(validator);
}

async function enforceHttpLimit({ key, limit }) {
  const result = await checkRateLimit({
    key,
    limit
  });
  return result.allowed;
}

async function handleRegister(req, res) {
  const body = await readJson(req);
  const validationError = validateBody("register", body);
  if (validationError) {
    return badRequest(res, validationError);
  }
  const response = await authService.register({
    username: body.username,
    password: body.password
  });
  return json(res, 201, response);
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const validationError = validateBody("login", body);
  if (validationError) {
    return badRequest(res, validationError);
  }

  const allowed = await enforceHttpLimit({
    key: `rl:http:login:${(req.socket.remoteAddress || "unknown").replace(/:/g, "_")}`,
    limit: config.httpLoginLimitPerSecond
  });
  if (!allowed) {
    return json(res, 429, { error: "Too many login attempts" });
  }

  return json(res, 200, await authService.login(body));
}

async function handleRefresh(req, res) {
  const body = await readJson(req);
  const validationError = validateBody("refresh", body);
  if (validationError) {
    return badRequest(res, validationError);
  }
  return json(res, 200, await authService.refreshSession(body.refresh_token));
}

async function handleUserSearch(req, res, user, url) {
  const q = sanitizeUsername(url.searchParams.get("q") || "");
  if (!q || q.length < 2) {
    return badRequest(res, "q must contain at least 2 valid characters");
  }

  const allowed = await enforceHttpLimit({
    key: `rl:http:search:${user.id}`,
    limit: config.httpSearchLimitPerSecond
  });
  if (!allowed) {
    return json(res, 429, { error: "Too many search requests" });
  }

  const users = await userRepo.searchByUsernameLike(q, 20);
  const filtered = users.filter((entry) => entry.id !== user.id);
  return json(res, 200, { items: filtered });
}

async function handleCreateOrGetDirectConversation(req, res, user) {
  const body = await readJson(req);
  const validationError = validateBody("directConversation", body);
  if (validationError) {
    return badRequest(res, validationError);
  }

  if (body.userId === user.id) {
    return badRequest(res, "Cannot create direct conversation with self");
  }

  const peer = await userRepo.findById(body.userId);
  if (!peer) {
    return badRequest(res, "Target user does not exist");
  }

  const conversation = await conversationRepo.findOrCreateDirectConversation(user.id, body.userId);
  return json(res, 200, conversation);
}

async function handleConversationHistory(req, res, user, conversationId, url) {
  const limit = Number(url.searchParams.get("limit") || config.messageHistoryPageSize);
  const beforeTs = url.searchParams.get("before");

  const items = await historyService.getConversationHistory({
    conversationId,
    userId: user.id,
    beforeTs: beforeTs || null,
    limit
  });
  return json(res, 200, { items });
}

async function route(req, res) {
  const url = new URL(req.url, config.appBaseUrl);

  try {
    res.setHeader("Access-Control-Allow-Origin", config.clientOrigin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (await maybeServeStatic(req, res, url.pathname)) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, uptime: process.uptime() });
    }

    if (req.method === "POST" && (url.pathname === "/register" || url.pathname === "/v1/auth/register")) {
      return await handleRegister(req, res);
    }

    if (req.method === "POST" && (url.pathname === "/login" || url.pathname === "/v1/auth/login")) {
      return await handleLogin(req, res);
    }

    if (req.method === "POST" && url.pathname === "/refresh") {
      return await handleRefresh(req, res);
    }

    const user = await authenticateHttp(req);
    if (!user) {
      return unauthorized(res);
    }

    if (req.method === "GET" && url.pathname === "/users/search") {
      return await handleUserSearch(req, res, user, url);
    }

    if (req.method === "POST" && url.pathname === "/conversations/direct") {
      return await handleCreateOrGetDirectConversation(req, res, user);
    }

    const historyMatch = url.pathname.match(/^\/conversations\/([a-f0-9-]{36})\/messages$/i);
    if (req.method === "GET" && historyMatch) {
      return await handleConversationHistory(req, res, user, historyMatch[1], url);
    }

    return notFound(res);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return badRequest(res, "Invalid JSON body");
    }
    if (error.statusCode) {
      return json(res, error.statusCode, { error: error.message });
    }
    return serverError(res, error);
  }
}

module.exports = {
  route
};
