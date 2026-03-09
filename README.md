# AI 问题导航插件（ChatGPT + Gemini）

一个聚焦「只导航用户提问」的浏览器插件，解决多轮对话里回看历史问题需要反复上滑的问题。

## 支持平台

- ChatGPT（`chatgpt.com` / `chat.openai.com`）
- Gemini（`gemini.google.com`）

## 功能

- 自动识别当前平台
- 抓取并结构化用户提问（仅用户消息）
- 右侧悬浮导航栏（`Q1`、`Q2`...）
- 点击问题平滑定位到对应消息

## 安装

1. 打开 `chrome://extensions`（Edge 对应 `edge://extensions`）
2. 打开「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择目录：`ai-question-navigator-extension`

## 说明

- 当前版本维护 ChatGPT、Gemini 两个平台适配。
- Gemini 已启用文本去重，避免同一问题在导航中重复出现。

## 开源与协作

- 许可证：MIT（见 `LICENSE`）
- 欢迎提交 issue / PR 修复选择器和兼容性问题
