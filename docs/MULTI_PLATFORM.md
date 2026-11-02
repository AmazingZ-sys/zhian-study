# 多端方案

## 推荐

未来优先 uni-app + Vue3 + TypeScript：团队可复用 Vue 知识、API 数据模型与校验；原生能力、审核和平台差异仍需各端测试。Taro 对 React 团队有优势，但当前 Vue UI 不值得为迁移付额外成本。

## 共享与独立

共享 contracts/shared/utils 和客户端协议；Element Plus、DOM、Router UI、ECharts Web 封装留在 web。App 可注入安全存储与 transport，小程序使用 uni.request 或 wx.request 适配器，不强依赖浏览器 Cookie。

## 认证

Web HttpOnly Cookie；移动端登录 client=mobile 返回 access/refresh，access 放内存、refresh 放系统安全存储，禁止日志记录。统一会话支持设备名称、轮换、撤销与多设备登录。

## 预留

reminders 站内消息可扩展 delivery channels；会话存设备描述；未来增加 push subscriptions、微信订阅授权、离线题包和同步冲突协议。不创建空壳 mobile/miniapp 应用。
