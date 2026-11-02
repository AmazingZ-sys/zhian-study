import type { AxiosInstance } from 'axios';
import type { paths } from './generated';
type Method = 'get' | 'post' | 'patch' | 'delete';
type Json<T> = T extends { content: { 'application/json': infer J } } ? J : unknown;
type Result<O> = O extends { responses: infer R } ? Json<R[Extract<keyof R, 200 | 201>]> : unknown;
type Body<O> = O extends { requestBody: infer B } ? Json<B> : never;
type Query<O> = O extends { parameters: { query?: infer Q } } ? Q : never;
/** Axios transport with paths, input and output types generated from OpenAPI. */
export function createTypedClient(api: AxiosInstance) {
  return async function request<P extends keyof paths, M extends Method>(
    path: P,
    method: M & (paths[P][M] extends undefined ? never : M),
    input: { path?: Record<string, string>; query?: Query<paths[P][M]>; body?: Body<paths[P][M]> } = {},
  ): Promise<Result<paths[P][M]>> {
    const url = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = input.path?.[name];
      if (!value) throw new Error(`Missing path parameter: ${name}`);
      return encodeURIComponent(value);
    });
    return (await api.request({ url, method, params: input.query, data: input.body })).data;
  };
}
