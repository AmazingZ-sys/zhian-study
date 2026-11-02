import { createClient, createTypedClient } from '@zhian/api-client';
export const api = createClient(import.meta.env.VITE_API_BASE_URL || '/api/v1');
export const typedApi = createTypedClient(api);
export const errorText = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请重试');
