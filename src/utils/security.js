const crypto = require("node:crypto");

function sanitizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "");
}

function sanitizeMessageContent(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
}

function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateOpaqueToken() {
  return crypto.randomBytes(48).toString("base64url");
}

module.exports = {
  sanitizeUsername,
  sanitizeMessageContent,
  hashOpaqueToken,
  generateOpaqueToken
};
