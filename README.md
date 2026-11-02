# 知岸公考 · zhian-study

个人长期备考与选岗工作台。Vue 3 Web + Hono API + PostgreSQL，pnpm Monorepo。学习记录、试卷、收藏、笔记和管理操作均由 API 持久化，不以固定数据冒充用户数据。

当前为可本地运行、带自动发布和服务器部署配置的第一阶段实现。2026-11-02 已重新通过全部本地检查；Netlify 站点 [zhian-study.netlify.app](https://zhian-study.netlify.app) 已创建，正在首次生产上传。GitHub Actions、正式 Release 和 GHCR 发布待首次推送及云端验证。

用户目前暂无服务器，本次仅部署前端并发布 API 镜像。前端构建暂用 `VITE_API_BASE_URL=/api/v1`；Netlify 的 `/api/*` 返回明确说明 API 尚未部署的 404 JSON，注册、登录和业务数据功能需后续接入真实 API。默认内容只有原创示例题、虚构岗位和使用指南，均明确标记演示；真实题库、招录数据和专业目录需合法接入。完整边界见 [交付报告](docs/DELIVERY_REPORT.md)。

## 本地启动

建议 Node.js 22、pnpm 10.26.2、Docker Desktop / Docker Compose。Node.js 20.19.2 也已通过本地验证。

```bash
corepack enable
corepack prepare pnpm@10.26.2 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d db
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web：http://localhost:5173
- API：http://localhost:3000/health
- 数据库就绪：http://localhost:3000/ready
- OpenAPI：http://localhost:3000/api/v1/openapi.json
- PostgreSQL：127.0.0.1:5438，数据库 zhian。示例凭据只用于本地开发。

先在 Web 注册个人账户，再按需提升管理员：

```bash
pnpm admin:promote your-email@example.com
```

刷新后可进入 `/admin`。没有固定默认管理员或通用密码。种子可重复执行，不覆盖已有业务记录；生产环境不要运行演示种子。

数据库使用 `zhian_pgdata` 命名卷。`docker compose stop` 保留数据；不要用 `down -v` 清理有用数据。若端口被占用，同步修改 Compose、`.env`、Vite 代理及 Playwright 配置。

## 开发与验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm api:generate
```

OpenAPI 生成文件位于 `docs/generated/openapi.json`，TS 契约位于 `packages/api-client/src/generated.ts`。Axios 负责传输和刷新会话，`createTypedClient` 使用生成契约，统计页已接入。部分考试/后台响应仍为通用契约，边界见 API 文档。

集成测试必须使用独立 `_test` 数据库。首次创建（已存在时跳过创建命令）：

```bash
docker compose exec db psql -U zhian -d postgres -c 'CREATE DATABASE zhian_test'
DATABASE_URL=postgresql://zhian:local-development-only@localhost:5438/zhian_test pnpm db:migrate
DATABASE_URL=postgresql://zhian:local-development-only@localhost:5438/zhian_test pnpm db:seed
pnpm test:integration
```

测试使用唯一账号与内容标记，不自动清空数据库。指定其他测试库可设置 `TEST_DATABASE_URL`。普通 `pnpm test` 跳过需要真实数据库的集成组。

```bash
pnpm exec playwright install chromium
pnpm test:e2e
# 如已安装 Google Chrome，可绕过 Chromium 下载：
PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e
pnpm test:deploy
docker build -t zhian-study-api:local -f apps/api/Dockerfile .
pnpm test:container
```

E2E 默认复用已有开发服务，会向其数据库写入明确的测试记录。若需要隔离，先停止 `pnpm dev`，再设置 `DATABASE_URL` 为测试库启动 E2E。截图/报告位于 `test-results/`、`playwright-report/`。容器冒烟使用独立测试库和本地端口 3300，结束后删除临时 API 容器，保留数据库。

2026-11-02 复验：类型、Lint、9 项单元/组件测试、13 项数据库集成测试、2 条 E2E、前后端构建、容器冒烟及 10 个部署场景均通过。CI 和 Release 的验证阶段均加入真实镜像构建与数据库容器冒烟门禁；云端执行结果另行记录。

## 结构

```text
apps/web/                 Vue 页面、组件、样式和用户状态
apps/api/                 Hono API、Drizzle 模型/迁移、集成测试
packages/contracts/       Zod 校验、DTO 与业务类型
packages/shared/          判分与报考匹配规则
packages/api-client/      Axios、生成契约与类型化适配
packages/utils/           日期、比例和 CSV 转义
deploy/                   Linux Docker API + 宿主机 Nginx
scripts/                  发布、备份、部署与容器测试
e2e/                      Playwright 核心闭环
docs/                     产品、架构、部署及交付证据
.github/workflows/        CI 和自动发布
```

## 发布与运行

采用 Conventional Commits。main 验证后由 Semantic Release 创建版本，再并行发布 Netlify/GHCR。无版本变化不发布。手动 `workflow_dispatch` 接受已有正式 tag，可恢复失败部署，不重复创建 Release。

预期镜像：`ghcr.io/amazingz-sys/zhian-study-api:vX.Y.Z`，当前待首次 GHCR 发布验证。服务器部署留待取得服务器后进行；届时需要 Docker/Compose、宿主机 Nginx、curl、bash、flock、systemd、GNU coreutils，不安装 Node/pnpm。在服务器部署目录执行：

```bash
sudo ./deploy.sh v1.0.0
sudo ./deploy.sh v1.0.1
sudo env CONFIRM_DB_COMPATIBLE=yes ./rollback.sh
sudo env CONFIRM_DB_COMPATIBLE=yes ./rollback.sh v1.0.0
```

部署将 tag 解析为镜像摘要；回滚使用成功快照中的摘要、Compose 和环境配置。数据库不自动降级。首次配置、备份、HTTPS、权限和失败恢复见 [服务器手册](docs/SERVER_DEPLOYMENT.md)。

GitHub 需 Secret `NETLIFY_AUTH_TOKEN`，Variables `NETLIFY_SITE_ID`、`VITE_API_BASE_URL`，production Environment 和 required CI checks。首次上传使用已登录的本地 Netlify CLI，后续由 Actions 发布；Netlify 必须关闭 Git 自动生产发布。取得真实 HTTPS API 后，将 `VITE_API_BASE_URL` 从 `/api/v1` 换为完整 API 地址并重新构建，按实际前端域名配置 API CORS/Cookie。推荐前后端同站子域，避免第三方 Cookie 被阻断。

## 文档

- [实施计划](docs/IMPLEMENTATION_PLAN.md) · [完整交付报告与缺口](docs/DELIVERY_REPORT.md)
- [产品](docs/PRODUCT_REQUIREMENTS.md) · [架构](docs/ARCHITECTURE.md) · [设计规范](docs/DESIGN_SYSTEM.md)
- [数据库](docs/DATABASE.md) · [API](docs/API_SPEC.md) · [数据来源](docs/DATA_SOURCES.md)
- [多端扩展](docs/MULTI_PLATFORM.md) · [测试结果](docs/TESTING.md)
- [CI/CD](docs/CICD.md) · [部署总览](docs/DEPLOYMENT.md) · [服务器操作](docs/SERVER_DEPLOYMENT.md)
