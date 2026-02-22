const { Pool } = require("pg");
require("dotenv").config({ path: ".env.local" });

async function checkTsk() {
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const res = await pool.query("SELECT count(*) FROM cross_references");
    console.log(`TSK Row Count: ${res.rows[0].count}`);
  } catch (err) {
    console.error("Error checking TSK:", err.message);
  } finally {
    await pool.end();
  }
}

checkTsk();
