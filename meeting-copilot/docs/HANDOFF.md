# 交接说明：Meeting Copilot（给接手的 Claude 会话）

> 写于 2026-10-08 10:30 SGT（02:30 UTC）。原会话因换账号结束，本文件是接手所需的全部上下文。
> 产品设计、架构、路线图与代码地图见 [`docs/PLAN.md`](PLAN.md)；使用与部署见 [`README.md`](../README.md)。本文件只写这两份文档里**没有**的东西：现状、约定、坑、待办。

---

## 1. 一句话现状

`meeting-copilot/` 是一个完整可用的 AI 会议助手（Phase 0–4a 全部交付）：粘贴 Google Meet / Teams / Zoom / 腾讯会议链接 → 采集"我（麦克风）/ 对方（会议标签页或系统声音）"两路音频 → Soniox 实时转写 → Claude 实时翻译、双语回复建议、纪要、会议结果 → 会后推送。另有 Electron 桌面版、Attendee 会议机器人、只读实时共享、日历与会前简报、会议分析、PWA、Docker 部署。

- 256 个单元测试全过；lint、typecheck、build、桌面打包全过；CI 绿。
- **真实服务商链路（真 Soniox / Claude 密钥的实际会议）还没在真实会议里跑过**——用户今天中午是第一次实战。

## 2. 仓库、分支、PR

| 项 | 值 |
|---|---|
| 仓库 | `cndingbo2030/lokalane`（GitHub） |
| 子项目目录 | `meeting-copilot/`（独立的 `package.json`、`package-lock.json`、工具链、测试） |
| ⚠️ 仓库根目录 | 是**另一个项目**（Lokalane 新加坡导航地图，Vite + Capacitor + Cloudflare）。**不要改根目录的任何文件**；根目录自带 vitest，在根目录跑测试会跑到它的 12 个测试，不是本项目 |
| 开发分支 | `claude/ai-meeting-tool-plan-e77i4z`（已全部推送，工作区干净） |
| PR | https://github.com/cndingbo2030/lokalane/pull/7 （草稿，`main` ← 本分支，7 个提交，mergeable，无评审意见，CI 绿） |

提交历史（新 → 旧）：

```
55807c1 会议助手：README 增加 10 分钟会前上手指南
0cecace Meeting copilot phase 4a: faster first suggestion, analytics, deployable
24edcd4 Meeting copilot phase 3b: meeting bots, live sharing and "this is me"
14c9dbe Meeting copilot phase 3a: calendar, AI briefs, outcomes and team delivery
742422e Meeting copilot phase 2: desktop app, floating prompter, resilient sessions
6024162 Meeting copilot phase 1: bilingual replies, documents, metrics, VAD, history, evals
a44347b Add AI meeting copilot: live transcription, translation and reply suggestions
```

**接手时的分支策略**：如果新会话被允许推送到 `claude/ai-meeting-tool-plan-e77i4z`，就继续在它上面开发，PR #7 保持唯一的 PR。如果新会话被指定了别的分支，从本分支拉出：

```bash
git fetch origin claude/ai-meeting-tool-plan-e77i4z
git checkout -B <新分支名> origin/claude/ai-meeting-tool-plan-e77i4z
```

新 PR 以 `main` 为目标，在描述里注明"接续 #7"。不要从 `main` 重新开始，否则会丢掉全部代码。

CI（`.github/workflows/ci.yml` 的 `meeting-copilot` job，`working-directory: meeting-copilot`）：`npm ci` → `npm run lint` → `npm run test` → `npm run build` → `node scripts/build-desktop.mjs`。

## 3. 用户与沟通约定（重要）

- **全部用中文沟通**：回复、PR 标题与描述、提交信息（从 55807c1 起提交信息用中文）。用户曾明确纠正过一次"使用中文"。
- 用户在**新加坡时区（SGT, UTC+8）**，用 **macOS + Chrome**；能在终端里照着命令操作，但需要逐条、可复制的命令和明确的预期输出。
- 用户的期望是"以世界最顶级的 AI 专家视角"规划和完成：主动发现风险、给推荐方案而不是罗列选项、按阶段交付、每个阶段都做到可验证。
- 用户口头说"继续"时，按 `PLAN.md` 路线图推进下一阶段（当前下一阶段是 Phase 4b，但先做第 7 节的 P0/P1）。
- 代码里：**界面文案、错误提示用中文；代码注释、标识符用英文**（保持现有风格）。

## 4. 必须保持的技术约定

**模型与 Claude 调用**（`src/server/llm/anthropic.ts`、`src/server/ai/*`、`src/server/config.ts`）
- 所有角色默认 `claude-opus-5-5`（可用 `COPILOT_MODEL` / `TRANSLATE_MODEL` / `SUMMARY_MODEL` 覆盖；降级备选 `claude-sonnet-5-5`）。
- effort：实时角色（翻译、Copilot）`low`；纪要、简报、会议结果 `medium`。通过 `output_config.effort` 传。
- 所有请求带 beta `server-side-fallback-2026-07-01` + `fallbacks: 'default'`（服务端拒答回退）。
- 结构化输出用 `output_config.format: { type: 'json_schema', schema }`（简报、会议结果）。
- 提示缓存：断点在最后一个 system 块、最后一个文档块、`cachedPrompt`（5 分钟）；Copilot 稳定前缀用 **1 小时 TTL**；会议开始时若前缀足够大，用 `max_tokens: 0` 预热（`prewarm()`，参数必须与真实请求一致，否则缓存不命中）。计价：1h 写入 = 2× 输入价，Opus 5.5 缓存读取 $0.20/百万 token，最小可缓存前缀 512 token（`src/server/metrics.ts`）。
- 无 `ANTHROPIC_API_KEY` 时自动用 Mock LLM；无 STT 密钥时用 Mock STT。演示会议不需要任何密钥。

**语音识别**（`src/server/stt/`）
- 默认 Soniox `stt-rt-v5`（`wss://stt-rt.soniox.com/transcribe-websocket`，3 秒 keepalive，单条流最长约 65 分钟）；备选 Deepgram `nova-3`；`mock`。
- 只对 `remote` 路做说话人分离；`me` 路永远是用户本人。

**音频协议**（`src/shared/protocol.ts`、`src/shared/pcm.ts`、`src/shared/vad.ts`）
- 二进制帧 = 5 字节头（来源 + 采集时间戳）+ PCM16 16 kHz 单声道。客户端 VAD 只发有声片段（300 ms 预留、1.5 s 拖尾）。
- 服务端用 `AudioClock` 把 STT 时间戳（只计发送过的音频）映射回会议真实时间。

**安全**（`src/server/app.ts`、`src/server/net/safeFetch.ts`、`src/server/rateLimit.ts`）
- 所有用户提供的外部 URL（日历、Webhook）都走 `safeFetch`（防 SSRF）。
- CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://host wss://host; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`，外加 `Referrer-Policy: no-referrer`、`nosniff`。**不能加内联脚本或第三方脚本/连接**，否则生产页面会被 CSP 拦截。
- 按客户端令牌桶限流；`TRUST_PROXY=true` 时取 `X-Forwarded-For` 最右侧地址。
- 只读共享链接（`ShareHub`）的 token 绕过访问令牌，但只能看；跟进邮件草稿永不共享。

**隐私**：会议历史只存在浏览器 IndexedDB（有保留期限设置），服务端不落盘会议内容；结束时只打一行不含内容的指标日志。

**前端**：React 19 + Vite 8；ESLint 开了 React Compiler 的 hooks 规则——渲染中不能调用 `Date.now()` 等不纯函数（用 `src/web/useNow.ts`），不能有未使用变量/无用赋值。协议类型前后端共享，改消息类型要同时改 `src/shared/protocol.ts`、`src/server/session.ts`/`app.ts`、`src/web/state/reducer.ts`（reducer 的 switch 是穷举的，漏 case 会 TS2366）。

**测试**：`src/**/*.test.ts` 与源码同目录，vitest `node` 环境。新功能必须带测试。

## 5. 本地开发与提交前验证

```bash
cd meeting-copilot
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci   # 云端容器里跳过 Electron 二进制下载
cp .env.example .env                     # 填 SONIOX_API_KEY、ANTHROPIC_API_KEY
npm run dev                              # 服务端 tsx watch :8790 + Vite :5180（代理 /ws /api /health）
```

**每次推送前必须全部通过**（与 CI 一致）：

```bash
npx tsc -b && npx eslint . && npx vitest run && npm run build && node scripts/build-desktop.mjs
```

生产运行：`npm run build && npm start`（`dist-server/server.mjs` + `dist/`，端口 8790）。Docker：`DOMAIN=你的域名 docker compose up -d`（Caddy 自动 HTTPS，`PUBLIC_URL`、`TRUST_PROXY` 自动设置）。

**已知的坑**
- `npm start` 用了 `NODE_ENV=production node ...` 的内联写法，**Windows 下不可用**（用户是 macOS，暂不影响；可改用 cross-env 或在代码里设置）。
- 在沙箱里杀进程不要用 `pkill -f "tsx src/server/index"`，会匹配到自己的 shell 而自杀（退出码 144）；用方括号写法 `pkill -f "[t]sx src/server/index"`，并单独一条命令执行。
- 云端沙箱的 HTTPS 代理会让 `docker build` 里的 `npm ci` 报 `SELF_SIGNED_CERT_IN_CHAIN`：在临时副本里注入代理 CA 验证即可，**不要改仓库里的 Dockerfile**。
- 沙箱 locale 会让 Chromium 下载的中文文件名显示为 `download`，不是代码问题。
- 用户 macOS 上 `npm install` 时出现的"10 vulnerabilities"和 install-scripts 警告无害（都在开发依赖链里）；**不要运行 `npm audit fix --force`**（会升级破坏 electron-builder 等）。
- Playwright：容器里 Chromium 预装在 `/opt/pw-browsers`，不要 `playwright install`。Electron 端到端用 Xvfb 跑。

**浏览器端到端测试**：原会话用临时 Playwright 脚本（放在会话 scratchpad，**未进仓库**）验证过：演示会议、麦克风、会议结果与 Webhook 推送（本地假 webhook 服务器）、机器人模式（本地假 Attendee 服务器：REST + 回连 `/ws/bot` 推送 `realtime_audio.mixed`）、双窗口实时共享、画中画提词器、PWA、访问令牌、会议分析（浅/深色）、历史保留、Electron 桌面版。需要时按同样思路重写；若要长期保留，可考虑放进 `meeting-copilot/scripts/e2e/`。

## 6. 已验证 / 未验证

已验证：上面第 5 节所列全部，加 Docker 镜像构建与运行、`docker compose config`、`caddy validate`、生产包在干净目录 `npm ci --omit=dev` 可运行。

**未验证**（需要真实密钥/环境）：
- 真 Soniox + 真 Claude 的实际会议（今天中午第一次）——重点看：字幕延迟、翻译延迟、第一条建议延迟、`cache_read_input_tokens` 是否 > 0。
- 真实 Attendee 机器人入会；飞书/钉钉/企业微信/Slack/Teams 真实推送。
- macOS / Windows 真机系统声音采集；签名、公证后的安装包。
- 用真实模型跑 `npm run eval:copilot` 基线（会产生费用）。

## 7. 待办（按优先级）

### P0 — 今天 12:00 SGT 的 Google Meet 会议（≤ 30 分钟）
用户在自己的 Mac 上本地运行（**目前没有线上地址**）。进度：已 `git clone`、`npm install` 成功；下一步是填 `.env` 的 `SONIOX_API_KEY`、`ANTHROPIC_API_KEY`，`npm run dev`，打开 http://localhost:5180 做 README「10 分钟会前上手」里的 2 分钟自测。

会中操作要点（README 已写）：Chrome 打开 Meet → 在 Copilot 里选「会议标签页」并勾选**共享标签页音频** → **戴耳机**（否则对方声音被麦克风二次采集）→ 可开画中画提词器。启动日志里 `STT: soniox`、`LLM: anthropic` 后面不能有 "set … API_KEY" 提示；`/health` 应显示 soniox 和 anthropic。

出问题时的降级：`COPILOT_MODEL` / `TRANSLATE_MODEL` / `SUMMARY_MODEL` 改 `claude-sonnet-5-5`；`SONIOX_MODEL` 改 `stt-rt-v4`；改完重启 `npm run dev`。

原会话在交接时正在跑一轮"会前风险排查"（四个方向：Soniox 实时链路、Claude 调用参数、macOS Chrome 标签页音频采集、macOS 安装配置），**结果没来得及取回**。若会前还有时间，按这四个方向快速复查一遍，只修小而安全的问题，修完让用户 `git pull` 并重启 `npm run dev`。

### P1 — STT 断流自动重连（已确认的真实缺口）
`src/server/stt/soniox.ts`：服务端关闭连接（网络抖动、约 65 分钟单流上限、服务端错误）后只清了 keepalive，`write()` 之后静默丢弃音频；`src/server/session.ts` 的 `streamFor()` 仍缓存着这条死流，**这一路的字幕会无声无息地停止**，界面也不一定报错。Deepgram 适配器同理需要检查。

修法建议：
- 适配器在非主动关闭时通知会话（如新增 `onClose`）。
- 会话把该路流从 `streams` 删掉，下一帧音频自动开新流，并为该路**重建 `AudioClock`**（新流的时间戳从 0 开始）。
- 未定稿的部分结果要定稿或丢弃，避免界面残留。
- 加退避，避免密钥错误时死循环重连；界面提示"语音识别已重连"。
- 补单元测试（模拟服务端关闭 → 新流 → 时间轴连续）。

### P2 — 会前自检
在界面里一键检查：麦克风电平、标签页音频是否真的有声音、STT 与 Claude 密钥可用、首字延迟，并给出可操作的中文提示。

### P3 — `npm start` 跨平台、`PLAN.md` 中未勾选项
部分结果投机触发、真实会议评测基线、代码签名与自动更新、macOS 系统声音真机验证、OAuth 日历、逐人音轨、CRM 集成。

### P4 — Phase 4b 企业化（用户说"继续"时的下一阶段，见 `PLAN.md` §8）
团队知识库与检索、账号与云端同步（默认仍本地优先）、SSO / 审计 / 数据保留、国内部署（国内模型与语音识别适配）、跨会议分析。

## 8. 上线方案（用户问过，已回答过的结论）

现在没有线上测试地址。可选方案：
1. **本机运行**（今天就用这个）：`npm run dev`，只有本机能用。
2. **临时公网地址**：本机运行 + `cloudflared tunnel --url http://localhost:8790`（先 `npm run build && npm start`），几分钟可得 https 地址；机器人模式需要把它填进 `PUBLIC_URL`。
3. **正式部署**：一台有公网 IP 的 VPS + 域名，`DOMAIN=… docker compose up -d`，Caddy 自动 HTTPS；建议同时设置 `ACCESS_TOKEN`。
4. **桌面版**：`npm run desktop:package` 出未签名的 dmg / exe，可配合 Zoom / Teams / 腾讯会议桌面客户端（系统声音）。

## 9. 改代码时的速查

| 想改什么 | 去哪里 |
|---|---|
| 提示词（翻译 / 建议 / 纪要 / 简报 / 会议结果） | `src/server/ai/prompts.ts` 及同目录各角色文件 |
| 何时触发建议（问句、异议、冷却） | `src/server/triggers.ts`、`src/shared/questions.ts` |
| 会议编排（音频 → STT → 翻译 / 建议 / 纪要） | `src/server/session.ts` |
| HTTP / WebSocket 路由、鉴权、限流、安全头 | `src/server/app.ts` |
| 环境变量 | `src/server/config.ts` + `.env.example` + README |
| 前后端消息协议 | `src/shared/protocol.ts` |
| 前端状态 | `src/web/state/reducer.ts`；主界面 `src/web/App.tsx`；音频采集 `src/web/audio/engine.ts`、`public/pcm-worklet.js` |
| 桌面版 | `src/desktop/main.ts`、`preload.ts`、`settings.ts` |
| 费用与延迟指标 | `src/server/metrics.ts` |
