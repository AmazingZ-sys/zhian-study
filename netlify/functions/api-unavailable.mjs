// Keep every API method explicit until VITE_API_BASE_URL points to the real API.
export default () =>
  Response.json(
    {
      error: {
        code: 'API_NOT_DEPLOYED',
        message: '服务正在准备中，登录、注册和数据功能暂未开放。请稍后再试。',
      },
    },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' } },
  );
