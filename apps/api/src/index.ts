import { serve } from '@hono/node-server';
import { app } from './app.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { settleExpired } from './exams.js';
const server = serve({ fetch: app.fetch, port: config.PORT }, () =>
  console.log(`知岸 API listening on ${config.PORT}`),
);
let settling = false;
const timer = setInterval(async () => {
  if (settling) return;
  settling = true;
  try {
    await settleExpired();
  } catch {
    console.error('考试截止结算失败，将在下次扫描重试');
  } finally {
    settling = false;
  }
}, 15000);
timer.unref();
function shutdown() {
  clearInterval(timer);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
