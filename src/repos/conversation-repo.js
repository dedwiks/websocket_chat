const db = require("../infra/postgres");

function normalizePair(userA, userB) {
  return [userA, userB].sort((a, b) => a.localeCompare(b));
}

async function findDirectConversation(userA, userB) {
  const [user1, user2] = normalizePair(userA, userB);
  const result = await db.query(
    `SELECT id, user1_id AS "user1Id", user2_id AS "user2Id", created_at AS "createdAt"
     FROM conversations
     WHERE user1_id = $1 AND user2_id = $2`,
    [user1, user2]
  );
  return result.rows[0] || null;
}

async function findOrCreateDirectConversation(userA, userB) {
  const existing = await findDirectConversation(userA, userB);
  if (existing) {
    return existing;
  }

  const [user1, user2] = normalizePair(userA, userB);
  const result = await db.query(
    `INSERT INTO conversations (user1_id, user2_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING id, user1_id AS "user1Id", user2_id AS "user2Id", created_at AS "createdAt"`,
    [user1, user2]
  );

  if (result.rows[0]) {
    return result.rows[0];
  }

  return findDirectConversation(userA, userB);
}

async function ensureMember(conversationId, userId) {
  const result = await db.query(
    `SELECT 1
     FROM conversations
     WHERE id = $1 AND ($2 = user1_id OR $2 = user2_id)`,
    [conversationId, userId]
  );
  return result.rowCount > 0;
}

module.exports = {
  findDirectConversation,
  findOrCreateDirectConversation,
  ensureMember,
  normalizePair
};
