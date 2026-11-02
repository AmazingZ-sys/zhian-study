import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './index.js';
const client = await pool.connect();
try {
  await client.query('SELECT pg_advisory_lock(719032)');
  await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  console.log('数据库迁移成功');
} finally {
  await client.query('SELECT pg_advisory_unlock(719032)');
  client.release();
  await pool.end();
}
