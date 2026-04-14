const db = require("../infra/postgres");

async function createUser({ username, passwordHash }) {
  const result = await db.query(
    `INSERT INTO users (username, password_hash)
     VALUES ($1, $2)
     RETURNING id, username, password_hash AS "passwordHash", created_at AS "createdAt"`,
    [username, passwordHash]
  );
  return result.rows[0];
}

async function findByUsername(username) {
  const result = await db.query(
    `SELECT id, username, password_hash AS "passwordHash", created_at AS "createdAt"
     FROM users
     WHERE username = $1`,
    [username]
  );
  return result.rows[0] || null;
}

async function findById(userId) {
  const result = await db.query(
    `SELECT id, username, created_at AS "createdAt"
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function searchByUsernameLike(query, limit = 20) {
  const result = await db.query(
    `SELECT id, username, created_at AS "createdAt"
     FROM users
     WHERE username ILIKE $1
     ORDER BY username ASC
     LIMIT $2`,
    [`%${query}%`, limit]
  );
  return result.rows;
}

module.exports = {
  createUser,
  findByUsername,
  findById,
  searchByUsernameLike
};
