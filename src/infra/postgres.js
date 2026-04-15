const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgres://postgres.lsiafvzsafoaydjrfoeh:%40sJBHS356018111977@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require",
  ssl: {
    rejectUnauthorized: false,
  }
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query,
  withTransaction
};
