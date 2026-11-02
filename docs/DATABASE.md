# 数据库设计

PostgreSQL + Drizzle；模型为 apps/api/src/db/schema.ts，迁移由 drizzle-kit generate 生成并由 migrate 执行。禁止生产使用 push。

## 表与关系

users → user_profiles (1:1)、auth_sessions、practice_sessions、practice_answers、user_question_states、exam_attempts、收藏。
question_categories 自引用父分类；questions → question_options (1:N)，题目来源指向 content_sources。
practice_answers 引用用户、题目、练习会话，唯一 user/requestId；user_question_states 唯一 user/question，保存收藏、错题次数、笔记、掌握。
exam_papers → exam_paper_questions（题目与答案快照）；exam_attempts 引用 paper/user；exam_answers 唯一 attempt/question。
jobs / announcements → content_sources；job_favorites / announcement_favorites 唯一 user/content。
import_jobs 保存类型、状态、行数、错误明细；audit_logs 追加写；job_versions 保存岗位变更；major_catalog 保存目录编码/类别/别名；study_plans 保存学习目标；reminders 保存站内提醒。

## 约束与索引

所有实体 UUID 主键；created_at/updated_at；用户邮箱唯一、岗位职位代码与年份组合唯一、分类名唯一；历史学习关联保留（软停用内容）。users FK 仅在明确删除账户时级联；内容不能破坏历史快照。索引按 user+created_at、category、province/year、status、deadline 等访问模式设置。分页默认 20、最高 100。

## 迁移与恢复

迁移使用 advisory lock 避免并发。发布仅允许新增字段/表/兼容索引，删除字段另一个发布周期执行。备份 pg_dump -Fc，恢复到新数据库 pg_restore 并测试后切换 DATABASE_URL。应用回滚不等于数据库回滚。

## 数据保留

不提供未确认的自动删除政策。生产运营者应确认个人数据导出、删除、审计保留、加密备份和异地存储策略。
