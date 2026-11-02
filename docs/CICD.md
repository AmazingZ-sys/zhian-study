# CI/CD

2026-11-02 状态：类型、Lint、单元 9 项、集成 13 项、E2E 2 条、构建、容器和部署模拟 10 场景已本地复验通过；首次代码推送、GitHub Actions 执行、正式 Release 和 GHCR 发布尚待云端验证。Netlify 站点 https://zhian-study.netlify.app 已创建，首次生产上传正在进行。

## 提交与发布

feat→MINOR；fix/perf→PATCH；BREAKING CHANGE→MAJOR；docs/chore/test/ci 默认不发版本。main 为生产分支；首次无 tag 由 Semantic Release 计算版本。完整 git 历史，tagFormat=v${version}。

## CI

PR 和 main push：冻结锁文件安装、typecheck、ESLint、单元/API 集成测试、Vue/API 构建、Playwright、部署故障模拟及 API 容器冒烟；PostgreSQL service。CI 和 Release 的 verify 阶段复用 `.github/actions/verify-container`，构建实际 Docker 镜像，通过独立网络连接测试库，检查非 root、生产依赖、迁移、只读文件系统、数据库就绪和 API 读取。仓库管理员需在 branch protection 设置 CI 为 required，配置文件本身不能强制阻止合并。

## 发布依赖链

verify → version（semantic-release JS API 输出 released/version/tag/sha）→ frontend 与 image 并行。只有产生新版本才部署；不依赖 GITHUB_TOKEN 创建 tag 再触发工作流。
workflow_dispatch 输入已存在 vX.Y.Z，校验正式 GitHub Release 和 tag，检出对应源代码，不运行版本升级、不覆盖 Release；重部署旧版本不得把 latest 倒退。

## 权限

最小 contents:read，version job contents:write，image packages:write。用 GITHUB_TOKEN，不用全权限 PAT。production Environment 可配置审批（会阻塞无人值守部署）。

## 配置

Secrets NETLIFY_AUTH_TOKEN；Variables NETLIFY_SITE_ID、VITE_API_BASE_URL。GHCR 为 ghcr.io/amazingz-sys/zhian-study-api。首次前端上传使用已登录的本地 Netlify CLI，后续由 Actions 用 CLI 发布并保留日志；Netlify 必须关闭 Git 自动发布。

用户暂无服务器，本次发布范围为前端与 GHCR 镜像，不执行服务器部署。`VITE_API_BASE_URL` 暂设 `/api/v1`；Netlify `/api/*` 返回 API 未部署的 404 JSON。取得真实 HTTPS API 后修改该变量并重新构建，同时配置 API 的 CORS/Cookie。

## 故障恢复

Release 成功但某部署失败：查看相应日志，修正环境，workflow_dispatch 原 tag；不需要制造 feat 提交。镜像版本标签与 sha 可追踪；生产使用明确版本。若历史版本重建，记录 digest 变化，建议运营环境按 digest 锁定。

## 待真实验证

GitHub checks、正式 tag/Release、Netlify 首次生产上传结果、GHCR push 与多架构拉取仍待真实结果，本地配置检查不能代替云端运行证据。暂无服务器，因此宿主机 Nginx/HTTPS 和远端容器部署不在此次验证范围。
