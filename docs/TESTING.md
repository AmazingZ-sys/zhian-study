# 测试结果与复现

初次验证日期：2026-10-30；最新本地复验：2026-11-02。macOS、Node 20.19.2、pnpm 10.26.2、Docker Desktop、PostgreSQL 16、Google Chrome。镜像为 Node 22 Alpine / linux/amd64。以下保留初次验证的细节与边界。

2026-11-02 已重新通过类型、Lint、9 项单元/组件测试、13 项独立数据库集成测试、2 条 E2E、前后端构建、真实容器冒烟及 10 个部署模拟场景。CI 和 Release verify 阶段新增实际镜像构建及测试库容器冒烟门禁。Netlify 站点 https://zhian-study.netlify.app 已创建，首次生产上传正在进行；GitHub Actions、正式 Release 和 GHCR 首次发布待推送后验证，尚无云端成功结论。

## 已验证

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

模拟结果证明脚本控制流，不证明 Linux/systemd/Nginx/HTTPS/GHCR 生产环境可用。容器测试另外验证真实镜像和 PostgreSQL，但没有代理层。

## 浏览器与可视检查

输出 `test-results/dashboard-desktop.png`、`test-results/dashboard-mobile.png`（375×812 视口全页截图）。已人工检查布局、演示标识、文字和导航；自动断言手机无横向溢出、导航可打开、无 pageerror。截图/报告被 Git 忽略。

生产静态构建另通过 Vite preview（127.0.0.1:5174）启动 Chrome，验证注册表单、懒加载岗位页面及真实 API 查询无 pageerror。移除造成循环依赖的手工 chunk 分组后重新构建验证；CSS 从全量约379KB降至约70KB，主 JS 约250KB（gzip约95KB），图表懒加载 chunk 约523KB（gzip约179KB）。

首次 Chromium 下载因网络/TLS 失败，改用本机 Chrome 实际运行通过，不是跳过测试。表单标签问题已修正。测试使用唯一账号标记，记录保留，未清库。

最终镜像复验曾遇到 Docker Hub metadata 超时，重试后完整构建和容器测试成功。最终本地 image ID：`sha256:51b2e0a5dd52c118e984c9699745880c2dfba861456bfc4f9363d80eb655fbe1`，这是本地镜像 ID，不是已推送 GHCR 的 manifest digest。

## 未验证

GitHub Actions 云端执行、required checks 阻断合并、Semantic Release/tag/Release 创建、Netlify 首次 Production 上传结果、GHCR 推送/双架构 manifest、远端拉取、宿主机 Nginx reload、线上恢复、异地备份恢复演练。

用户目前暂无服务器，本次仅部署前端并发布镜像；API 和生产数据库尚未部署。前端暂用 `VITE_API_BASE_URL=/api/v1`，Netlify `/api/*` 返回明确的 API 未部署 404 JSON。当前 E2E 证据来自本地 Web/API/测试库，不能据此宣称线上注册、登录和业务流程已可用；真实 API 上线后需替换构建地址并重新验收。

没有负载/压力/长稳测试、独立安全审计、完整 WCAG 审计。不能根据当前功能测试宣称可承受大规模并发。
