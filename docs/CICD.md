# CI/CD

2026-11-03 已完成 Vercel 迁移，正式 [v1.0.2](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.2) 已通过 GitHub Actions 发布到 [zhian-study.vercel.app](https://zhian-study.vercel.app)。[主分支 CI 41596176461](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41596176461) 全绿，[正式 Release 41596176309](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41596176309) 的 resolve、verify、version、frontend 和 image 全部成功。

Actions artifact `vercel-v1.0.2` 的部署收据对应 tag `v1.0.2`、commit `5334dad1024fa5c110c8ace11f1a73833d7483e2` 和 [唯一部署地址](https://zhian-study-2l3cb86hk-amazings-projects-6f99eda0.vercel.app)；Git tag 指向同一 SHA，Vercel 实际状态为 `READY` / `production`，部署 ID 为 `dpl_29TEEy7VmXPX7y5zGUA9JRD7oSSk`。

Vercel 项目已设置为仓库根目录、Node 22.x。经用户授权，已创建仅用于 `zhian-study` 项目的专用 Token，有效期至 2027-11-03，并将 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 配置为 GitHub Secrets；凭据本身不写入工程或文档。用户已自行完成正式域名 [zhian.amazingzsys.site](https://zhian.amazingzsys.site) 的 DNS 切换，Vercel 域名配置、证书和静态 HTTP 均已验收；前端尚未接入生产 API，继续使用公开构建变量 `VITE_API_BASE_URL=/api/v1`。生产 API、完整注册登录与业务写入尚未验收。实际执行结果见 [测试证据](TESTING.md)。

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

构建步骤显式注入公开 API 地址；部署上传本次预构建产物。部署步骤显式使用 `--json`，以 `jq` 的 `(.deployment // .)` 同时读取平铺 JSON 和 `deployment` 封装 JSON，校验 READY、production 与 HTTPS URL，再保存部署 URL、Release 版本与 SHA 收据到 artifact 和 job summary。两种真实 CLI 响应已分别验证；v1.0.2 的正式 Actions、Git tag、收据和 Vercel 部署均关联到同一 Release SHA。`.vercel` 项目状态、下载的环境文件与产物均忽略提交和 Docker 上下文。CLI 行为见 [Vercel build](https://vercel.com/docs/cli/build) 与 [Vercel deploy](https://vercel.com/docs/cli/deploy)。

`/api/*` 优先进入 `api/api-unavailable.mjs`，所有 HTTP 方法返回 API 未部署的 503 JSON；其他页面保留 SPA fallback、安全头和静态缓存。真实 HTTPS API 基址请求直接访问服务器。

## 正式发布与域名

项目和 Secrets 已配置，v1.0.2 的正式 Actions、同 SHA 发布和静态 HTTP 验收已通过。匿名 `/login` 与 `/questions/validation-route` 返回 200，JavaScript 返回正确 MIME 与 immutable 长缓存，原 CSP 等安全头保留；GET `/api/v1/users/me`、POST `/api/v1/auth/login` 均返回 503 JSON、`API_NOT_DEPLOYED` 和 `Cache-Control: no-store`。正式域名 `zhian.amazingzsys.site` 已绑定本项目，用户已自行完成 DNS 切换；权威 CNAME、Vercel 配置/所有权验证、HTTPS 证书和正式域名静态 HTTP 均已验收，实际目标及证据见 [部署总览](DEPLOYMENT.md)。

后端保留精确 `CORS_ORIGINS=https://zhian.amazingzsys.site`、Secure 和 SameSite=Lax Cookie。临时 `vercel.app` 地址只用于静态验收，不自动加入生产 Origin；正式域名完整登录、写请求和退出需另行验收。

## 权限与故障恢复

默认 `contents:read`，version job `contents:write`，image `packages:write`。GitHub 发布使用 `GITHUB_TOKEN`，production Environment 按需配置审批。Vercel Token 限定到有权部署本项目的账户/团队。

Release 成功但某部署失败时，先修正环境并重跑失败 job；也可手动输入已包含迁移配置的同一正式 tag，无需制造功能提交。手动流程还会重建同 tag API 镜像，应记录 digest 变化；服务器继续使用成功快照中的固定 digest，不会自动更新。

## 迁移前发布证据（2026-11-02）

代码 `879069f` 的 [CI 41383287145](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145) 与 [Release 41383287140](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 全部通过；[v1.0.0](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 已发布。首次云端 E2E 的笔记保存竞态已修复后重新通过。

Netlify API 确认历史部署 `6ae8046280c64206131c6cbd` 为 `production` / `ready`、title `v1.0.0`；[历史永久地址](https://6ae8046280c64206131c6cbd--zhian-study.netlify.app) 的 `/login` 为 200，安全头正确，GET/POST API 均为 503 JSON。这些记录不代表 Vercel 已发布。

GHCR 镜像 `ghcr.io/amazingz-sys/zhian-study-api:v1.0.0` 已发布，manifest 含 `linux/amd64` 和 `linux/arm64`，digest 为 `sha256:27804750fb7a7369ad3f55406489b80ad0ff7c7f756e24961757f8b40f28d8c8`。匿名 manifest 读取通过，完整镜像匿名 pull 尚未执行。生产服务器、Nginx/HTTPS、恢复和异地备份的验收见服务器手册与实际运行记录。
