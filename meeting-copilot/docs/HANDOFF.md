# 交接说明：Meeting Copilot（给接手的 Claude 会话）

> 写于 2026-10-08 约 10:45 SGT（02:45 UTC），已逐条对照代码核对。原会话因换账号结束，本文件是接手所需的全部上下文。
> 产品设计、架构、路线图、代码地图见 [`docs/PLAN.md`](PLAN.md)；使用与部署见 [`README.md`](../README.md)。本文件只写这两份文档里**没有**的东西：现状、约定、坑、待办。**本文件与代码不一致时，以代码为准，并顺手修正本文件。**

---

## 0. 接手第一步：先看时间

执行 `TZ=Asia/Singapore date` 确认新加坡时间。用户今天 **12:00 SGT 有一场 Google Meet 会议（最长 30 分钟）**，要用本项目。

- **11:45 前**：按第 7 节 P0 帮用户做会前配置和自检；只修小而安全的问题。
- **11:45–12:30**：只答疑、只给不改代码的操作建议。**会中绝不让用户 `git pull` 或改代码**（见 P0 的热修规则）。
- **会后**：P0 变为"实战复盘"：按第 6 节的方法收集数据和反馈，再决定先做 P1 还是先调提示词或延迟。

## 1. 一句话现状

`meeting-copilot/` 是一个完整可用的 AI 会议助手（Phase 0–4a 全部交付）。主流程：粘贴 Google Meet / Teams / Zoom / 腾讯会议链接 → 采集"我（麦克风）/ 对方（会议标签页或系统声音）"两路音频 → Soniox 实时转写 → Claude 实时翻译、双语回复建议、纪要、会议结果 → 会后推送。另外还有：

- Electron 桌面版、Attendee 会议机器人、只读实时共享
- 日历与会前简报、会议分析、PWA、Docker 部署

当前状态：

- 256 个单元测试全过；lint、typecheck、build、桌面打包全过；CI 绿。
- **还没有在真实会议里跑过真 Soniox / Claude 密钥的完整链路**，今天中午是第一次实战。

## 2. 仓库、分支、PR

| 项 | 值 |
|---|---|
| 仓库 | `cndingbo2030/lokalane`（GitHub） |
| 子项目目录 | `meeting-copilot/`（独立的 `package.json`、`package-lock.json`、工具链、测试） |
| ⚠️ 仓库根目录 | 是**另一个项目**（Lokalane 新加坡导航地图，Vite + Capacitor + Cloudflare），见下方说明 |
| 开发分支 | `claude/ai-meeting-tool-plan-e77i4z`（已全部推送，工作区干净） |
| PR | https://github.com/cndingbo2030/lokalane/pull/7 （草稿，`main` ← 本分支，mergeable，无评审意见，CI 绿） |

**根目录**：除下面 4 处外，不要改根目录的文件。本分支已经对根目录做过 4 处必要改动，**必须保留，不要"清理"或回滚**：

- `.github/workflows/ci.yml` 的 `meeting-copilot` job
- 根 `eslint.config.js` 的 globalIgnores 里的 `'meeting-copilot'`
- 根 `vite.config.ts` 里 vitest 的 `exclude: [...configDefaults.exclude, 'meeting-copilot/**']`
- 根 `README.md` 末尾的「Meeting Copilot」一节

少了这两处排除，根项目的 `quality` job 会去 lint 和测试本项目，CI 会红。在根目录跑 `npx vitest run` 跑的是根项目的 12 个测试，不是本项目；在根目录跑 `npm run dev` 启动的是地图项目（5173 端口）。

提交历史（新 → 旧，之后以 `git log --oneline origin/claude/ai-meeting-tool-plan-e77i4z` 为准）：

```
（本文件的更新提交）
01dbdf7 会议助手：新增交接说明 docs/HANDOFF.md
55807c1 会议助手：README 增加 10 分钟会前上手指南
0cecace Meeting copilot phase 4a: faster first suggestion, analytics, deployable
24edcd4 Meeting copilot phase 3b: meeting bots, live sharing and "this is me"
14c9dbe Meeting copilot phase 3a: calendar, AI briefs, outcomes and team delivery
742422e Meeting copilot phase 2: desktop app, floating prompter, resilient sessions
6024162 Meeting copilot phase 1: bilingual replies, documents, metrics, VAD, history, evals
a44347b Add AI meeting copilot: live transcription, translation and reply suggestions
```

**分支策略**：
- 能推送到 `claude/ai-meeting-tool-plan-e77i4z` 就继续在它上面开发，PR #7 保持唯一的 PR。用户 Mac 上的代码是用 `git clone -b claude/ai-meeting-tool-plan-e77i4z` 拉的，**热修必须推到这个分支**，用户 `git pull` 才拿得到。
- 如果新会话被指定了别的分支，从本分支拉出（不要从 `main` 重新开始，否则会丢掉全部代码）：
  ```bash
  git fetch origin claude/ai-meeting-tool-plan-e77i4z
  git checkout -B <新分支名> origin/claude/ai-meeting-tool-plan-e77i4z
  ```
  新 PR 以 `main` 为目标，描述里注明"接续 #7"。这时要给用户的更新命令是：
  `cd lokalane/meeting-copilot && git fetch origin && git checkout -B <新分支> origin/<新分支> && npm install`，然后 Ctrl+C 停掉服务，再 `npm run dev`。
- 推送被拒（403 / 无权限）说明新账号还没授权访问这个仓库：请用户在 claude.ai 的 GitHub 连接设置里授权 `cndingbo2030/lokalane`。

**CI**（`.github/workflows/ci.yml`）：
- `meeting-copilot` job（`working-directory: meeting-copilot`）依次跑：`npm ci` → `npm run lint` → `npm run test` → `npm run build` → `node scripts/build-desktop.mjs`。
- **只在 `pull_request` 和推送到 `main` 时触发**：推到新分支但没开 PR 时，CI 不会跑，不要把"没看到红"当成通过。
- 每个 PR 还会跑根项目的 `quality` job。
- CI 用 Node 24，本地容器和 Dockerfile 用 Node 22：两边都要能过，不要用只有 Node 24 才有的 API。

## 3. 用户与沟通约定（重要）

- **全部用中文沟通**：回复、PR 标题与描述、提交信息（从 55807c1 起提交信息用中文）。用户曾明确纠正过一次"使用中文"。
- 用户在**新加坡时区（SGT, UTC+8）**，用 **macOS + Chrome**。能在终端里照着命令操作，但需要逐条、可复制的命令和明确的预期输出。
- 用户期望"以世界最顶级的 AI 专家视角"规划和完成：主动发现风险，给推荐方案而不是罗列选项，按阶段交付，每个阶段都做到可验证。
- 用户说"继续"时，先完成第 7 节的 P0/P1，再按 `PLAN.md` 路线图推进下一阶段（Phase 4b）。
- 代码风格：**界面文案、错误提示用中文；代码注释、标识符用英文**（保持现有风格）。

## 4. 必须保持的技术约定

**模型与 Claude 调用**（`src/server/llm/anthropic.ts`、`src/server/ai/*`、`src/server/config.ts`）
- 模型：所有角色默认 `claude-opus-5-5`，可用 `COPILOT_MODEL` / `TRANSLATE_MODEL` / `SUMMARY_MODEL` 覆盖；降级备选 `claude-sonnet-5-5`。
- effort（通过 `output_config.effort` 传）：实时角色（翻译、Copilot）用 `low`；纪要、简报、会议结果用 `medium`。
- 所有请求带 beta `server-side-fallback-2026-07-01` 和 `fallbacks: 'default'`（服务端拒答回退）。
- 结构化输出（简报、会议结果）用 `output_config.format: { type: 'json_schema', schema }`。
- 提示缓存：
  - 断点在最后一个 system 块、最后一个文档块、`cachedPrompt`（5 分钟）。
  - Copilot 的稳定前缀用 **1 小时 TTL**。
  - 会议开始时，如果有参考文件，或简报（cachedContext）超过 `PREWARM_MIN_CHARS = 2000` 字符（`src/server/session.ts:60-61、268`），就用 `max_tokens: 0` 预热（`prewarm()`）。预热参数必须与真实请求一致，否则缓存不命中。
  - Opus 5.5 最小可缓存前缀为 512 token（API 规则，代码里没有这个常量）。
- 计价见 `src/server/metrics.ts:4-8`：1 小时缓存写入 = 2× 输入价；Opus 5.5 缓存读取 $0.20/百万 token。
- 无密钥时的回退：既没有 `ANTHROPIC_API_KEY` 也没有 `ANTHROPIC_AUTH_TOKEN` 时自动用 Mock LLM。SDK 还会隐式读取 `ANTHROPIC_BASE_URL`。

**语音识别**（`src/server/stt/`）
- 默认 Soniox `stt-rt-v5`（`wss://stt-rt.soniox.com/transcribe-websocket`，静音超过 3 秒发 keepalive）；备选 Deepgram `nova-3`；另有 `mock`。
- 单条流的时长上限以 Soniox 官方文档为准，代码里没有相关处理（见 P1）。
- 服务商选择（`config.ts:38-42`）：
  - `STT_PROVIDER` 留空时，按已填的密钥自动选。
  - **显式写了 `soniox` / `deepgram` 但对应密钥为空时，会静默退回 mock**，不会改用另一家的密钥。`.env.example` 默认 `STT_PROVIDER=soniox`。
- 只对 `remote` 路做说话人分离，`me` 路永远是用户本人。

**音频协议**（`src/shared/protocol.ts:231-249`、`src/shared/vad.ts`）
- 二进制帧 = 5 字节头（1 字节来源：0=我，1=对方；4 字节小端采集时间戳，单位 ms）+ PCM16 16 kHz 单声道，每帧 100 ms。
- 客户端 VAD（默认开启，界面开关叫「静音时不发送音频（节省识别费用）」）只发送有声片段，含 300 ms 预留和 1.5 s 拖尾。
- 服务端用 `AudioClock` 把 STT 时间戳（只计发送过的音频）映射回会议真实时间。

**安全**（`src/server/app.ts`、`src/server/net/safeFetch.ts`、`src/server/rateLimit.ts`）
- 所有用户提供的外部 URL（日历、Webhook）都走 `safeFetch`（防 SSRF）。
- CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://host wss://host; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`，另有 `Referrer-Policy: no-referrer` 和 `nosniff`。
  - **不能加内联脚本、第三方脚本或第三方连接。**
  - **CSP 只在生产静态服务中生效**（`npm run build && npm start`、Docker、桌面版）。`npm run dev`（Vite 5180）下没有 CSP，开发时看不出违规。凡是改了前端加载的资源、连接或 Worker，都要用 `npm run build && npm start` 打开 http://localhost:8790，检查控制台有没有 CSP 报错。
- 限流：按客户端令牌桶；`TRUST_PROXY=true` 时取 `X-Forwarded-For` 最右侧的地址。
- 只读共享（`ShareHub`，`src/server/share.ts`）：链接里的 token 绕过访问令牌，但只能看；跟进邮件草稿永不共享。

**隐私**：会议历史只存在浏览器 IndexedDB（有保留期限设置），**不含录音**。服务端不落盘会议内容，会话结束时只打一行不含内容的 `meeting.closed` 指标日志。

**前端**
- React 19 + Vite 8。ESLint 开了 React Compiler 的 hooks 规则：
  - 渲染中不能调用 `Date.now()` 等不纯函数，用 `src/web/useNow.ts`；
  - 不能有未使用的变量或无用的赋值。
- **改消息协议**，要同时改：
  - `src/shared/protocol.ts`；
  - `src/server/session.ts` / `app.ts`；
  - `src/web/state/reducer.ts`（reducer 的 switch 是穷举的，漏 case 会报 TS2366）。
- 如果只读观看页也需要某条消息，还要在 `src/server/share.ts` 的 `forViewers()` 里放行。它默认 `return null`，新类型不会转发给观看者；含隐私内容的字段要在那里清掉。

**测试**：测试文件 `src/**/*.test.ts` 与源码同目录，vitest 用 `node` 环境。新功能必须带测试。

## 5. 本地开发与提交前验证

```bash
cd meeting-copilot                       # 一定要在这个目录里
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci   # 云端容器里跳过 Electron 二进制下载
cp .env.example .env                     # 填 SONIOX_API_KEY、ANTHROPIC_API_KEY
npm run dev                              # 服务端 tsx watch :8790 + Vite :5180（代理 /ws /api /health）
```

**每次推送前必须全部通过**（与 CI 一致）：

```bash
npx tsc -b && npx eslint . && npx vitest run && npm run build && node scripts/build-desktop.mjs
```

- 生产运行：`npm run build && npm start`（`dist-server/server.mjs` + `dist/`，端口 8790；`npm start` 会设置 `NODE_ENV=production`，启用静态文件服务、CSP 和严格的来源校验）。
- Docker：`cp .env.example .env`，填好 `DOMAIN`、`ACCESS_TOKEN` 和各项密钥，然后 `docker compose up -d --build`。
  - 每次更新代码都要带 `--build`，否则跑的还是旧镜像。
  - Caddy 自动申请 HTTPS，`PUBLIC_URL` 和 `TRUST_PROXY` 由 compose 自动设置。

**环境变量**：除了 README 里的表格，代码还会读下面这些变量（`src/server/config.ts`）。新增环境变量时，要同时更新 config.ts、`.env.example`、README 表格和本节。
- `PORT`：默认 8790。Vite 开发代理只认 shell 里的 `PORT`，不读 `.env`。开发时要改端口就用 `PORT=xxxx npm run dev`，不要只改 `.env`。
- `STT_PROVIDER`、`SONIOX_MODEL`、`DEEPGRAM_MODEL`。
- `ANTHROPIC_AUTH_TOKEN`：与 `ANTHROPIC_API_KEY` 二选一即可启用 Claude。
- `NODE_ENV`。
- `ANTHROPIC_BASE_URL`：SDK 隐式读取。

**已知的坑**
- **`.env` 不会覆盖 shell 里已有的同名变量**（`process.loadEnvFile` 的行为，`config.ts:96-97`）。如果用户的 `~/.zshrc` 里 export 过旧的 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` 等，`.env` 里的值会被静默忽略。
- **改了 `.env` 必须 Ctrl+C 再 `npm run dev`**：tsx watch 不监听 `.env`。
- `npm start` 用了 `NODE_ENV=production node ...` 这种内联写法，**Windows 下不可用**（用户用 macOS，暂不影响）。
- 在沙箱里杀进程不要用不带方括号的 `pkill -f`，它会匹配到自己的 shell 而自杀（退出码 144）。用方括号写法，并单独一条命令执行：
  - `npm run dev` 启动的服务端：`pkill -f "[s]rc/server/index.ts"`；
  - 直接用 tsx 启动的：`pkill -f "[t]sx src/server/index"`。
- 云端沙箱的 HTTPS 代理会让 `docker build` 里的 `npm ci` 报 `SELF_SIGNED_CERT_IN_CHAIN`。在临时副本里注入代理 CA 来验证即可，**不要改仓库里的 Dockerfile**。
- 沙箱的 locale 会让 Chromium 下载的中文文件名显示为 `download`，不是代码问题。
- 用户 `npm install` 时出现的 "10 vulnerabilities" 和 install-scripts 警告是无害的，都在开发依赖链里。**不要运行 `npm audit fix --force`**。
- Playwright 不是项目依赖，是原容器全局安装的（Chromium 在 `/opt/pw-browsers`）。
  - 先用 `npm ls -g playwright` 和 `echo $PLAYWRIGHT_BROWSERS_PATH` 确认有没有。
  - 没有的话，不要把它加进项目依赖，先问用户。
  - 不要运行 `playwright install`。Electron 的端到端测试用 Xvfb 跑。

**桌面版须知**
- 桌面版**不读 `.env`**：API 密钥在应用首页「桌面版设置」里填，存进系统钥匙串；模型覆盖只能在启动前用 shell 环境变量设置。
- 安装依赖时如果用了 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`，`npm run desktop` / `desktop:package` 会因为缺 Electron 二进制而失败。先执行 `node node_modules/electron/install.js` 补装。
- 打出来的包未签名，macOS 首次打开要右键 →「打开」。系统声音采集还需要录屏/系统录音权限，拿不到时界面会提示改用标签页模式或 BlackHole。
- 桌面版没有「共享」功能。

**浏览器端到端测试**：原会话用临时 Playwright 脚本验证过以下场景（脚本放在会话的 scratchpad 里，**没有进仓库**）：
- 演示会议、麦克风；
- 会议结果与 Webhook 推送（用本地假 webhook 服务器）；
- 机器人模式（用本地假 Attendee 服务器：提供 REST 接口，并回连 `/ws/bot` 推送 `realtime_audio.mixed`）；
- 双窗口实时共享、画中画提词器；
- PWA、访问令牌、会议分析（浅色和深色）、历史保留；
- Electron 桌面版。

需要时按同样的思路重写；要长期保留的话，可以放进 `meeting-copilot/scripts/e2e/`。

## 6. 已验证 / 未验证 / 会后如何收集数据

**已验证**：
- 第 5 节列出的全部端到端场景；
- Docker 镜像能构建和运行，`docker compose config` 和 `caddy validate` 通过；
- 生产包在干净目录里只装 `npm ci --omit=dev` 也能运行。

**未验证**（需要真实密钥或环境）：
- 真 Soniox + 真 Claude 的实际会议（今天中午第一次）；
- 真实的 Attendee 机器人入会；
- 飞书、钉钉、企业微信、Slack、Teams 的真实推送；
- macOS 和 Windows 真机上的系统声音采集；
- 签名、公证后的安装包；
- 用真实模型跑 `npm run eval:copilot` 的基线（会产生费用）。

**会后收集数据**（界面指标栏只显示合计 token，看不到缓存命中）：
1. 会中把鼠标悬停在指标栏上，能看到建议延迟、翻译延迟的 P95，以及已显示和已跳过的建议数。请用户截图。
2. 会后按顺序操作：「下载录音」→「生成会议纪要」→「新会议」。点「新会议」才会发送 `leave`，这时服务端才关闭会话；只点「结束会议」不会。
3. 然后让用户把跑 `npm run dev` 的终端里那一行 `{"event":"meeting.closed", ...}` 的 JSON 发过来。这行日志不含会议内容。
4. 解读这行日志：
   - `metrics.llm.copilot.cacheReadTokens > 0`：缓存命中了。
   - `suggestionLatencyMs`、`translationLatencyMs`：延迟实测值。对照 PLAN.md §8 的验收标准：字幕 < 1 秒、翻译 < 2 秒、建议 ≤ 2 秒。
5. 再问用户的主观感受：字幕和翻译跟不跟得上，建议有没有用，有没有报错。

## 7. 待办（按优先级）

### P0 — 今天 12:00 SGT 的 Google Meet 会议（≤ 30 分钟，本机 `npm run dev`）

目前**没有线上地址**。进度：用户已经 `git clone`、`npm install` 成功，下一步是配置 `.env`。

**会前自检**（建议 11:45 前完成）：
1. 在 `lokalane/meeting-copilot` 目录（不是根目录）执行：
   ```bash
   env | grep -E '^(ANTHROPIC|SONIOX|DEEPGRAM|STT_PROVIDER|COPILOT_MODEL|TRANSLATE_MODEL|SUMMARY_MODEL|PORT)'
   ```
   预期**没有输出**。有输出就先 `unset 变量名`，并检查 `~/.zshrc`；否则 `.env` 里填的值不会生效。特别注意 `ANTHROPIC_BASE_URL`，它会把请求发到别处。
2. `cp .env.example .env`，填 `SONIOX_API_KEY`、`ANTHROPIC_API_KEY`，然后 `npm run dev`。
3. 检查启动日志：应该是 `STT: soniox` 和 `LLM: anthropic (claude-opus-5-5)`。如果显示 `STT: mock (set SONIOX_API_KEY …)` 或 `LLM: mock (set ANTHROPIC_API_KEY …)`，说明没读到密钥。
   - 注意：`/health` 和启动日志只能说明"密钥已填"，**不能说明密钥有效**。
4. **用真密钥跑一遍演示**：打开 http://localhost:5180，点「试用演示会议」。演示的字幕是内置脚本，但翻译和建议走真实的 Claude，所以能验证 Claude 密钥、额度和模型权限，不需要说话。看到翻译和建议卡片出现，就说明 Claude 链路正常。
   - 页面顶部出现「翻译失败: 401/403/404/429 …」，或翻译明显很慢（悬停指标栏看翻译延迟，P50 超过约 3 秒），就在 `.env` 加 `TRANSLATE_MODEL=claude-sonnet-5-5`（必要时 `COPILOT_MODEL` 和 `SUMMARY_MODEL` 也改），然后重启。
5. **验证 Soniox**：按 README「10 分钟会前上手（本机运行，用于 Google Meet 等网页会议）」第 5 步「2 分钟自检」，用「线下会议（仅麦克风）」中英文各说一句。
   - 字幕出来，说明 Soniox 密钥有效。
   - 默认「翻译成」中文，所以**只有英文那句会出中文翻译，中文句本来就不翻译**，这是正常的。
   - 出现「语音识别出错 (me): Soniox 401 …」说明密钥有问题。
   - 更好的做法：用「线上会议」模式共享一个正在播放 YouTube 的标签页测一次，确认灰色的临时字幕会变成定稿行，并带上翻译。
6. 会前如果上传过参考文件，而那时服务器还没配 Claude 密钥（mock 模式），要在设置面板里把这些文件删掉（×），用真密钥运行时重新上传。否则每条建议和纪要都会报 400。

**开会时的操作**（标签名与界面一致）：
1. 先在 Chrome 的一个标签页里用网页版加入 Google Meet。
2. 回到 Copilot（http://localhost:5180），粘贴会议链接，采集方式保持默认的「线上会议（共享会议标签页 + 麦克风）」，选好语言。
3. ⚠️ **取消勾选「静音时不发送音频（节省识别费用）」**（见下方 P1 的端点问题）。勾选同意，点「开始：选择会议标签页」。
4. Chrome 弹窗里切到「Chrome 标签页」，选 Meet 所在的标签页。不要选「窗口」或「整个屏幕」，否则会报「没有捕获到会议声音」。确认弹窗底部的音频开关是打开的（App 内的提示叫「同时分享标签页音频」）。
5. **戴耳机**，否则对方的声音会被麦克风再采集一遍。
6. 需要时点「画中画提词器」；想主动要建议时点「立即建议」。

**会中禁忌**：
- **不要点 Chrome 顶部的「停止共享」**，也不要关掉 Meet 标签页：Copilot 这场会议会立即结束。
- **会中绝不 `git pull`、绝不改 `.env` 或代码**：`npm run dev` 是 tsx watch 加 Vite HMR，服务端一重启，当前会议的逐字稿和上下文就没了。
- 如果字幕突然停了，或顶部出现「语音识别出错」：点「结束会议」→「新会议」，马上重开一场（会打开新的识别流；见 P1）。

**会后**：先点「**下载录音**」，再点「新会议」或关页面。录音只存在内存里，历史记录不保存音频。逐字稿可以用「导出逐字稿」保存，纪要会自动存进本机历史。

**热修规则**：只在**会议开始前**（11:45 SGT 前）让用户更新代码，修复必须推到用户正在跟踪的分支（见第 2 节）。

**会前风险排查的来源**：原会话交接时，会前风险排查还没跑完。已完成"Soniox 实时链路""Claude 调用参数"两个方向（上面的第 4、5、6 条和 P1 的前两项来自这里），"macOS Chrome 标签页音频采集""macOS 安装配置"两个方向的结果没有取回。这些结论**尚未经过对抗式复核**。时间允许的话，复查后两个方向。

### P1 — 实时链路的可靠性（会后第一件事）

**① Soniox 端点与 VAD 冲突（高优先级，尚未复核）**
- 现象：客户端 VAD 在说话结束 1.5 s 后停止发送音频（`src/shared/vad.ts:34` 的 `hangoverFrames ?? 15`）。但 Soniox 默认要等约 2 s 才发 `<end>`：配置里没设 `max_endpoint_delay_ms`，代码也从不发送 `{"type":"finalize"}`（`src/server/stt/soniox.ts:135` 附近）。
- 后果：对方说完一句话后如果停下来，这句可能一直不定稿，直到他再开口。翻译（只处理定稿）和建议触发（只看定稿）就会延迟甚至缺失。
- 修法（任选一种，需要用真密钥验证，并补测试）：
  - 在 Soniox 配置里加 `max_endpoint_delay_ms: 1000`（取值范围 500–3000）；
  - 或在 VAD 关闭发送前发一次 `{"type":"finalize"}`；
  - 或把拖尾加到 2.5 s 以上。
- 修好并验证之前，让用户关掉 VAD 开关。Soniox 按打开的流计费，关掉 VAD 基本不增加费用。

**② STT 断流不重连（已确认的真实缺口，两家适配器都有）**
- Soniox（`src/server/stt/soniox.ts`）：
  - 服务端关闭连接（网络抖动、服务端错误、单流时长上限）后，`close` 回调只清 keepalive（`soniox.ts:158`），不通知会话。
  - `write()` 只在 OPEN 时发送、CONNECTING 时排队，CLOSING/CLOSED 时直接丢弃音频（`soniox.ts:161-165`）。
- 会话（`src/server/session.ts`）：
  - `streamFor()` 只在 `streams` 里没有这一路时才 `open()`（`session.ts:301-315`），而 `streams` 只在会议结束的 `stopAudio()` 里清空。所以死流一直被缓存，**这一路字幕会无声无息地停止**。
  - `ingest()` 在写入前就调用了 `clocks[source].record()`（`session.ts:143`），被丢弃的音频仍计入 `AudioClock`。
- 界面报错情况：
  - 只有 Soniox 断开前发来带 `error_code` 的 JSON 时，才会显示一条「语音识别出错 (…)」，而且不会恢复。
  - 连接建立后的网络中断，以及正常 close，在 ws 8.22 里都不触发 `error` 事件，**界面完全没有提示**。
- Deepgram（`src/server/stt/deepgram.ts`）有同样的缺口：
  - `close` 回调只清 keepalive（`:157`），`write()` 同样静默丢弃（`:160-164`），close 的 code 和 reason 都不读。
  - 握手被拒（密钥错误、余额不足）时，`unexpected-response` 只报一次错（`:153-155`）。因为注册了这个监听器，ws 不会中止握手，socket 一直停在 CONNECTING：排满 100 帧后开始丢弃，keepalive 定时器要到会议结束才清。
- 修法：
  - 两个适配器在非主动关闭时都通知会话（比如新增 `onClose`）；Deepgram 在 `unexpected-response` 里调用 `socket.terminate()`。
  - 会话把该路流从 `streams` 删掉，下一帧音频时自动开新流，并为该路**重建 `AudioClock`**（新流的时间戳从 0 开始）。
  - 未定稿的部分结果要定稿或丢弃，避免界面残留。
  - 加指数退避，避免密钥错误时死循环重连；界面提示"语音识别已重连"。
  - 补单元测试：模拟服务端关闭 → 打开新流 → 时间轴连续。

**③ 小的加固项**（来自风险排查，尚未复核）：
- `src/server/ai/summarizer.ts:42` 提取会议结果时 `maxTokens: 8_000`。thinking 也计入这个上限，长会议可能报「response was cut off (max_tokens)」。建议改为 `16_000`。
- `src/server/llm/anthropic.ts` 的 `documentBlocks(...)`：过滤掉不以 `file_` 开头的文档 id（mock 模式留下的 `local_…`），避免整场会议的 AI 请求都报 400。

### P2 — 会前一键自检
在界面里一键检查：
- 麦克风电平；
- 标签页音频里是否真的有声音；
- STT 和 Claude 的密钥是否真实可用（发一个最小请求）；
- 首字延迟。

结果给出可操作的中文提示。这样第 5 节和 P0 里那些"密钥已填但无效""shell 变量覆盖 .env"的坑，都能在界面上直接发现。

### P3 — 小修与 `PLAN.md` 中未勾选的项
- `npm start` 跨平台；
- 部分结果投机触发；
- 真实会议评测基线；
- 代码签名与自动更新；
- macOS 系统声音的真机验证；
- OAuth 日历、逐人音轨、CRM 集成。

### P4 — Phase 4b 企业化（见 `PLAN.md` §8）
- 团队知识库与检索；
- 账号与云端同步（默认仍本地优先）；
- SSO、审计、数据保留；
- 国内部署（适配国内模型与语音识别）；
- 跨会议分析。

## 8. 上线方案（用户问过，结论如下）

现在没有线上测试地址。可选方案：
1. **本机运行**（今天就用这个）：`npm run dev`，只有本机能用。
2. **临时公网地址**：先 `npm run build && npm start`，再用 `cloudflared tunnel --url http://localhost:8790` 暴露出去，几分钟就能拿到 https 地址。
   - **务必在 `.env` 里设置 `ACCESS_TOKEN`**，否则拿到地址的人都能消耗你的额度。
   - 不要用隧道直接暴露 Vite 的 5180 端口。
   - 机器人模式需要把这个地址填进 `PUBLIC_URL`。
3. **正式部署**：一台有公网 IP 的 VPS 加一个域名，按第 5 节的 Docker 步骤部署（Caddy 自动 HTTPS）。
4. **桌面版**：`npm run desktop:package` 打出未签名的 dmg 或 exe，可配合 Zoom、Teams、腾讯会议的桌面客户端使用（采集系统声音）。

**共享与机器人的前提条件**：
- 只读共享链接是用当前页面地址拼出来的（`SharePanel.tsx:13`）。在 `npm run dev` 下就是 `http://localhost:5180/?view=watch&share=…`，**只有本机能打开**。要给同事看，必须用方案 2 或 3。
- 「会议机器人（自动入会）」按钮只有在配置了 `ATTENDEE_API_KEY`、且 `PUBLIC_URL` 是 https 地址时才会出现。看不到按钮时，查 `/health` 里的 `bot.reason`。
- 今天的会议用不到共享和机器人。

## 9. 改代码时的速查

| 想改什么 | 去哪里 |
|---|---|
| 提示词（翻译 / 建议 / 纪要 / 简报 / 会议结果） | `src/server/ai/prompts.ts` 及同目录各角色文件 |
| 何时触发建议（问句、异议、冷却） | `src/server/triggers.ts`、`src/shared/questions.ts` |
| 会议编排（音频 → STT → 翻译 / 建议 / 纪要） | `src/server/session.ts` |
| STT 适配器 | `src/server/stt/soniox.ts`、`deepgram.ts`、`index.ts` |
| HTTP / WebSocket 路由、鉴权、限流、安全头 | `src/server/app.ts` |
| 环境变量 | `src/server/config.ts` + `.env.example` + README + 本文件第 5 节 |
| 前后端消息协议 | `src/shared/protocol.ts`；观看页放行规则在 `src/server/share.ts` 的 `forViewers()` |
| 前端状态与界面 | 状态 `src/web/state/reducer.ts`；主界面 `src/web/App.tsx`；设置 `src/web/components/SetupPanel.tsx` |
| 音频采集 | `src/web/audio/engine.ts`、`public/pcm-worklet.js` |
| VAD 与时钟 | `src/shared/vad.ts` |
| 桌面版 | `src/desktop/main.ts`、`preload.ts`、`settings.ts` |
| 费用与延迟指标 | `src/server/metrics.ts`；界面 `src/web/components/MetricsBar.tsx` |

## 10. 已知过时的文档（以代码为准，有空时顺手修）

- `PLAN.md:5`：应改为"Phase 0–4a 已交付"。
- `PLAN.md:41-42`、`PLAN.md:56`：音频帧格式应改为第 4 节写的 5 字节头格式。
- `PLAN.md:139`：去掉"本次"。
- `PLAN.md:118`、`PLAN.md:123`：改为已完成的表述（客户端 VAD、按会议的用量统计都已完成）。
- `PLAN.md:240`：代码地图补上 `docs/HANDOFF.md`。
- `README.md:186`：应改为"类型检查 + 构建前端（dist/）和服务端（dist-server/）"。
- `README.md:48`、`README.md:90`：「开始」应改为「开始：选择会议标签页」。
- README 的环境变量表：补上第 5 节列出的变量。
