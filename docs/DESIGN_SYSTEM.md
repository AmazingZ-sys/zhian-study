# 知岸视觉与交互规范

## 方向

克制、编辑式学习工作台：纸白 #f6f7f4，墨色 #203b37，主青 #176b5b，柔绿 #e8f2eb，暖金 #b68442。标题使用本地中文宋体回退，正文使用 PingFang SC/Noto Sans SC；数字 tabular-nums。

## 布局

桌面 232px 左侧导航，主内容最大 1280px；页面说明/主行动/内容三级层次。移动 768px 以下折叠侧栏为横向导航；375px 无页面横向溢出。4/8px 间距体系、12px 圆角、轻边线，避免装饰性大渐变。

## 组件

Element Plus 表单/对话框/消息，Lucide 统一线性图标；按钮最小 44px。每个输入可见标签、错误可恢复。删除/退出考试需确认。图表提供文本表格备选。

## 状态与无障碍

loading/error/empty/success 四态；接口失败保留错误而非伪数据。键盘 focus-visible，跳过导航；ARIA live、语义标题；prefers-reduced-motion 禁用非必要动画。demo 徽章在列表和详情都显示。

## 技能使用记录

frontend-design 决定编辑式克制风格；ui-ux-pro-max 决定可访问性、触控尺寸与空状态规则。其 search.py 未安装可运行文件，直接按已读规范执行。
