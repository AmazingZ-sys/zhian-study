# 系统架构

## 边界

apps/web 仅 UI，apps/api 为唯一业务与权限入口。packages/contracts 以 Zod 定义输入和数据类型；shared 为跨端业务规则；api-client 为 Axios 客户端；utils 提供纯函数。

## 请求链

Vue Router 权限引导 → Axios credentials → Hono 安全头/CORS/来源校验/限流/请求 ID → 会话与用户校验 → Zod → 业务事务 → Drizzle → PostgreSQL。

## 安全

密码 scrypt 盐化哈希；短期 access JWT 绑定数据库会话；refresh 随机高熵令牌只存 SHA256，轮换时锁定会话，旧 token 重放撤销会话。Web Cookie HttpOnly/Secure，写请求校验 Origin；Bearer 无 Cookie 时独立使用。角色、状态每次查询数据库。业务内容使用安全 Markdown 子集并生成文本节点，不执行 HTML；图片/链接只允许 http(s)。请求体限制、分页上限、不记录密码与 token。

## 一致性

答题与状态更新事务；幂等键防重复统计。试卷题目快照防后台编辑改变既有考试；提交锁定 attempt，按数据库时间判定。收藏唯一约束，幂等增删。导入先全量校验、再一事务写入并记录审计。

## 刷题模块

练习分类沿用 `question_categories.parent_id`。API 按当前用户聚合启用题目的练习记录，Web 目录和工作台按父子关系汇总进度。题目范围保存在 URL 中，由列表、单题续练和返回导航共享。范围和兼容规则见 [刷题模块重构方案](PRACTICE_REFACTOR.md)。

## AI 网关

浏览器通过已有会话访问 AI 接口。API 检查作答归属、统计范围和管理员角色后，将必要输入发送给已配置的中转站。连接配置由管理员保存，密钥加密存储，网关故障只影响当前 AI 操作。配置和功能边界见 [AI 功能与中转站配置](AI_FEATURES.md)。

## 参考题库

`questions.external_key` 将源题映射为稳定学习实体；`source_papers` 与 `source_paper_questions` 另存原卷、顺序及原始行，不复用模拟考试快照。主观题按原卷提供材料，主动查看参考解析，不进入客观判分。离线转换器把 HTML 转为安全文本/图片，API 只从指定图片目录读取受限格式，原始 SQLite 不对外公开。导入事务、来源归属、摘要及幂等规则见 [题库迁移记录](QUESTION_BANK_MIGRATION.md)。

## 运行

API /health 进程存活，/ready 校验数据库。后台定时扫描截止考试，读写考试也触发惰性结算。SIGTERM 停止服务与连接池。生产单实例起步，水平扩容前将限流和任务调度迁往共享组件。

## 可观测

JSON 请求摘要只记录 method/path/status/duration/requestId；审计记 actor/action/object/result，禁止完整凭证或个人资料进入日志。
