export function safeImageUrl(value: string, apiBase = import.meta.env.VITE_API_BASE_URL || '/api/v1') {
  if (/^\/api\/v1\/bank-assets\/[A-Za-z0-9._-]+$/.test(value)) {
    if (value.endsWith('/.') || value.endsWith('/..')) return undefined;
    if (/^https?:\/\//i.test(apiBase)) return new URL(value, apiBase).href;
    return value;
  }
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export function questionPreview(value: string) {
  return value
    .replace(/!\[[^\]\n]*\]\([^\s]+\)/g, '【配图】')
    .replace(/[*`#]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);
}

export const questionTypeLabels = {
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  subjective: '主观 / 阅读题',
};
