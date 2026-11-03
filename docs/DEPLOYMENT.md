# 部署总览

2026-11-03 已完成 Vercel 迁移，正式 [v1.0.2](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.2) 已通过 GitHub Actions 发布到 [zhian-study.vercel.app](https://zhian-study.vercel.app)。[主分支 CI 41596176461](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41596176461) 全绿，[正式 Release 41596176309](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41596176309) 的 resolve、verify、version、frontend 和 image 全部成功。

Actions artifact `vercel-v1.0.2` 的部署收据对应 tag `v1.0.2`、commit `5334dad1024fa5c110c8ace11f1a73833d7483e2` 和 [唯一部署地址](https://zhian-study-2l3cb86hk-amazings-projects-6f99eda0.vercel.app)；Git tag 指向同一 SHA，Vercel 实际状态为 `READY` / `production`，部署 ID 为 `dpl_29TEEy7VmXPX7y5zGUA9JRD7oSSk`。

匿名 `/login` 与 `/questions/validation-route` 返回 200，JavaScript 返回正确 MIME 与 immutable 长缓存，原 CSP 等安全头保留；GET `/api/v1/users/me`、POST `/api/v1/auth/login` 均返回 503 JSON、`API_NOT_DEPLOYED` 和 `Cache-Control: no-store`。用户已自行完成正式域名 [zhian.amazingzsys.site](https://zhian.amazingzsys.site) 的 DNS 切换，Vercel 域名配置、证书和静态 HTTP 均已验收；前端尚未接入生产 API，继续使用公开构建变量 `VITE_API_BASE_URL=/api/v1`。生产 API、完整注册登录与业务写入尚未验收。证据见 [测试结果](TESTING.md)。

## 本地

`pnpm install --frozen-lockfile`；复制 `.env.example` 为 `.env`；`docker compose up -d db`；`pnpm db:migrate`；`pnpm db:seed`；`pnpm dev`。种子不创建公开固定密码管理员，使用 `ADMIN_EMAIL`/`ADMIN_PASSWORD` 显式设置或管理脚本提升既有用户。

## Vercel

根 `vercel.json` 指定 Vite、`pnpm install --frozen-lockfile`、`pnpm --filter @zhian/web build` 和 `apps/web/dist`；Vercel 项目 Root Directory 设为仓库根目录，Node.js 设为 22.x。根工程 `engines.node` 为 `>=20.19 <23`，避免平台自动选择更高 Node 主版本。锁定 CLI `65.10.0`，`git.deploymentEnabled=false`，生产入口为 GitHub Actions，v1.0.2 全链发布已通过。

Vercel 项目已设置为仓库根目录、Node 22.x。经用户授权，已创建仅用于 `zhian-study` 项目的专用 Token，有效期至 2027-11-03，并将 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 配置为 GitHub Secrets；凭据本身不写入工程或文档。公开 Variable `VITE_API_BASE_URL` 在构建时显式注入。Actions 工作流配置检出同一 Release SHA，依次执行 `vercel pull --yes --environment=production`、`vercel build --prod`、`vercel deploy --prebuilt --prod --json`，兼容平铺和 `deployment` 封装 JSON，校验 READY/production/HTTPS URL 后保存 URL、版本和 SHA 收据；详见 [CI/CD](CICD.md)。不要把数据库、JWT 或其他后端密钥放入前端构建环境。

`/api/*` 优先 rewrite 到 `api/api-unavailable.mjs`，为所有 HTTP 方法返回 `API_NOT_DEPLOYED` 的 503 JSON，并使用 `no-store`。其他页面保留 Vue Router history 的 SPA fallback、安全响应头和 HTML 重新验证；哈希 assets 使用 immutable 长缓存。

没有生产 API 时使用 `VITE_API_BASE_URL=/api/v1`；真实 API 可用后改为 `https://api.zhian.amazingzsys.site/api/v1` 并重新构建，浏览器将直接访问该 API。完整注册、登录和数据流程需在正式域名上另行验收。

正式前端域名 [zhian.amazingzsys.site](https://zhian.amazingzsys.site) 已绑定本 Vercel 项目，用户已自行完成 DNS 切换。2026-11-03 权威服务器 `heron.dnspod.net` 返回 `zhian` CNAME → `312f34b1e08dbff2.vercel-dns-017.com`；Vercel CLI 确认 `configured_correctly` 且项目 `verified=true`。正式域名 HTTPS 证书有效，入口和深层路由 200、JS MIME/immutable 缓存、GET/POST API 503 JSON 以及安全头均已通过 HTTP 验收，响应由 Vercel 提供。API 子域名不在本次前端 DNS 迁移范围；服务器和后续联调见 [服务器手册](SERVER_DEPLOYMENT.md)。

## 迁移前的历史发布（2026-11-02）

代码 `879069f` 的 [CI](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145)、[Release 工作流](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 均成功，[v1.0.0](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 已正式发布。Netlify API 确认部署 `6ae8046280c64206131c6cbd` 为 `production` / `ready`；[历史永久地址](https://6ae8046280c64206131c6cbd--zhian-study.netlify.app) 的 `/login` 为 200、安全头正确，GET/POST API 为 503 JSON。这些是迁移前证据，不能用来证明 Vercel 已发布。

迁移前 tag 缺少 Vercel CLI 和配置，不能直接用 `v1.0.0` 完成首次 Vercel 发布；首个迁移版本必须包含当前部署改动。

## API

Docker 多阶段、非 root、端口 3000，包含迁移命令。已发布镜像 `ghcr.io/amazingz-sys/zhian-study-api:v1.0.0`（linux/amd64、linux/arm64）；本地构建、真实数据库容器冒烟及迁移前云端容器门禁已通过，manifest 摘要和访问边界见 [CI/CD](CICD.md)。生产使用明确版本或 digest。服务器安装、数据库、Nginx 与 HTTPS 步骤见 [服务器手册](SERVER_DEPLOYMENT.md)。

## 生产环境

API 配置 `DATABASE_URL`、随机 `JWT_SECRET`、`CORS_ORIGINS=https://zhian.amazingzsys.site`、`COOKIE_SECURE=true`、`COOKIE_SAME_SITE=lax`、`NODE_ENV=production`。前后端使用同站子域；临时 `vercel.app` 与 API 跨站，只用于静态验证，不自动加入生产允许名单。

`TRUSTED_PROXY_IPS` 只填写 API 实际 socket 对端的 Nginx/Docker bridge IP。部署脚本将 tag 解析为 digest，成功快照保存该 digest 及当时配置；回滚需要对应成功快照，不自动降级数据库。生产 API、完整登录写入、远端恢复和异地备份需在真实环境验证。
