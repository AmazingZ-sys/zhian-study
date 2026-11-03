# 知岸公考：第一阶段交付报告

初次交付记录：2026-10-30。保留原仓库个人使用定位；初始 main 仅有 README。当时的代码、文档和配置均在工作区，未提交、未推送、未创建正式版本，也未进行生产部署。以下保留该阶段的实现和验证证据。

迁移前历史（2026-11-02）：类型、Lint、单元 9 项、数据库集成 13 项、E2E 2 条、前后端构建、真实容器冒烟及部署模拟 10 场景已重新通过；CI 与 Release 增加实际容器验证门禁。前端已通过本地 CLI 部署至 https://zhian-study.netlify.app，并通过 Netlify API 设为公开；匿名 `/login` 返回 200，安全头已核验。代码 `879069f` 的[云端 CI](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287145) 全部通过，[Release 工作流](https://github.com/AmazingZ-sys/zhian-study/actions/runs/41383287140) 的全部 jobs（含容器门禁、版本、前端和双架构镜像发布）均成功，[v1.0.0](https://github.com/AmazingZ-sys/zhian-study/releases/tag/v1.0.0) 已正式发布，Netlify 已由 Actions 部署成功。首次云端 E2E 的笔记保存竞态已修复并重新通过。

2026-11-03 已使用本项目专用 Token 完成 pull 与预构建生产发布，将本地工作树产物发布到 [zhian-study.vercel.app](https://zhian-study.vercel.app)，部署 `dpl_CN41V6f3Fivc7wgSci8gu8xeMosK` 为 `READY` / `production`；[本次唯一部署地址](https://zhian-study-rc0oxht69-amazings-projects-6f99eda0.vercel.app)。这是手动生产发布，未创建新 Release，本次迁移的 GitHub Actions 云端执行和同 Release SHA 发布尚未验收。

Vercel 项目已设置为仓库根目录、Node 22.x。经用户授权，已创建仅用于 `zhian-study` 项目的专用 Token，有效期至 2027-11-03，并将 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 配置为 GitHub Secrets；凭据本身不写入工程或文档。匿名 `/login` 与 `/questions/validation-route` 返回 200，JavaScript 返回正确 MIME 与 immutable 长缓存，原 CSP 等安全头保留；GET `/api/v1/users/me`、POST `/api/v1/auth/login` 均返回 503 JSON、`API_NOT_DEPLOYED` 和 `Cache-Control: no-store`。本地类型、Lint、9 项单元、全仓构建、13 项集成、2 条 Chrome E2E 及 10 个部署故障场景均通过；测试容器恢复原先停止状态；详见 [测试记录](TESTING.md)。

未接入真实 API 时，Web 使用 `VITE_API_BASE_URL=/api/v1`，Vercel `/api/*` 对所有 HTTP 方法返回明确的 API 未部署 503 JSON。接入 `https://api.zhian.amazingzsys.site/api/v1` 后需重新构建并验证 CORS/Cookie；前端部署和 API 镜像发布不代表生产 API、数据库及完整业务已上线。服务器准备与联调见 [服务器手册](SERVER_DEPLOYMENT.md)。

## 1. 架构

pnpm workspace：Vue3/TypeScript/Vite/Router/Pinia/Element Plus/Axios/ECharts Web；Hono/Node/Zod/Drizzle/PostgreSQL API；共享 contracts、shared、utils、api-client。Web 与 API 可独立构建。浏览器使用 HttpOnly Cookie，未来移动端使用 Bearer。输入以 Zod 校验，服务端执行权限和用户隔离。

部署：Vercel Web → HTTPS 宿主机 Nginx → 127.0.0.1:3000 Docker API → 独立 PostgreSQL。Nginx 不在容器中。

## 2. 最终目录

```text
apps/
  web/src/{pages,components,stores}/
  api/{src,drizzle,test,scripts}/
packages/{contracts,shared,utils,api-client}/
deploy/{deploy.sh,rollback.sh,docker-compose.prod.yml,nginx,.env.production.example}
scripts/{release.mjs,backup-db.sh,test-deploy.sh,test-deploy-linux.sh,test-container.sh,fixtures}/
e2e/platform.spec.ts
docs/  需求、计划、架构、数据库、API、来源、多端、CI/CD、部署、测试、设计及本报告
.github/workflows/{ci.yml,release.yml}
api/api-unavailable.mjs / docker-compose.yml / vercel.json / pnpm-lock.yaml
```

不创建 mobile/miniapp 空壳。编译输出、依赖、日志、测试报告和真实 env 被 Git 忽略。

## 3. 已实现功能

| 模块 | 实际行为                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 用户 | 注册、登录、退出、资料/头像 URL、目标设置、密码修改、角色与禁用、设备会话撤销、Refresh 轮换/重放撤销       |
| 题库 | 多级分类、单选/多选/判断、顺序/随机/章节/专项/真题筛选、服务端判分、解析、用时、收藏、笔记、答题历史       |
| 错题 | 自动收录、按分类/科目/更新时间查询、次数/时间排序、重做、掌握标记、用户隔离                                |
| 考试 | 自定义数量/时长/分值、题目快照、答题卡、答案暂存、数据库截止时间、定时/懒结算、并发幂等交卷、成绩/科目报告 |
| 统计 | 真实答题和考试事实、正确率、学习时长、连续天数、每日/科目、错题量与历史成绩图表、学习计划                  |
| 岗位 | 组合过滤、分页/排序、详情、来源/状态、收藏、对比、历史版本、条件三态匹配、站内截止提醒                     |
| 公告 | 类型/地区/考试/关键词过滤、详情、收藏、原文及附件链接                                                      |
| 后台 | 用户角色/状态，题目/分类/岗位/公告/来源维护，JSON/CSV/XLSX 导入导出，去重与事务、错误 CSV、操作审计        |
| 安全 | scrypt、DB 会话、后端权限、参数化 SQL、Origin/CSRF/CORS、请求体限制、限流、日志脱敏、安全头、生产配置检查  |

所有核心页面接入真实 API。种子含 12 道原创演示题、3 个虚构岗位和 1 篇使用指南；随后本地验收产生带 E2E 标记的测试内容。未导入未经授权的题库或伪造正式招录信息。

## 4. 未实现与明确限制

| 项目               | 当前边界 / 后续工作                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 真实数据与专业目录 | 仅演示种子和样本目录；需合法数据源、完整年度目录及核验流程。适配器接口和手动导入已实现，无自动抓取服务                                            |
| 编辑体验           | 管理端为严格校验的 JSON 编辑器，标签维护在 tags 数组；没有所见即所得编辑器和独立标签字典                                                          |
| 富文本与媒体       | 支持段落、标题、引用、加粗、斜体、代码的安全 Markdown 子集和题目图片 URL；不执行任意 HTML，无文件存储/图片上传服务                                |
| API 契约覆盖       | OpenAPI 可生成 TS paths/components，Axios 类型化适配和统计页已使用。部分考试/后台/导入响应仍为通用 envelope；不是全量响应校验或全端自动生成 SDK   |
| 多端               | 仅架构和 Bearer 后端能力，未实现 App/小程序 UI、微信登录、推送、订阅消息                                                                          |
| 通知               | 站内截止提醒；没有短信/邮件/系统推送                                                                                                              |
| 性能与运营         | 单进程限流、同步小批量 Excel 解析、实时聚合与随机查询。大题库/大导入需要队列、隔离解析、Redis/预聚合和压测；暂无容量承诺                          |
| 知识点             | 当前薄弱分析按科目，分类可多级；没有独立知识图谱或算法推荐                                                                                        |
| 数据生命周期       | 未实现自助账户注销、隐私政策确认页、个人数据导出和保留周期任务；需运营者制定政策后补充                                                            |
| 生产验收           | Vercel 手动生产发布 READY，入口/路由/资源/安全头及 GET/POST 503 JSON 已验收；本次 Actions、同 Release SHA、正式域名切换及生产 API/登录/恢复待验收 |

前端设计使用 frontend-design 和 ui-ux-pro-max 的阅读优先、响应式与可访问性规则：纸白/深青、清晰数据标记、可见表单标签、键盘焦点、减少动效和图表表格替代。技能搜索脚本不可用，未声称使用了检索结果。

## 5. 数据库

24 张表：users、user_profiles、auth_sessions、question_categories、questions、question_options、user_question_states、practice_sessions、practice_answers、exam_papers、exam_paper_questions、exam_attempts、exam_answers、jobs、job_versions、job_favorites、announcements、announcement_favorites、content_sources、import_jobs、audit_logs、major_catalog、study_plans、reminders。

UUID 主键、created_at/updated_at、外键、业务唯一键与查询索引。答题幂等键唯一、收藏状态唯一、考试答案唯一、岗位代码/年份唯一。题目停用保留历史；考试题目和答案快照不被题库修改覆盖。结构真源为 `apps/api/src/db/schema.ts`，初始化迁移 `apps/api/drizzle/0000_orange_kabuki.sql`。

## 6. API 清单

统一前缀 `/api/v1`，成功 `{data,meta?}`，错误 `{error,requestId}`；分页 page/pageSize（上限100）。下载接口返回对应文件。

| 区域      | 接口                                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 认证      | POST /auth/register、/login、/refresh、/logout；GET /auth/me                                                                                                                                 |
| 用户      | GET/PATCH /users/me；PATCH /users/me/password；GET /users/me/sessions；DELETE /users/me/sessions/:id                                                                                         |
| 题库      | GET /question-categories、/questions、/questions/:id、/questions/:id/history；POST /practice-sessions、/questions/:id/answer；PATCH /questions/:id/note；POST/DELETE /questions/:id/favorite |
| 错题      | GET /wrong-questions；POST /wrong-questions/:id/retry；PATCH /wrong-questions/:id/mastered                                                                                                   |
| 考试      | GET/POST /exams；GET /exams/:id、/exams/:id/result；PATCH /exams/:id/answers；POST /exams/:id/submit                                                                                         |
| 统计/计划 | GET /statistics/overview、/daily、/subjects、/recent；GET/POST /study-plans；PATCH/DELETE /study-plans/:id                                                                                   |
| 岗位      | GET /jobs、/jobs/favorites、/jobs/:id、/jobs/:id/history；POST /jobs/match；POST/DELETE /jobs/:id/favorite；GET /major-catalog                                                               |
| 公告/提醒 | GET /announcements、/announcements/:id、/reminders；POST/DELETE /announcements/:id/favorite；PATCH /reminders/:id                                                                            |
| 后台      | /admin/overview、/users、/questions、/categories、/jobs、/announcements、/sources、/imports、/audit-logs；/admin/imports/:id/errors；/admin/exports/:kind                                    |
| 基础      | GET /health、/ready（无 v1 前缀）；GET /api/v1/openapi.json                                                                                                                                  |

完整源码与契约见 API_SPEC 和生成 OpenAPI。后台路径由服务端统一 requireAdmin 阻断。

## 7. 前端页面

Dashboard；登录/注册；刷题中心（章节、专项、顺序、随机、真题筛选）；练习题目；错题；收藏题目；模考列表、考试、成绩报告；统计；岗位查询、详情、收藏、对比、匹配；公告列表/详情/收藏筛选；个人资料、学习计划、密码、会话与提醒；后台总览、用户、题库、分类、岗位、公告、来源、导入导出、审计；404。

页面按路由懒加载，包含加载/空/失败状态；登录及后台路由保护仅用于体验，权限仍由 API 实施。

## 8. 测试结果

TypeScript、Lint、前后端构建通过；9 项单元/组件、13 项真实数据库集成、2 条完整浏览器闭环、10 个隔离 Linux 部署场景通过，2026-11-02 已全部复验且云端 CI 全绿。首次云端 E2E 的笔记保存竞态已修复并重新通过。截图已检查桌面/手机布局。详细命令、先前失败与证据边界见 TESTING.md。未做大规模压测和独立安全审计。

## 9. Docker 构建

本地 linux/amd64 镜像构建成功，名称 `zhian-study-api:local`。最终生产依赖部署使用冻结锁文件和离线 pnpm deploy，含 Node22、API、Drizzle 迁移，不含 `.env`、TypeScript 开发依赖。用户 node/UID1000。已实际运行只读文件系统、cap-drop、no-new-privileges、数据库迁移、/health、/ready、分类查询；临时容器自动停止。

本地未验证 arm64 运行，Actions 已完成 linux/amd64 与 linux/arm64 镜像构建发布及 manifest 校验；manifest digest 和访问边界见 [CI/CD](CICD.md)。

## 10–13. Vercel / Actions / Semantic Release / GHCR

根 `vercel.json`：Vite、冻结 pnpm 安装、`@zhian/web` 构建和 `apps/web/dist` 输出，项目 Root Directory 为仓库根目录，Node 22.x，根 `engines.node` 限定 `>=20.19 <23`；保留 SPA fallback、安全头和静态缓存。`/api/*` 优先 rewrite 至 `api/api-unavailable.mjs`，所有 HTTP 方法返回 503 JSON，避免 POST 被 SPA 返回 HTML。`VITE_API_BASE_URL` 构建时显式注入，真实 HTTPS API 请求直接访问后端。

精确锁定 CLI 65.10.0，`git.deploymentEnabled=false`。GitHub 配置 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` Secrets，前端 job 检出与镜像相同的 Release SHA，pull 生产设置、build --prod，再 deploy --prebuilt --prod --json；校验 JSON 状态 READY/production/HTTPS URL 后保存部署 URL、版本和 SHA 收据。`.vercel` 环境文件及产物不提交或进入 Docker 上下文。本次手动发布已验收，当前 Actions 与同 Release SHA 发布仍待验收；详细步骤见 [CI/CD](CICD.md)。

迁移前历史：Netlify API 确认 Actions 的 v1.0.0 部署 `6ae8046280c64206131c6cbd` 为 `production` / `ready`；[历史永久地址](https://6ae8046280c64206131c6cbd--zhian-study.netlify.app) 的 `/login` 返回 200 且 CSP 正确，GET `/api/v1/users/me` 和 POST `/api/v1/auth/login` 均返回 503 JSON。这些证据不代表 Vercel 已发布。

`ci.yml`：PR 和相关分支推送执行安装、契约漂移检查、类型/Lint/单元/数据库、构建、浏览器和部署模拟测试。CI 和 Release verify 均复用 `.github/actions/verify-container` 构建真实 API 镜像，连接独立测试库，验证非 root、生产依赖、迁移、只读文件系统、就绪和 API 查询。`release.yml`：resolve → verify → version → frontend/image 并行，needs/outputs 传递 tag/version/sha；完整历史；main 发生漂移时拒绝发布未经验证的提交；手动只接受已有正式 Release tag；Vercel 发布必须选择含迁移配置的版本，迁移前 v1.0.0 不适用。

`.releaserc.json` + `scripts/release.mjs`：feat 次版本、fix/perf 补丁、BREAKING CHANGE 主版本、docs/chore/test/ci 默认不发布。自动 Git tag/GitHub Release 在同一工作流产生，不依赖 token-created-tag 二次触发。

已发布镜像：`ghcr.io/amazingz-sys/zhian-study-api:v1.0.0`，manifest 包含 linux/amd64 与 linux/arm64，摘要 `sha256:27804750fb7a7369ad3f55406489b80ad0ff7c7f756e24961757f8b40f28d8c8`。工作流配置正式版本、latest 和 sha 标签，手动恢复历史版本不移动 latest。Buildx/QEMU、缓存、OCI labels、SBOM/provenance 和 manifest 校验已执行；匿名 manifest 读取已验证，完整镜像匿名 pull 尚未执行，访问边界见 [CI/CD](CICD.md)。

## 14–15. 服务器脚本与 Nginx

`deploy/deploy.sh vX.Y.Z`：版本/权限/env/依赖检查→flock→Nginx 预检→拉取并解析摘要→容器迁移→替换→HTTP /ready→nginx -t→systemctl reload→成功快照和历史。迁移失败保留旧 API；切换后失败恢复旧摘要、Compose、env，再做就绪检查。首次失败停止故障容器。日志和快照权限受限，不输出生产密钥。

`rollback.sh [vX.Y.Z]`：仅从已保存成功快照回滚，要求 `CONFIRM_DB_COMPATIBLE=yes`；目标摘要和历史配置一起恢复，不执行数据库迁移。单实例替换会有短暂中断，不宣称零停机。

宿主机 Nginx 模板提供 HTTPS、HTTP 重定向、转发头、请求体/超时限制和 WebSocket 预留；API 仅绑定127.0.0.1。TLS 证书/域名必须由实际服务器配置。

## 16–17. 必需配置

| 位置             | 配置                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API 生产 env     | IMAGE_REPO、DATABASE_URL、随机 JWT_SECRET、HTTPS CORS_ORIGINS、COOKIE_SECURE=true、COOKIE_SAME_SITE、NODE_ENV=production、PORT=3000 |
| 反向代理         | TRUSTED_PROXY_IPS 为 API 实际观察到的 Nginx socket IP，只信任明确地址；Nginx 覆写 X-Real-IP                                         |
| Web 构建         | VITE_API_BASE_URL，如 https://api.example.com/api/v1                                                                                |
| GitHub Secrets   | VERCEL_TOKEN、VERCEL_ORG_ID、VERCEL_PROJECT_ID                                                                                      |
| GitHub Variables | VITE_API_BASE_URL                                                                                                                   |
| GitHub 自带      | GITHUB_TOKEN（contents/package 最小权限，无全权限 PAT）                                                                             |
| 服务器           | GHCR 只读凭据、数据库 TLS/备份、DNS、证书、Nginx、生产 env（root:600）                                                              |

Vercel 项目已设置为仓库根目录、Node 22.x。经用户授权，已创建仅用于 `zhian-study` 项目的专用 Token，有效期至 2027-11-03，并将 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID` 配置为 GitHub Secrets；专用 Token 的 pull 与预构建生产部署已实际通过，本地 Token 中转已删除；凭据本身不写入工程或文档。本次手动生产部署已完成并验收静态 HTTP；凭据的实际 Actions 使用、required CI checks 与 production Environment 策略需继续验收。正式域名 `zhian.amazingzsys.site` 仍由 Netlify 提供服务，DNS 切换由用户最后执行；API 的 HTTPS 当前不可达，因此继续使用公开构建变量 `VITE_API_BASE_URL=/api/v1`。生产 API、完整注册登录与业务写入尚未验收。切换时由用户使用本项目 Domains 提示的目标。

## 18. 首次部署

1. 确认真实内容授权/核验、专业目录与生产数据政策；完成本报告列明的生产强化。
2. 实际 Vercel 项目、GitHub Secrets 与手动生产部署已完成；后续发布包含迁移改动的新版本，验证 Actions 和同 Release SHA 收据。由用户按项目 Domains 提示切换正式域名 DNS，迁移前 v1.0.0 与镜像的历史证据见 CI/CD。
3. 配置独立 PostgreSQL、加密异地备份与恢复演练；准备 Linux Docker/Compose、宿主机 Nginx、curl、bash、flock、systemd、GNU coreutils。
4. 安装 deploy 到受限目录，配置 env（root:600）、GHCR 只读登录、域名和 TLS，核对 CORS/代理 IP。
5. `sudo ./deploy.sh v1.0.0`，验证 HTTPS API、浏览器跨域会话、数据隔离和正常使用。

## 19. 日常更新

Conventional Commit → PR/CI → main → 自动 Release 和两路部署。服务器备份并检查迁移兼容性后执行 `sudo ./deploy.sh v1.0.1`，保留历史镜像与快照。服务器不编译代码。

## 20. 回滚

检查目标应用与已迁移数据库兼容后：`sudo env CONFIRM_DB_COMPATIBLE=yes ./rollback.sh`，或附加已部署版本 `v1.0.0`。数据库恢复独立执行，优先恢复到新库验证，不自动降级/清库。

## 21. App / 小程序

建议先评估 uni-app + Vue3/TS，共享契约/业务规则，另建平台 UI；Taro 作为 React 生态替代。Axios 不能直接等同微信传输适配，需用同一生成契约实现 uni.request/wx.request；令牌使用平台安全存储，复用会话轮换和撤销。再接设备令牌、推送/订阅消息、隐私协议、离线同步。当前不虚构移动端已完成。
