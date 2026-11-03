# 测试结果与复现

初次验证日期：2026-10-30；最新本地复验：2026-11-03。macOS、Node 20.19.2、pnpm 10.26.2、Docker Desktop、PostgreSQL 16、Google Chrome。镜像为 Node 22 Alpine / linux/amd64。以下保留初次验证的细节与边界。

迁移前历史记录：2026-11-02 已重新通过类型、Lint、9 项单元/组件测试、13 项独立数据库集成测试、2 条 E2E、前后端构建、真实容器冒烟及 10 个部署模拟场景。CI 和 Release verify 阶段新增实际镜像构建及测试库容器冒烟门禁。前端已通过本地 CLI 部署至公开站点 https://zhian-study.netlify.app，匿名 `/login` 返回 200，安全头已核验。代码 `879069f` 的[云端 CI](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145) 全部通过，[Release 工作流](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 的全部 jobs（含容器门禁、版本、前端和双架构镜像发布）均成功，[v1.0.0](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 正式发布且 Netlify Actions 部署成功。首次云端 E2E 暴露笔记保存完成前刷新页面的竞态，已等待保存响应后再刷新并重新通过。

## Vercel 迁移（2026-11-03）

本次将前端配置改为 Vercel：仓库根目录、Node 22、CLI 65.10.0、冻结安装、pull/build/prebuilt deploy，关闭 Git 自动部署。根 `engines.node` 限定 `>=20.19 <23`，避免 Vercel 自动选择更高 Node 主版本。`/api/*` 优先进入 `api/api-unavailable.mjs`，对所有 HTTP 方法返回 503 JSON；SPA、安全头、HTML 重新验证和 assets immutable 缓存保留。

2026-11-03 已使用本项目专用 Token 完成 pull 与预构建生产发布，将本地工作树产物发布到 [zhian-study.vercel.app](https://zhian-study.vercel.app)，部署 `dpl_CN41V6f3Fivc7wgSci8gu8xeMosK` 为 `READY` / `production`；[本次唯一部署地址](https://zhian-study-rc0oxht69-amazings-projects-6f99eda0.vercel.app)。这是手动生产发布，未创建新 Release，本次迁移的 GitHub Actions 云端执行和同 Release SHA 发布尚未验收。

Vercel 项目已设置为仓库根目录、Node 22.x。经用户授权，已创建仅用于 `zhian-study` 项目的专用 Token，有效期至 2027-11-03，并将 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 配置为 GitHub Secrets；凭据本身不写入工程或文档。

| 本次验证                                   | 结果                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `pnpm typecheck`、`pnpm lint`、`pnpm test` | 全部通过，9 项单元/组件测试                                                                     |
| `pnpm build`                               | 全仓构建通过                                                                                    |
| `pnpm test:integration`                    | 13 项通过；测试容器恢复原先停止状态                                                             |
| `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`  | 2 条完整场景通过                                                                                |
| `pnpm test:deploy`                         | 2026-11-03 再次通过 10 个隔离部署场景                                                           |
| Vercel 生产预构建与上传                    | 本地工作树手动发布，实际状态 READY / production                                                 |
| 匿名入口与深层路由                         | `/login`、`/questions/validation-route` 均为 200                                                |
| JavaScript 与安全头                        | 正确 JavaScript MIME、immutable 缓存，CSP 等原安全头保留                                        |
| API 未部署兜底                             | GET `/api/v1/users/me`、POST `/api/v1/auth/login` 均为 503 JSON、`API_NOT_DEPLOYED`、`no-store` |

首次已登录 CLI 的部署响应保存在忽略提交的 `.artifacts/vercel-migration/deployment-url.txt`，随后本项目专用 Token 的 pull 和预构建部署实际通过，最新收据为 `.artifacts/vercel-migration/token-deploy-response.json`。HTTP 证据在 `.artifacts/vercel-migration/http-receipt.json`。Token 的本地中转已删除；这些是手动生产发布证据，不是新 Release 或 Actions 发布证据。

正式域名 `zhian.amazingzsys.site` 已绑定本 Vercel 项目，但 DNS 仍由 Netlify 提供服务，DNS 切换由用户最后执行；API 的 HTTPS 当前不可达，因此继续使用公开构建变量 `VITE_API_BASE_URL=/api/v1`。生产 API、完整注册登录与业务写入尚未验收。当前迁移的 Actions 云端流程、同 Release SHA 关联、正式域名 DNS/HTTPS 与生产登录写入仍待验收。下方保留迁移前 Netlify 历史记录。

## 迁移前已验证（截至 2026-11-02）

| 验证         | 命令/证据                                                        | 结果                                                                   |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 类型         | `pnpm typecheck`                                                 | 六个 workspace 包通过                                                  |
| Lint         | `pnpm lint`                                                      | 通过                                                                   |
| 单元/组件    | `pnpm test`                                                      | 9 项通过；默认跳过数据库集成组                                         |
| API/数据库   | `pnpm test:integration`                                          | 13 项通过，独立 zhian_test 数据库                                      |
| Web/API 构建 | `pnpm build`                                                     | 通过；图表 chunk 仍有体积告警                                          |
| 浏览器       | `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`                        | 2 个完整场景通过，覆盖任务书 13 个核心步骤                             |
| 部署故障     | `pnpm test:deploy`                                               | 10 个隔离 Linux 场景通过；另拒绝 latest/未确认回滚                     |
| 迁移/种子    | `pnpm db:migrate` / `pnpm db:seed`                               | zhian、zhian_test 成功，可重复执行                                     |
| 镜像         | `docker build -t zhian-study-api:local -f apps/api/Dockerfile .` | 本地 linux/amd64 构建成功                                              |
| 容器         | `pnpm test:container`                                            | UID1000、只读根文件系统、生产依赖、迁移、数据库 /ready 和分类 API 通过 |
| OpenAPI      | `pnpm api:generate`                                              | JSON 与 TS 类型生成成功                                                |

测试源：`packages/shared/src/rules.test.ts`、`apps/web/src/components/*.test.ts`、`apps/api/test/integration.test.ts`、`e2e/platform.spec.ts`、`scripts/test-deploy*.sh`、`scripts/test-container.sh`。

## 迁移前云端发布证据（2026-11-02）

- 提交 `879069f`：[CI 41383287145](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145) 全绿；[Release 41383287140](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 的全部 jobs（含真实容器门禁、版本、前端和双架构镜像发布）成功。
- [v1.0.0 正式 Release](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 已创建；首次云端 E2E 的笔记保存竞态修复后重新通过。
- Netlify API 确认 Actions 部署处于 `production`、`ready`，title 为 `v1.0.0`，deploy ID 为 `6ae8046280c64206131c6cbd`；[永久部署地址](https://6ae8046280c64206131c6cbd--zhian-study.netlify.app)。
- 匿名 `/login` 返回 200，CSP 等安全头正确；GET `/api/v1/users/me` 和 POST `/api/v1/auth/login` 均返回 503、`application/json`，明确表示 API 未部署。
- GHCR `ghcr.io/amazingz-sys/zhian-study-api:v1.0.0` 发布成功，manifest 包含 `linux/amd64` 和 `linux/arm64`；digest 为 `sha256:27804750fb7a7369ad3f55406489b80ad0ff7c7f756e24961757f8b40f28d8c8`。匿名 manifest 读取已通过；完整镜像匿名 pull 尚未执行。

## 核心断言

- 注册登录、密码校验、资料隔离、后台权限；禁用账户立即阻断已有 token。
- HttpOnly Cookie、恶意/缺少 Origin 拒绝、Bearer；Refresh 轮换与旧令牌重放撤销。
- 未答题不返回答案；幂等键仅产生一次记录；错题、收藏、笔记持久化。
- 考试暂存、归属、并发提交、数据库截止时间；并发创建最多五场；统计结算离线超时考试。
- 组合岗位检索、三态匹配、岗位/公告收藏。
- 导入失败不部分落库、去重、错误 CSV、CSV/XLSX 导入导出、权限与审计。
- 修改密码撤销所有会话；富文本中的 HTML/script 作为文本显示，不生成可执行节点。
- 移动端无 access token 时仍可使用 refresh token 退出并撤销会话。
- 浏览器注册→退出→登录→答题→刷新后笔记/记录→错题收藏→考试→报告→统计→选岗→公告；管理员分别导入题目与岗位。

## 部署测试边界

隔离临时目录模拟 docker/nginx/curl/systemctl/flock：首次成功、迁移失败、HTTP 健康失败、切换后 Nginx 校验失败、reload 失败、锁冲突、再次成功、回滚前版、回滚指定版、拒绝不安全 env 权限。断言 current 与运行镜像不保留失败版，回滚不执行迁移。

模拟结果证明脚本控制流，不证明 Linux/systemd/Nginx/HTTPS 生产服务器环境可用；GHCR 发布已有独立云端证据。容器测试另外验证真实镜像和 PostgreSQL，但没有代理层。

## 浏览器与可视检查

输出 `test-results/dashboard-desktop.png`、`test-results/dashboard-mobile.png`（375×812 视口全页截图）。已人工检查布局、演示标识、文字和导航；自动断言手机无横向溢出、导航可打开、无 pageerror。截图/报告被 Git 忽略。

生产静态构建另通过 Vite preview（127.0.0.1:5174）启动 Chrome，验证注册表单、懒加载岗位页面及真实 API 查询无 pageerror。移除造成循环依赖的手工 chunk 分组后重新构建验证；CSS 从全量约379KB降至约70KB，主 JS 约250KB（gzip约95KB），图表懒加载 chunk 约523KB（gzip约179KB）。

首次 Chromium 下载因网络/TLS 失败，改用本机 Chrome 实际运行通过，不是跳过测试。表单标签问题已修正。测试使用唯一账号标记，记录保留，未清库。

最终镜像复验曾遇到 Docker Hub metadata 超时，重试后完整构建和容器测试成功。最终本地 image ID：`sha256:51b2e0a5dd52c118e984c9699745880c2dfba861456bfc4f9363d80eb655fbe1`，这是本地镜像 ID，不是已推送 GHCR 的 manifest digest。

## 未验证

required checks 阻断合并、GHCR 匿名拉取、arm64 实机运行、远端服务器拉取、宿主机 Nginx reload、线上恢复、异地备份恢复演练。GHCR 发布结果和 manifest digest 见 [CI/CD](CICD.md)。

截至迁移前交付，生产 API/数据库未验收；当时 Netlify `/api/*` 的通用 Function 解决了静态 404 rewrite 对 POST 返回 HTML 的问题。本次 Vercel 保留同样的 503 JSON 行为。前端使用 `/api/v1` 时会命中兜底，接入真实 HTTPS API 后需重新构建。已有 E2E 证据来自本地与云端 CI 的 Web/API/测试库，不能据此宣称生产注册、登录和业务流程已可用；服务器和完整前后端联调需另行验收。

没有负载/压力/长稳测试、独立安全审计、完整 WCAG 审计。不能根据当前功能测试宣称可承受大规模并发。
