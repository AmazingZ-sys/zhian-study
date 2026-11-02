# 部署总览

2026-11-02：全部本地检查已复验通过（类型、Lint、单元 9 项、集成 13 项、E2E 2 条、构建、容器冒烟、部署模拟 10 场景）。CI/Release 已增加容器验证门禁；代码 `879069f` 的[云端 CI](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145) 全部通过，[Release 工作流](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 的全部 jobs（含容器门禁、版本、前端和双架构镜像发布）均成功，[v1.0.0](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 正式发布且 Netlify Actions 部署成功。用户暂无服务器，本次仅部署前端并发布 API 镜像。

首次云端 E2E 的笔记保存竞态已修复并重新通过；详细验证证据见 [测试结果](TESTING.md)。

## 本地

pnpm install；复制 .env.example 为 .env；docker compose up -d db；pnpm db:migrate；pnpm db:seed；pnpm dev。种子不创建公开固定密码管理员，使用 ADMIN_EMAIL/ADMIN_PASSWORD 显式设置或管理脚本提升既有用户。

## Netlify

站点 https://zhian-study.netlify.app 已通过本地 CLI 首次生产上传成功，并通过 Netlify API 设为公开；匿名访问 `/login` 返回 200，安全头已核验；v1.0.0 已由 Actions 再次部署成功。发布目录 apps/web/dist，构建 pnpm --filter @zhian/web build；VITE_API_BASE_URL 必须构建时注入；SPA fallback，安全头与 assets immutable 缓存。生产发布由 GitHub Actions 执行，Netlify 当前未关联 Git 自动构建。

Netlify API 确认正式部署 `6ae8046280c64206131c6cbd` 为 `production` / `ready`、title `v1.0.0`；[永久部署地址](https://6ae8046280c64206131c6cbd--zhian-study.netlify.app)。匿名 `/login` 为 200 且 CSP 正确，GET `/api/v1/users/me` 和 POST `/api/v1/auth/login` 均为 503 `application/json`。

当前构建使用 `VITE_API_BASE_URL=/api/v1`。`/api/*` 优先 rewrite 到 `netlify/functions/api-unavailable.mjs`，为所有 HTTP 方法返回说明 API 尚未部署的 503 JSON；注册、登录和业务数据功能待 API 接入。取得真实 API 后，将构建变量换为 `https://实际API域名/api/v1` 并重新构建，配置该 API 的 CORS/Cookie。真实 HTTPS API 基址请求不再调用 Netlify fallback。

## API

Docker 多阶段、非 root、端口 3000，包含迁移命令，已发布镜像 `ghcr.io/amazingz-sys/zhian-study-api:v1.0.0`（linux/amd64、linux/arm64）；本地构建、真实数据库容器冒烟及云端容器门禁已通过；manifest 摘要和访问边界见 [CI/CD](CICD.md)。生产不可使用 latest。服务器部署配置保留，待有服务器、独立数据库和域名后使用。

## 生产环境

DATABASE_URL、JWT_SECRET（至少 32 字节随机）、CORS_ORIGINS、COOKIE_SECURE=true、COOKIE_SAME_SITE=none/lax（取决同站）、NODE_ENV=production；前后端推荐同站子域以避免第三方 Cookie 拦截。

TRUSTED_PROXY_IPS 只填写 API 实际 socket 对端的 Nginx/Docker bridge IP，模板地址需按实际网络调整。脚本将 tag 解析为 digest，成功快照保存该 digest 及当时配置，指定版本回滚需要存在对应成功快照。完整步骤见 SERVER_DEPLOYMENT.md。

## 上线检查

迁移/备份与恢复、管理员密码、HTTPS、CORS、账户隔离、发布权限、限流、官方数据核验、错误日志脱敏。外部部署需要真实账号和服务器，不在缺失凭证时伪造 URL。
