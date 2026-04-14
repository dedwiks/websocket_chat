function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  json(res, 400, { error: message || "Bad request" });
}

function unauthorized(res, message) {
  json(res, 401, { error: message || "Unauthorized" });
}

function serverError(res, error) {
  json(res, 500, {
    error: "Internal server error",
    details: error.message
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = {
  json,
  notFound,
  badRequest,
  unauthorized,
  serverError,
  readJson
};
