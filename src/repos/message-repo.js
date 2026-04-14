const db = require("../infra/postgres");

async function createMessage({ conversationId, senderId, clientId, content }) {
  const result = await db.query(
    `INSERT INTO messages (conversation_id, sender_id, client_id, content)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (sender_id, client_id)
     DO UPDATE SET content = messages.content
     RETURNING
       id,
       client_id AS "clientId",
       conversation_id AS "conversationId",
       sender_id AS "senderId",
       content,
       timestamp`,
    [conversationId, senderId, clientId, content]
  );
  return result.rows[0];
}

async function listMessages({ conversationId, beforeTs, limit }) {
  const params = [conversationId, limit];
  let whereClause = "conversation_id = $1";

  if (beforeTs) {
    params.push(beforeTs);
    whereClause += ` AND timestamp < $${params.length}`;
  }

  const result = await db.query(
    `SELECT
       id,
       client_id AS "clientId",
       conversation_id AS "conversationId",
       sender_id AS "senderId",
       content,
       timestamp
     FROM messages
     WHERE ${whereClause}
     ORDER BY timestamp DESC
     LIMIT $2`,
    params
  );

  return result.rows.reverse();
}

module.exports = {
  createMessage,
  listMessages
};
