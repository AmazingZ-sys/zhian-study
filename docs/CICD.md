# CI/CD

2026-11-03 已使用本项目专用 Token 完成 pull 与预构建生产发布，将本地工作树产物发布到 [zhian-study.vercel.app](https://zhian-study.vercel.app)，部署 `dpl_CN41V6f3Fivc7wgSci8gu8xeMosK` 为 `READY` / `production`；[本次唯一部署地址](https://zhian-study-rc0oxht69-amazings-projects-6f99eda0.vercel.app)。这是手动生产发布，未创建新 Release，本次迁移的 GitHub Actions 云端执行和同 Release SHA 发布尚未验收。

Vercel 项目已设置为仓库根目录、Node 22.x。经用户授权，已创建仅用于 `zhian-study` 项目的专用 Token，有效期至 2027-11-03，并将 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 配置为 GitHub Secrets；凭据本身不写入工程或文档。正式域名 `zhian.amazingzsys.site` 仍由 Netlify 提供服务，DNS 切换由用户最后执行；API 的 HTTPS 当前不可达，因此继续使用公开构建变量 `VITE_API_BASE_URL=/api/v1`。生产 API、完整注册登录与业务写入尚未验收。实际执行结果见 [测试证据](TESTING.md)。

## 提交与发布

`feat` → MINOR；`fix`/`perf` → PATCH；`BREAKING CHANGE` → MAJOR；`docs`/`chore`/`test`/`ci` 默认不发版本。main 为生产分支，使用完整 git 历史，`tagFormat=v${version}`。

## CI

PR 和相关分支 push：冻结锁文件安装、契约漂移检查、typecheck、ESLint、单元/API 集成测试、Vue/API 构建、Playwright、部署故障模拟及 API 容器冒烟；使用 PostgreSQL service。CI 和 Release verify 复用 `.github/actions/verify-container`，构建实际 Docker 镜像，连接独立测试库，检查非 root、生产依赖、迁移、只读文件系统、数据库就绪和 API 读取。仓库管理员需设置 required CI checks，配置文件本身不能强制阻止合并。

## 发布依赖链

resolve → verify → version（semantic-release JS API 输出 released/version/tag/sha）→ frontend 与 image 并行。前端与镜像检出相同 Release SHA，只有产生新版本才部署；不依赖 `GITHUB_TOKEN` 创建 tag 再触发工作流。

`workflow_dispatch` 输入已存在的正式 `vX.Y.Z`，校验 GitHub Release 和 tag，不升级或覆盖 Release，重部署旧版本不移动 latest。前端 Vercel 发布所选 tag 必须包含迁移配置与 Vercel CLI；迁移前 `v1.0.0` 不适用于首次 Vercel 发布。

## Vercel 配置

- 创建或选择本项目，Root Directory 为仓库根目录，Node.js 为 22.x，根工程 `engines.node` 为 `>=20.19 <23`。根 `vercel.json` 使用 Vite、冻结 pnpm 安装、`@zhian/web` 构建和 `apps/web/dist` 输出。
- 根工程精确锁定 Vercel CLI `65.10.0`。`git.deploymentEnabled=false` 关闭 Git 自动部署，生产发布由 Actions 完成。
- 三项 GitHub Secrets 已配置；缺少时 workflow 明确失败。项目专用 Token 经用户授权创建，有效期至 2027-11-03，后续应按期轮换。此前 Netlify Token/Site ID 不能代替 Vercel 凭据。
- 公开 Variable `VITE_API_BASE_URL` 必须显式配置。未部署 API 时可用 `/api/v1`；接入真实 API 后使用 `https://api.zhian.amazingzsys.site/api/v1`。不要把后端密钥传入 Web 构建。

前端 job 依次运行：

```bash
pnpm exec vercel pull --yes --environment=production --token "$VERCEL_TOKEN"
pnpm exec vercel build --prod --token "$VERCEL_TOKEN"
pnpm exec vercel deploy --prebuilt --prod --yes --json --token "$VERCEL_TOKEN"
```

构建步骤显式注入公开 API 地址；部署上传本次预构建产物。部署步骤显式使用 `--json`，以 `jq` 校验 `.status`、`.deployment.readyState=READY`、`.deployment.target=production` 与 HTTPS URL，再保存部署 URL、Release 版本与 SHA 收据到 artifact 和 job summary，避免依赖 stdout 只有一行 URL 的假设。本次已验证手动部署返回 JSON 的真实格式；当前 Actions 云端运行及同 Release SHA 关联尚未验收。`.vercel` 项目状态、下载的环境文件与产物均忽略提交和 Docker 上下文。CLI 行为见 [Vercel build](https://vercel.com/docs/cli/build) 与 [Vercel deploy](https://vercel.com/docs/cli/deploy)。

`/api/*` 优先进入 `api/api-unavailable.mjs`，所有 HTTP 方法返回 API 未部署的 503 JSON；其他页面保留 SPA fallback、安全头和静态缓存。真实 HTTPS API 基址请求直接访问服务器。

## 首次迁移与域名

项目和 Secrets 已配置，本次本地工作树的手动预构建生产发布及静态 HTTP 验收已通过。匿名 `/login` 与 `/questions/validation-route` 返回 200，JavaScript 返回正确 MIME 与 immutable 长缓存，原 CSP 等安全头保留；GET `/api/v1/users/me`、POST `/api/v1/auth/login` 均返回 503 JSON、`API_NOT_DEPLOYED` 和 `Cache-Control: no-store`。后续仍需通过包含迁移提交的新 Release 验证 Actions 全链与同 SHA 发布。正式域名 `zhian.amazingzsys.site` 已绑定本项目，但 DNS 仍在 Netlify；由用户按本项目显示的 DNS 目标切换并验证 HTTPS，实际目标见 [部署总览](DEPLOYMENT.md)，不能使用参考项目的 CNAME。

后端保留精确 `CORS_ORIGINS=https://zhian.amazingzsys.site`、Secure 和 SameSite=Lax Cookie。临时 `vercel.app` 地址只用于静态验收，不自动加入生产 Origin；正式域名完整登录、写请求和退出需另行验收。

## 权限与故障恢复

默认 `contents:read`，version job `contents:write`，image `packages:write`。GitHub 发布使用 `GITHUB_TOKEN`，production Environment 按需配置审批。Vercel Token 限定到有权部署本项目的账户/团队。

Release 成功但某部署失败时，先修正环境并重跑失败 job；也可手动输入已包含迁移配置的同一正式 tag，无需制造功能提交。手动流程还会重建同 tag API 镜像，应记录 digest 变化；服务器继续使用成功快照中的固定 digest，不会自动更新。

## 迁移前发布证据（2026-11-02）

代码 `879069f` 的 [CI 41383287145](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145) 与 [Release 41383287140](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 全部通过；[v1.0.0](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 已发布。首次云端 E2E 的笔记保存竞态已修复后重新通过。

Netlify API 确认历史部署 `6ae8046280c64206131c6cbd` 为 `production` / `ready`、title `v1.0.0`；[历史永久地址](https://6ae8046280c64206131c6cbd--zhian-study.netlify.app) 的 `/login` 为 200，安全头正确，GET/POST API 均为 503 JSON。这些记录不代表 Vercel 已发布。

GHCR 镜像 `ghcr.io/amazingz-sys/zhian-study-api:v1.0.0` 已发布，manifest 含 `linux/amd64` 和 `linux/arm64`，digest 为 `sha256:27804750fb7a7369ad3f55406489b80ad0ff7c7f756e24961757f8b40f28d8c8`。匿名 manifest 读取通过，完整镜像匿名 pull 尚未执行。生产服务器、Nginx/HTTPS、恢复和异地备份的验收见服务器手册与实际运行记录。
