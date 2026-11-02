import axios, { type AxiosInstance } from 'axios';
import type { Envelope } from '@zhian/contracts';
export { createTypedClient } from './typed';
export type { paths, components, operations } from './generated';
export function createClient(baseURL = '/api/v1'): AxiosInstance {
  const api = axios.create({
    baseURL,
    withCredentials: true,
    timeout: 20000,
    headers: { 'X-Requested-With': 'zhian' },
  });
  let refresh: Promise<unknown> | null = null;
  api.interceptors.response.use(
    (r) => r,
    async (error) => {
      const config = error.config;
      if (error.response?.status === 401 && config && !config._retry && !config.url?.startsWith('/auth/')) {
        config._retry = true;
        try {
          refresh ??= api.post('/auth/refresh').finally(() => {
            refresh = null;
          });
          await refresh;
          return api(config);
        } catch {
          /* caller handles expired session */
        }
      }
      const message =
        error.response?.data?.error?.message ??
        (error.code === 'ECONNABORTED' ? '请求超时，请重试' : '无法连接服务，请检查网络或启动 API');
      return Promise.reject(
        Object.assign(new Error(message), {
          status: error.response?.status,
          details: error.response?.data?.error?.details,
          payload: error.response?.data,
        }),
      );
    },
  );
  return api;
}
export async function getData<T>(
  api: AxiosInstance,
  path: string,
  params?: Record<string, unknown>,
): Promise<Envelope<T>> {
  return (await api.get<Envelope<T>>(path, { params })).data;
}
