// Keep every API method explicit until VITE_API_BASE_URL points to the real API.
export default function handler(_request, response) {
  response.statusCode = 503;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Retry-After', '3600');
  response.end(
    JSON.stringify({
      error: {
        code: 'API_NOT_DEPLOYED',
        message: '服务正在准备中，登录、注册和数据功能暂未开放。请稍后再试。',
      },
    }),
  );
}
