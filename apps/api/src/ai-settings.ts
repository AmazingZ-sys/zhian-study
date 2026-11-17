import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { aiSettingsInputSchema, type AiSettings } from '@zhian/contracts';
import { audit } from './admin.js';
import { postGateway } from './ai-transport.js';
import { requireAdmin } from './auth.js';
import { config } from './config.js';
import { db, type Tx } from './db/index.js';
import { aiSettings } from './db/schema.js';
import { body, fail, uid, type Env } from './lib.js';

type Secret = { kind: 'encrypted' | 'plain'; value: string };
type ProviderSettings = Omit<AiSettings, 'hasApiKey'> & { secret: Secret | null };
const settingsId = 1;
const completionPath = '/chat/completions';
const encryptionKey = createHmac('sha256', config.JWT_SECRET).update('zhian:ai-gateway-api-key:v1').digest();

function gatewayURL(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === 'https:') return url;
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return url.protocol === 'http:' && loopback && config.NODE_ENV !== 'production' ? url : null;
  } catch {
    return null;
  }
}

function completionURL(baseUrl: string) {
  const url = gatewayURL(baseUrl);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith(completionPath) ? path : path + completionPath;
  return url.href;
}

function seal(apiKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function readSecret(secret: Secret | null) {
  if (!secret) return undefined;
  if (secret.kind === 'plain') return secret.value;
  try {
    const bytes = Buffer.from(secret.value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw new HTTPException(503, { message: 'AI 密钥无法读取，请在后台重新保存 API Key' });
  }
}

function environmentSettings(): ProviderSettings {
  const parsed = aiSettingsInputSchema.safeParse({
    enabled: true,
    baseUrl: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    apiKey: process.env.AI_API_KEY?.trim() || undefined,
    tokenLimitField: process.env.AI_TOKEN_LIMIT_FIELD?.trim() || undefined,
  });
  if (parsed.success && gatewayURL(parsed.data.baseUrl)) {
    const { apiKey, ...settings } = parsed.data;
    return { ...settings, source: 'environment', secret: apiKey ? { kind: 'plain', value: apiKey } : null };
  }
  return {
    enabled: false,
    baseUrl: '',
    model: '',
    tokenLimitField: 'max_completion_tokens',
    source: 'none',
    secret: null,
  };
}

async function loadSettings(database: typeof db | Tx = db): Promise<ProviderSettings> {
  const [saved] = await database.select().from(aiSettings).where(eq(aiSettings.id, settingsId));
  if (!saved) return environmentSettings();
  const { enabled, baseUrl, model, tokenLimitField, encryptedApiKey } = saved;
  return {
    enabled,
    baseUrl,
    model,
    tokenLimitField,
    source: 'database',
    secret: encryptedApiKey ? { kind: 'encrypted', value: encryptedApiKey } : null,
  };
}

function publicSettings({ secret, ...settings }: ProviderSettings): AiSettings {
  return { ...settings, hasApiKey: !!secret };
}

export async function isAiEnabled() {
  const settings = await loadSettings();
  return settings.enabled && !!gatewayURL(settings.baseUrl);
}

const replySchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().trim().min(1).max(25000) }) })).min(1),
});
const pending = new Set<string>();
const usage = new Map<string, { count: number; resetsAt: number }>();

function takeSlot(userId: string) {
  const now = Date.now();
  for (const [id, window] of usage) if (window.resetsAt <= now) usage.delete(id);
  const window = usage.get(userId) ?? { count: 0, resetsAt: now + 5 * 60_000 };
  if (window.count >= 12) fail(429, 'AI 请求过于频繁，请稍后重试');
  if (pending.has(userId)) fail(429, '上一项 AI 请求仍在处理');
  if (pending.size >= 4) fail(429, 'AI 服务繁忙，请稍后重试');
  window.count++;
  usage.set(userId, window);
  pending.add(userId);
}

async function complete(
  settings: ProviderSettings,
  userId: string,
  instructions: string,
  input: string,
  maxTokens: number,
) {
  const url = completionURL(settings.baseUrl);
  if (!url) throw new HTTPException(503, { message: 'AI 网关未配置或地址无效' });
  if (input.length > 32_000) throw new HTTPException(413, { message: '输入内容过长，无法使用 AI 生成' });
  const apiKey = readSecret(settings.secret);
  takeSlot(userId);
  const signal = AbortSignal.timeout(25_000);
  try {
    const response = await postGateway(
      url,
      {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      JSON.stringify({
        model: settings.model,
        [settings.tokenLimitField]: maxTokens,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input },
        ],
      }),
      signal,
    );
    return replySchema.parse(response).choices[0]!.message.content;
  } catch {
    if (signal.aborted) throw new HTTPException(504, { message: 'AI 网关响应超时，请重试' });
    throw new HTTPException(502, { message: 'AI 网关请求失败，请检查中转站地址、模型和密钥' });
  } finally {
    pending.delete(userId);
  }
}

export async function generateAiText(userId: string, instructions: string, input: string) {
  const settings = await loadSettings();
  if (!settings.enabled) throw new HTTPException(503, { message: 'AI 功能暂未启用' });
  return complete(settings, userId, instructions, input, 2500);
}

export const aiSettingsRoutes = new Hono<Env>();
aiSettingsRoutes.use('*', requireAdmin);
aiSettingsRoutes.get('/', async (c) => c.json({ data: publicSettings(await loadSettings()) }));
aiSettingsRoutes.patch('/', async (c) => {
  const { apiKey, ...input } = await body(c, aiSettingsInputSchema);
  const base = gatewayURL(input.baseUrl);
  if (!base) return fail(400, '请输入有效的网关地址。生产环境使用 HTTPS，地址内不能包含密钥或查询参数。');
  const baseUrl = base.href.replace(/\/+$/, '');
  const settings = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('zhian-ai-settings'))`);
    const previous = await loadSettings(tx);
    const sameGateway = completionURL(baseUrl) === completionURL(previous.baseUrl);
    const secret = apiKey === undefined && sameGateway ? previous.secret : null;
    const encryptedApiKey = apiKey
      ? seal(apiKey)
      : secret?.kind === 'plain'
        ? seal(secret.value)
        : (secret?.value ?? null);
    const values = { ...input, baseUrl, encryptedApiKey, updatedAt: new Date() };
    await tx
      .insert(aiSettings)
      .values({ id: settingsId, ...values })
      .onConflictDoUpdate({ target: aiSettings.id, set: values });
    await audit(tx, uid(c), 'ai.settings.update', String(settingsId));
    return { ...input, baseUrl, source: 'database' as const, hasApiKey: !!encryptedApiKey };
  });
  return c.json({ data: settings });
});
aiSettingsRoutes.post('/test', async (c) => {
  await complete(await loadSettings(), uid(c), '这是 API 连通性测试，请简短回应。', '请回复 OK。', 256);
  return c.json({ data: { ok: true } });
});
