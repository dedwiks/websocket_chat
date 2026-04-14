const db = require("../infra/postgres");

async function createRefreshToken({ userId, tokenHash, expiresAt }) {
  const result = await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"`,
    [userId, tokenHash, expiresAt]
  );
  return result.rows[0];
}

async function updateTokenHash(tokenId, tokenHash) {
  await db.query(
    `UPDATE refresh_tokens
     SET token_hash = $2
     WHERE id = $1`,
    [tokenId, tokenHash]
  );
}

async function findActiveById(tokenId) {
  const result = await db.query(
    `SELECT id, user_id AS "userId", token_hash AS "tokenHash", expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM refresh_tokens
     WHERE id = $1`,
    [tokenId]
  );
  return result.rows[0] || null;
}

async function revoke(tokenId) {
  await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE id = $1`,
    [tokenId]
  );
}

module.exports = {
  createRefreshToken,
  updateTokenHash,
  findActiveById,
  revoke
};
