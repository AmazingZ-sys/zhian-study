# API 规范

## 通则

/api/v1；成功 { data, meta? }，错误 { error: { code, message, details? }, requestId }。分页 page/pageSize，meta 含 total/page/pageSize。日期 ISO8601，UUID 路径参数。400 校验、401 未登录、403 禁止、404 缺失、409 冲突、429 限流、500 内部错误（脱敏）。

## 端点

认证 POST /auth/register /auth/login /auth/refresh /auth/logout；GET /auth/me。
用户 GET/PATCH /users/me，PATCH /users/me/password，GET /users/me/sessions，DELETE /users/me/sessions/:id。
题库 GET /questions /questions/:id /question-categories；POST /questions/:id/answer；POST/DELETE /questions/:id/favorite；PATCH /questions/:id/note；GET /questions/:id/history。
错题 GET /wrong-questions；POST /wrong-questions/:id/retry；PATCH /wrong-questions/:id/mastered。
考试 GET/POST /exams；GET /exams/:id；PATCH /exams/:id/answers；POST /exams/:id/submit；GET /exams/:id/result。
统计 GET /statistics/overview /statistics/daily /statistics/subjects。
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
- 连续练习 `GET /questions?mode=sequential&after=<当前题ID>&pageSize=1` 使用数据库元组游标；random 排除当前题。分类/年份/关键词条件应继续传入。
- 考试以 API 返回 serverNow/deadline 为准；定时扫描每15秒补结算，读取考试/统计也会结算过期记录。提交后答案不可修改。
- 导入 JSON 为 `{kind:'questions'|'jobs'|'announcements',rows:[...]}`；multipart 为 kind 与 file，文件最大2MB、最多1000行。结构化 CSV/Excel 单元格（options/correctAnswer/tags/majorCodes/attachments）使用 JSON 字符串。
- 导出 `GET /admin/exports/:kind?format=json|csv|xlsx&page=1&pageSize=100` 每次只导出一页；导出全库需循环分页。JSON 下载为数组，不使用 data envelope。
- 富文本是安全 Markdown 子集：段落、标题、引用、强调、行内代码；HTML 原样显示，不执行。图片为 HTTP(S) URL 字段，无文件上传存储服务。
