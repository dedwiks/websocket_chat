const crypto = require("node:crypto");
const config = require("../config");
const { hashPassword, verifyPassword } = require("../auth/passwords");
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} = require("../auth/tokens");
const refreshTokenRepo = require("../repos/refresh-token-repo");
const userRepo = require("../repos/user-repo");
const { hashOpaqueToken, sanitizeUsername } = require("../utils/security");

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt
  };
}

async function issueTokenPair(user) {
  const refreshDbRow = await refreshTokenRepo.createRefreshToken({
    userId: user.id,
    tokenHash: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + config.refreshTokenTtlSeconds * 1000)
  });
  const refreshToken = signRefreshToken(user, refreshDbRow.id);
  await refreshTokenRepo.updateTokenHash(refreshDbRow.id, hashOpaqueToken(refreshToken));

  return {
    access_token: signAccessToken(user),
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: config.accessTokenTtlSeconds
  };
}

async function register({ username, password }) {
  const cleanedUsername = sanitizeUsername(username);
  if (cleanedUsername.length < 3) {
    const error = new Error("Username is invalid after sanitization");
    error.statusCode = 400;
    throw error;
  }
  const existingUser = await userRepo.findByUsername(cleanedUsername);
  if (existingUser) {
    const error = new Error("Username already exists");
    error.statusCode = 409;
    throw error;
  }

  const user = await userRepo.createUser({
    username: cleanedUsername,
    passwordHash: await hashPassword(password)
  });

  return {
    user: publicUser(user),
    ...(await issueTokenPair(user))
  };
}

async function login({ username, password }) {
  const cleanedUsername = sanitizeUsername(username);
  if (cleanedUsername.length < 3) {
    const error = new Error("Invalid username or password");
    error.statusCode = 401;
    throw error;
  }
  const user = await userRepo.findByUsername(cleanedUsername);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    const error = new Error("Invalid username or password");
    error.statusCode = 401;
    throw error;
  }

  return {
    user: publicUser(user),
    ...(await issueTokenPair(user))
  };
}

async function refreshSession(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    const authError = new Error("Invalid refresh token");
    authError.statusCode = 401;
    throw authError;
  }

  const tokenRecord = await refreshTokenRepo.findActiveById(payload.jti);
  if (!tokenRecord || tokenRecord.revokedAt) {
    const authError = new Error("Refresh token revoked");
    authError.statusCode = 401;
    throw authError;
  }
  if (new Date(tokenRecord.expiresAt).getTime() < Date.now()) {
    const authError = new Error("Refresh token expired");
    authError.statusCode = 401;
    throw authError;
  }
  if (tokenRecord.tokenHash !== hashOpaqueToken(refreshToken)) {
    const authError = new Error("Refresh token mismatch");
    authError.statusCode = 401;
    throw authError;
  }

  await refreshTokenRepo.revoke(tokenRecord.id);
  const user = await userRepo.findById(payload.sub);
  if (!user) {
    const authError = new Error("User not found");
    authError.statusCode = 401;
    throw authError;
  }

  return {
    user: publicUser(user),
    ...(await issueTokenPair(user))
  };
}

module.exports = {
  register,
  login,
  refreshSession
};
