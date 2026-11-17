# API 规范

## 通则

/api/v1；成功 { data, meta? }，错误 { error: { code, message, details? }, requestId }。分页 page/pageSize，meta 含 total/page/pageSize。日期 ISO8601，UUID 路径参数。400 校验、401 未登录、403 禁止、404 缺失、409 冲突、429 限流、500 内部错误（脱敏）。

## 端点

认证 POST /auth/register /auth/login /auth/refresh /auth/logout；GET /auth/me。
用户 GET/PATCH /users/me，PATCH /users/me/password，GET /users/me/sessions，DELETE /users/me/sessions/:id。
题库 GET /questions /questions/:id /question-categories /question-categories/progress；POST /questions/:id/answer；POST/DELETE /questions/:id/favorite；PATCH /questions/:id/note；GET /questions/:id/history /questions/:id/solution /question-papers /question-papers/:id。
错题 GET /wrong-questions；POST /wrong-questions/:id/retry；PATCH /wrong-questions/:id/mastered。
考试 GET/POST /exams；GET /exams/:id；PATCH /exams/:id/answers；POST /exams/:id/submit；GET /exams/:id/result。
统计 GET /statistics/overview /statistics/daily /statistics/subjects。
AI `GET /ai/status`，`POST /ai/question-explanation`、`/ai/study-advice`、`/ai/question-drafts`，`GET/PATCH /ai/settings`，`POST /ai/settings/test`。
岗位 GET /jobs /jobs/favorites /jobs/:id /jobs/:id/history；POST/DELETE /jobs/:id/favorite；POST /jobs/match；GET /major-catalog。
公告 GET /announcements /announcements/:id；POST/DELETE /announcements/:id/favorite。
管理 /admin/users /admin/questions /admin/categories /admin/jobs /admin/announcements /admin/imports /admin/sources /admin/audit-logs。
学习计划 GET/POST /study-plans，PATCH/DELETE /study-plans/:id；提醒 GET /reminders。

## 公开性

公开仅返回启用/已发布内容和安全字段；未答题不返回 correctAnswer/explanation。用户数据和考试必须 ownership 校验；所有管理端点服务端 role=admin。

## 契约维护

Zod 输入为运行时验证来源，OpenAPI 暴露 /api/v1/openapi.json；客户端共享输入类型。自动生成覆盖与手写业务封装的边界应在交付报告中明确，不能将宽泛 object 文档称作完整生成契约。

执行 `pnpm api:generate` 生成 `docs/generated/openapi.json` 和 `packages/api-client/src/generated.ts`（openapi-typescript）；CI 重新生成并检查漂移。Axios `createTypedClient` 提供生成契约约束的请求，统计页实际采用。认证、用户、题库、岗位、公告、统计及计划已定义具体响应；部分考试/后台/导入仍使用通用 envelope，仍需补强响应类型和文件 schema。运行时所有业务输入仍由 Zod 校验，生成类型不会取代后端校验。

## 使用细节

- Web 注册/登录发送 `{email,password,client:'web'}` 和合法 Origin。Access/Refresh 均为 HttpOnly Cookie。刷新使用 Cookie，可不带 JSON。
- 移动端登录发送 `client:'mobile'`，返回 accessToken/refreshToken/expiresIn；后续 Authorization: Bearer。刷新传 `{client:'mobile',refreshToken}`；即使 access 已过期，退出也可用该请求体撤销会话。
- 答题 `{answer:['A'],seconds:15,requestId:'UUID'}`，同用户同 requestId 幂等；一个键不能用于另一题。解析与正确答案只在提交后和自己的历史中返回。
- 已登录用户可通过 `GET /question-categories/progress` 读取扁平分类和个人进度，响应为 `{ data }`。每行的 `count` 是直接挂在该分类下的启用题数，`attempted`、`attempts`、`correctAttempts` 分别是其中练习过的去重题数、练习作答数和答对数。分类树汇总各级计数后再计算正确率。
- 题目和错题列表默认精确匹配 `categoryId`。用 `includeDescendants=true` 同时匹配该分类及其全部下级。
- 连续练习 `GET /questions?mode=sequential&after=<当前题ID>&pageSize=1` 使用数据库元组游标；random 排除当前题。分类/年份/关键词条件应继续传入。
- 错题续练使用 `mode=wrong`。和 `/wrong-questions` 一样，支持 `mastered=true|false`（默认 `false`）以及 `since`（ISO8601 更新时间下限）。续练按题目的稳定顺序推进，列表可按错题次数或最近更新排序。
- 考试以 API 返回 serverNow/deadline 为准；定时扫描每15秒补结算，读取考试/统计也会结算过期记录。提交后答案不可修改。
- 导入 JSON 为 `{kind:'questions'|'jobs'|'announcements',rows:[...]}`；multipart 为 kind 与 file，文件最大2MB、最多1000行。结构化 CSV/Excel 单元格（options/correctAnswer/tags/majorCodes/attachments）使用 JSON 字符串。
- 导出 `GET /admin/exports/:kind?format=json|csv|xlsx&page=1&pageSize=100` 每次只导出一页；导出全库需循环分页。JSON 下载为数组，不使用 data envelope。
- 富文本是安全 Markdown 子集：段落、标题、引用、强调、行内代码与图片；HTML 原样显示，不执行。图片只接受 HTTP(S) 或受限 `/api/v1/bank-assets/:name`，API 只提供指定本地目录内的 PNG/JPEG/GIF/WebP/BMP/AVIF，不提供通用文件读取或上传。
- `questions.material` 是安全材料文本，选项也可含 Markdown 图片。题型 `subjective` 的 options/correctAnswer 为空；登录后主动 `GET /questions/:id/solution` 获取 `{data:{explanation}}`，不会写入答题记录，提交主观答案返回 400。模考抽题排除 subjective。
- `GET /question-papers` 支持 q、subject、page/pageSize。`GET /question-papers/:id` 返回公开卷信息、材料和按 position（从 1 开始）排序的分页题目。两个接口均不返回原始 raw、外部键或答案。
- `GET /questions?paperId=<原卷ID>` 按原卷顺序练习，可与 after、分类、关键词组合。`GET /questions/:id?paperId=<原卷ID>` 验证归属并显示该卷来源、年份与主观材料，共享原题学习 ID；不属于该卷返回 404。

## AI 接口

- 登录后查询 `GET /ai/status`，返回 `{ data: { enabled } }`。
- `POST /ai/question-explanation` 接收 `{ questionId, answerId }` 并返回 `{ data: { text } }`。服务端核对题目和当前用户的作答。题目更新后需重新作答，含图片的题目暂不支持。
- `POST /ai/study-advice` 无需请求体，返回 `{ data: { text } }`。只使用近期科目和每日作答统计。缺少近 30 天记录时返回 409。
- 管理员使用 `POST /ai/question-drafts` 提交 `{ categoryId, sourceLabel, text }`，原文最多 12000 字符。返回 `{ data }`，其中包含零到五条合法题目草稿，统一标为 `pending` 且 `enabled=false`。经审阅后可通过现有导入接口提交。
- 管理员读取或更新 `/ai/settings`。响应包含 `enabled`、`baseUrl`、`model`、`tokenLimitField`、`hasApiKey` 和 `source`。更新请求可以省略 `apiKey` 来沿用同网关密钥，或传 `null` 清除。更换网关需使用其对应密钥。`POST /ai/settings/test` 测试已保存配置，成功时返回 `{ data: { ok: true } }`。
- AI 生成请求沿用标准错误结构。429 表示频率或并发达到上限，502 表示网关请求失败或返回无效结果，503 表示 AI 配置不可用，504 表示上游超时。
