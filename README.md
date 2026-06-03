# 文字润色工坊 · SillyTavern Extension

一个运行在 SillyTavern 内的 AI 文字润色工具，支持多种文风、预设标签和强度调节。

## 功能

- **API 自由配置**：填写 URL + 密钥，兼容 Anthropic 及 OpenAI 格式接口
- **9 种润色风格**：文学叙事、诗意朦胧、古典雅致、浪漫细腻、戏剧张力、极简冷峻、奇幻绮丽、暗黑哥特、自定义
- **5 档润色强度**：从轻微词句优化到完全重塑
- **快速预设标签**：保留人称视角、增加感官细节、加强节奏感等（可多选）
- **导入 AI 消息**：一键从当前聊天导入最后一条 AI 消息
- **对比视图**：左右对比原文与润色结果
- **发送到输入框**：润色结果直接填入 ST 发送框

## 安装方法

1. 打开 SillyTavern
2. 点击顶部 **扩展（Extensions）** 图标 → **安装扩展**
3. 在输入框中粘贴此仓库的 GitHub 地址：
   ```
   https://github.com/your-username/st-text-polish
   ```
4. 点击安装，等待完成后刷新页面

## 使用方法

1. 安装后在扩展面板找到 **文字润色工坊**
2. 展开 **API 设置**，填写：
   - **API 地址**：例如 `https://api.anthropic.com`
   - **API 密钥**：你的 API Key
   - **模型**：例如 `claude-sonnet-4-20250514`
3. 选择风格、强度和预设
4. 在文本框输入内容（或点击「导入消息」），点击 **润色**

## 文件结构

```
st-text-polish/
├── manifest.json   # 扩展元数据
├── index.js        # 主逻辑
├── style.css       # 样式
├── panel.html      # 面板 HTML 模板
└── README.md       # 说明文档
```

## 注意事项

- API 密钥仅保存在 SillyTavern 本地设置中，不会外传
- 默认 endpoint 为 `/v1/messages`（Anthropic 格式）；若使用 OpenAI 兼容接口，填写对应 base URL 即可自动切换
- 建议 SillyTavern 版本 1.10.0 以上

## License

MIT
