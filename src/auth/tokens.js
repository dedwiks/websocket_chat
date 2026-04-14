const jwt = require("jsonwebtoken");
const config = require("../config");

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, usr: user.username, typ: "access" },
    config.authTokenSecret,
    { expiresIn: config.accessTokenTtlSeconds }
  );
}

function signRefreshToken(user, tokenId) {
  return jwt.sign(
    { sub: user.id, jti: tokenId, typ: "refresh" },
    config.refreshTokenSecret,
    { expiresIn: config.refreshTokenTtlSeconds }
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.authTokenSecret);
  if (payload.typ !== "access") {
    throw new Error("Invalid token type");
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, config.refreshTokenSecret);
  if (payload.typ !== "refresh") {
    throw new Error("Invalid token type");
  }
  return payload;
}

function decodeTokenUnsafe(token) {
  return jwt.decode(token);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeTokenUnsafe
};
