# Meeting Copilot

AI 会议助手：粘贴 **Google Meet / Microsoft Teams / Zoom / 腾讯会议（VooV）** 链接，在浏览器中入会后即可：

- 🎙 **在线录音**：会议音频 + 你的麦克风混合录制，会后本地下载（WebM/Opus）
- 📝 **实时字幕**：区分"我"和"对方"，对方多人时自动区分说话人（S1、S2…）
- 🌐 **实时翻译**：每句话说完即翻译成你选择的语言（中英混说也可以）
- 💡 **AI 实时应答**：对方提问或提出异议时，自动给出可以直接说出口的回应 + 要点 + 风险提示；也可以随时手动问 AI
- 🌏 **双语回复**：建议回应用**对方的语言**（可直接念），下方附**你的语言**翻译，卡片标明「用 English 回复」
- 📎 **参考文件**：上传报价单、产品手册等 PDF / TXT / Markdown / CSV，AI 建议会引用并注明出处
- 🏷 **说话人命名**：点击 S1/S2 改成真实姓名，AI 建议和纪要都会使用
- 📋 **会后纪要**：一键生成摘要、决定事项、待办和跟进邮件草稿，并可导出逐字稿
- 🗂 **会议历史**：会后自动保存在本机浏览器（不上传服务器），可全文搜索、查看、导出、删除
- 📊 **实时指标**：建议延迟、翻译延迟、识别音频时长、token、预估费用、建议好评率；静音时不发送音频以节省识别费用

![演示会议界面](docs/demo.png)

完整的架构设计、技术选型、合规与路线图见 **[docs/PLAN.md](docs/PLAN.md)**。

## 快速开始

需要 Node.js 22+ 和 Chrome / Edge 浏览器。

```bash
cd meeting-copilot
npm install
cp .env.example .env      # 填入密钥（不填也能跑演示）
npm run dev               # 同时启动服务端 (8790) 和前端 (5180)
```

打开 http://localhost:5180 ，先点 **「试用演示会议」**：无需任何密钥即可看到字幕、翻译、AI 建议和纪要的完整流程（无密钥时使用模拟数据）。

### 配置密钥（`.env`，只放在服务端）

| 变量 | 作用 |
|------|------|
| `SONIOX_API_KEY` | 实时语音识别（默认，中英混说效果好） |
| `DEEPGRAM_API_KEY` | 备选语音识别（`STT_PROVIDER=deepgram`；Nova-3 的多语言混说模式不含中文，中文会议请固定单一语言或用 Soniox） |
| `ANTHROPIC_API_KEY` | Claude：实时翻译、实时建议、会议纪要 |
| `COPILOT_MODEL` / `TRANSLATE_MODEL` / `SUMMARY_MODEL` | 各角色使用的模型，默认 `claude-opus-5-5` |
| `ACCESS_TOKEN` | 可选；设置后需用 `http://host/?token=...` 访问（同时保护 WebSocket 和文件上传接口） |
| `ALLOWED_ORIGINS` | 可选；允许连接 WebSocket 的来源，逗号分隔 |

没有 STT 密钥时，服务端用能量 VAD 模拟识别（只显示"检测到语音 x 秒"），可用来确认音频采集链路是否正常。

## 开一场真实会议

1. 粘贴会议链接（或整段邀请文字），工具会识别平台和会议号；Zoom 链接会自动改写成网页入会链接。
2. 点 **「在新标签页打开会议」**，用网页版加入会议（Teams 选"在此浏览器上继续"，腾讯会议选"网页入会"）。
3. 选择会议语言和翻译目标语言，填写会前简报（你的角色、目标、报价/产品资料/术语）——简报越具体，AI 的建议越可靠。
4. 勾选"已告知与会者并取得同意"，点 **「开始」**，在浏览器弹窗中选择**会议所在的标签页**并勾选**「同时分享标签页音频」**。
5. 建议佩戴耳机，避免对方声音被麦克风重复采集。
6. 会议结束后：生成会议纪要、导出逐字稿、下载录音。

线下会议可选择「仅麦克风」模式。

参考文件会上传到 Claude Files API（无密钥时只在服务端内存中保留文件信息），在界面上点「移除」即删除。

## 评测

```bash
npm run eval:copilot -- --mock        # 离线检查评测脚本本身（不调用 API）
npm run eval:copilot                  # 真实模型 + Claude 评审（会产生 API 费用）
npm run eval:stt -- --languages zh,en # 真实 STT 跑 evals/stt/*.wav（见 evals/stt/README.md）
```

用例在 `evals/copilot-cases.json`，报告写到 `evals/reports/`（不提交到仓库）。

## 部署

```bash
npm run build     # 构建前端到 dist/
npm start         # 生产模式：同一端口提供页面、/health 和 /ws
```

浏览器采集麦克风和标签页要求 **HTTPS**（localhost 除外），生产环境请放在 HTTPS 反向代理之后。

## 开发

```bash
npm run lint
npm run test       # 单元测试 + 会话集成测试（不需要任何密钥）
npm run build      # 类型检查 + 前端构建
```

| 目录 | 内容 |
|------|------|
| `src/shared/` | 前后端共享：线路协议、会议链接解析、PCM 重采样、VAD 与音频时钟、语言工具 |
| `src/server/` | WebSocket + HTTP 服务、会话编排、STT 适配器、Claude 客户端、提示词、触发器、指标、参考文件 |
| `src/web/` | React 界面、音频采集引擎、连接管理、状态、本地会议历史 |
| `src/eval/` | 评测：混合错误率、WAV 解码、STT / Copilot 评测脚本 |
| `public/pcm-worklet.js` | AudioWorklet 采集处理器 |
