# 参考题库迁移方案与执行记录

## 目标与边界

按用户 2026-11-16 的要求，将本地 `kaogong-shuati` 的实际题库迁入知岸，供个人部署及朋友使用。本文件先于本次迁移代码编写。先完成备份、转换、隔离库演练及本地导入，再核对数量、内容和使用闭环。参考仓库和既有用户、收藏、笔记、答题、考试记录均需保留；本次不操作远程生产环境。

前序刷题重构与可配置 AI 已实现，见 `PRACTICE_REFACTOR.md`、`AI_FEATURES.md`。题库迁移不覆盖这些改动。AI 仍由管理员配置模型、密钥、API 地址和中转站；题库的参考解析与 AI 生成解析分别展示。

## 源数据实测

- 本地源目录：`/Users/zhix/Downloads/kaogong/kaogong-shuati`，Git 版本 `12cf8e7`。
- 四个分片重组得到 `tiku.db`，318,738,432 字节，MD5 `efaa2274fc6aa9c385bc30842556b215`。以 SQLite immutable 只读连接读取，源目录不产生数据库或 WAL 文件。
- 2,455 套试卷，95,627 条试卷题目记录，按科目及源 questionId 去重共 55,721 题。公务员行测 45,253、事业编职测 4,681、公务员申论 3,439、事业编综应 2,348。
- 源题型 1/2/3/5 共 50,105 道去重客观题；其余 5,616 道保留为主观/阅读题。实际可计分数量由答案、选项完整性校验决定，不为缺失答案编造答案。
- `materials.db` 保存试卷材料；`tiku-index.db` 保存细分类及题目与材料关联。`questions.material` 中的 `[object Object]` 不能作为有效材料。图片位于 `public/tarzan-img`，公式可能仍使用源外链。

## 数据与兼容设计

1. `questions` 增加稳定外部键 `externalKey` 和题目材料 `material`，题型扩充 `subjective`。稳定 UUID 与外部键由源项目、科目、questionId 确定，不能用题干去重。跨试卷重复题仅建立一条学习实体，既有学习记录继续引用原 UUID。
2. 新增 `source_papers`（原试卷信息、材料及原始元数据）与 `source_paper_questions`（原试卷、学习题目、顺序及完整原始行）。全部 95,627 行原始内容均保存，去重展示的版本选择规则固定、可复现；不得丢弃同题在其他试卷中的内容差异。
3. 客观答案按源判分逻辑归一为 A–H：JSON/嵌套数组、多索引逗号串、单题 answerIndex 或数字；判断补“正确/错误”两个选项。没有可靠答案或选项不合法的题保留阅读，但不进入自动计分。
4. 主观题显示材料、题干、收藏、笔记和“查看参考解析”；查看解析不写正确/错误记录、不计入正确率。模拟考试只抽取客观题。普通详情、列表、试卷目录不得提前返回答案或原始含答案行。
   同一主观题可能在不同原卷中对应不同材料。按卷练习时，列表及详情根据 `paperId` 校验题目归属，保留同一学习题目 ID，并使用当前原卷的材料、来源名称与年份，避免显示首次去重卷的上下文；原卷缺少材料时保留题目索引材料。
5. 分类使用科目根节点及索引中的分类/子分类，缺少索引时使用章节。名称加科目前缀以兼容现有分类名唯一约束；不覆盖既有分类。
6. 保留来源、源版本、原题号、原试卷及材料。内容标记 `pending`，含义为未逐题人工核验，可供练习，不冒充官方核验数据。

## 内容、图片与安全展示

源 HTML 仅由离线转换器解析为安全文本及 Markdown 图片标记；不把源 HTML 交给 `v-html`。保留段落、换行、上下标文本、表格文本、图片和公式图片；脚本、事件及嵌入元素不执行。题干、选项、材料、解析使用同一安全组件展示。

已有图片复制到项目本地持久目录 `data/question-bank/assets`，以稳定、安全文件名映射到 `/api/v1/bank-assets/:name`。API 只提供允许的图片格式并验证路径边界。前端跨域部署时按 API origin 生成图片地址。无法在源图片目录匹配的 HTTP(S) 图片保留外链并记录在报告中，不声称完全离线可用。

原库快照、原始导出、图片、报告与本地数据库备份存放在忽略目录，不加入 Git 或镜像构建上下文。部署时显式搬运图片、数据库及来源记录，配置 `QUESTION_BANK_ASSET_DIR` 并挂载持久卷。

## 导入流程与恢复

1. 检查本地数据库连接，启动本地 PostgreSQL；导入前执行完整 `pg_dump` 备份，记录既有表数量。
2. 命令行导出器只读参考库，验证完整性和源摘要，生成稳定数据、图片、计数、内容异常及外链报告。失败必须终止，不截断题干或解析以迎合旧导入上限。
3. 新 schema 迁移后，专用 CLI 将导出包批量写入隔离测试库，使用事务和 advisory lock。写入仅限该来源稳定键；重复执行以 upsert 更新来源实体，不删除用户数据、现有题目或来源外记录。
4. 核对试卷、去重题目、全部原始行、材料、选项与计分题数量；再运行一次验证幂等。故意损坏输入需回滚，不能产生半套题库。
5. 本地开发库备份确认后执行同一导入。核对导入前后的既有用户记录、演示题和学习记录。
6. 检查真实题目的选择、判分、图形选项、资料题、主观材料、参考解析、收藏/笔记和试卷定位。执行类型检查、相关测试、lint、构建并更新 API 类型。

发生导入错误时事务自动回滚；schema 属于向后兼容新增字段/表。灾难恢复先停 API，再使用备份恢复到独立空库核对后切换连接，避免覆盖仍在使用的数据库。需要移除某来源时先备份并评估用户引用，不提供无条件清空题库操作。

## 验收与执行结果

2026-11-16 已完成本地迁移。源库、素材目录保持只读，未操作远程生产环境。

| 项目 | 导入数量 |
| --- | ---: |
| 去重题目 | 55,721 |
| 可计分题 | 50,087（单选 48,765、多选/不定项 1,104、判断 218） |
| 主观/阅读题 | 5,634 |
| 原试卷 | 2,455 |
| 完整原始试卷题目行 | 95,627 |
| 客观题选项 | 200,174 |
| 分类节点 | 193 |
| 本地图片 | 8,778（规范去重内容引用其中 8,770 张） |

18 道源客观题选项不完整，保守降级为阅读题，并将原选项保留在可见题干中；其余原主观/资料题 5,616 道。转换后的最大题干 1,523 字符、解析 7,310、选项 822、材料 11,480，均在现有编辑契约限额内，无内容截断。

数据包位于 `/Users/zhix/Downloads/zhian-study/data/question-bank`，包含 `manifest.json`、`report.json`、四份 JSONL、`assets/`、三份 SQLite 快照及上游 README/LICENSE。manifest 记录每份导入文件的字节数和 SHA-256；源 tiku SHA-256 为 `d95f557d297ee9099b293abcafb40d304c10ee3de5f098e6804ce95470b937b4`。

本地开发库 `127.0.0.1:5438/zhian` 现在共 **55,737 题**（原有 16 + 迁入 55,721）。导入前备份为 `.artifacts/question-bank/zhian-before-bank-20261116.dump`，已成功恢复到 `zhian_bank_test` 后演练。迁移后对原有 17 张业务表核对行数及内容摘要：8 个用户、16 道旧题、54 个旧选项、4 条练习答案、12 条用户题目状态、4 场考试及其他原有内容均保持一致。证据为 `.artifacts/question-bank/before-counts.tsv` 与 `after-original-counts.tsv`。

验证结果：

- 隔离库全量导入和重跑均与 manifest 数量一致；55,721 道题 ID 与 `updated_at` 摘要相同。
- 在第 300 条题目放入非法题干，摘要校验通过后触发记录校验失败，之前写入的批次全部回滚，版本摘要不变。
- `zhian_import_test` 的最小真实导入回归确认：相同包不改版本时间，仅选项变化会更新版本时间；最后阶段无效关联导致来源、分类、题目、选项、试卷全部回滚。脚本为 `apps/api/scripts/verify-question-bank-import.ts`，报告在 `.artifacts/question-bank/importer-regression/report.json`。
- 31 项单元/组件测试、18 项 PostgreSQL 集成、10 项 Python 转换测试、2 条 Chrome E2E、10 个部署脚本场景通过；类型、lint、前后端构建通过。
- 使用真实源题验证图形选项加载与判分、资料材料、主观参考解析不影响正确率、收藏与笔记、原卷题序、跨卷材料切换、下一题保留原卷，以及 375px 移动端布局。浏览器无页面异常，证据为 `.artifacts/question-bank/browser-report.json` 及截图。
- Chrome 验证独立前端 origin 可直接加载 API 图片；图片路由显式设置 `Cross-Origin-Resource-Policy: cross-origin`，其他接口保留默认策略，报告为 `.artifacts/question-bank/cross-origin-image-report.json`。
- 当前 API 构建及图片目录只读挂载到已有 `zhian-study-api:local` 镜像，非 root、只读文件系统下验证健康检查、数据库就绪、2,455 卷目录、答案隐藏、图片与跨域头；编译后的 schema 迁移和导入器均执行成功。报告为 `.artifacts/question-bank/container-report.json`。完整 Dockerfile 镜像重建因外部依赖下载长期缓慢而取消，未将缓存运行验证描述为完整镜像构建通过；生产发布前仍需完成新镜像构建与标准镜像冒烟。

## 可复现命令

首次导出（已重组的 SQLite 路径需在参考项目之外）：

```bash
pnpm bank:export \
  --source /Users/zhix/Downloads/kaogong/kaogong-shuati \
  --tiku /path/to/reassembled/tiku.db \
  --output data/question-bank
```

本次已生成包，可直接备份、迁移 schema 后重复导入，无需再次导出：

```bash
DATABASE_URL=postgresql://zhian:local-development-only@localhost:5438/zhian pnpm db:migrate
DATABASE_URL=postgresql://zhian:local-development-only@localhost:5438/zhian \
  pnpm bank:import --input /Users/zhix/Downloads/zhian-study/data/question-bank
pnpm bank:test
pnpm dev
```

入口：刷题中心的“原卷题库”，或 `/question-papers`；按科目、关键词查卷后可按卷练习。管理员 AI 入口为 `/admin/ai`。

独立导入器回归只允许专用 `zhian_import_test` 库，先建库并迁移，再执行：

```bash
QUESTION_BANK_REGRESSION_DATABASE_URL=postgresql://zhian:local-development-only@localhost:5438/zhian_import_test \
  pnpm --filter @zhian/api exec tsx scripts/verify-question-bank-import.ts
```

## 部署与已知内容限制

镜像包含 `dist/import-question-bank.js`，可以将私有导出包只读挂载后用 Node 执行导入。部署前先备份目标库并执行 schema 迁移；本次没有代替用户执行生产导入。图片不包含在 Git、前端产物或 API 镜像中，需单独持久保存；可使用 `deploy/docker-compose.bank.yml` 叠加生产 Compose，并设置 `QUESTION_BANK_HOST_ASSET_DIR` 为宿主机图片绝对目录，该覆盖文件会将图片只读挂载并设置 `QUESTION_BANK_ASSET_DIR`。

源数据缺少 864 个被引用图片文件名的缓存，部分公式图也仅有外链；这些保留 HTTP(S) 地址，无法保证离线或上游失效后的展示。源库中 3,523 题含 `[materialid]...[/materialid]` 标记，源材料库没有足够字段可靠映射到“材料1”等编号；保留原标记并提供该卷完整材料，未猜测替换。资料表还有一份材料所属试卷不在当前题库，原始 SQLite 快照完整保留它。

AI 文本解析会包含题目材料；对含图/公式图片的题目明确提示暂不可用，避免文本模型遗漏图像。题库导入内容仍可正常阅读原解析。
