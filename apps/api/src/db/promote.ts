import { eq } from 'drizzle-orm';
import { db, pool } from './index.js';
import { users, auditLogs } from './schema.js';
import { emailSchema } from '@zhian/contracts';
const email = emailSchema.parse(process.argv[2]);
try {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(eq(users.email, email))
      .returning();
    if (!user) throw new Error('请先注册该用户');
    await tx
      .insert(auditLogs)
      .values({ userId: user.id, action: 'admin.promote.cli', objectId: user.id, result: 'success' });
  });
  console.log('已提升指定用户为管理员');
} finally {
  await pool.end();
}
