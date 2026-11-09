# onebot-dsh-listen

> OneBot → DeepSeek Harness 的轻量桥接：**多会话 AI + 跨会话旁听**，下载就能用。
>
> A minimal OneBot → DeepSeek Harness bridge: one AI per chat, plus cross-session "eavesdropping".

## 它做什么

你有两个 QQ 私聊，想让**每个聊天里的 AI 都能看见另一个聊天说了什么**——不是消息转发，而是让 AI 的视野覆盖两个会话。

```
会话1    ⇄ 机器人（会话 A）
                ↕ 旁听：每次唤醒时附上对方最近 16 条原文
会话2   ⇄ 机器人（会话 B）
```

- **旁听**：A 会话的 AI 能看见 B 会话最近说了什么，反之亦然；**回复仍然只发给自己的会话**
- **安全**：白名单 + 每会话令牌，工具调用必须带令牌
- **不会串台**：发送侧按会话令牌硬绑定

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | ≥ 22（内置 WebSocket/fetch） |
| OneBot v11 实现 | SnowLuma、NapCat、Lagrange… 任意一个（提供 HTTP + 正向 WS） |
| DeepSeek Harness | 支持插件与 MCP 的 DSH |
| 一个 AI 账号 | DSH 里配置好模型即可（本包不内置模型） |

**不需要**：改 OneBot 实现、改 DSH 代码、额外 API key、数据库。

## 安装（三步）

```bash
git clone <你的仓库地址>
cd onebot-dsh-listen
npm install

npm run setup -- --allow 123456,654321        # 允许私聊的 QQ 号

node src/bridge.mjs
```

`npm run setup` 会：

1. 从 `config.example.json` 生成 `config.json`
2. 建 `data/` 目录（状态 / 会话工作区）
3. 把两条记录插入 `~/.dsh/profiles/<profile>/cordis.patch.yml`（自动备份）：
   - MCP 服务器 `onebot-listen`（工具前缀 `mcp__onebot-listen__*`）
   - agent preset `onebot-listen`（人格与安全规则）

**最后重启一次 DSH**，新 preset 与 MCP 才会加载。

## 配置（config.json）

| 字段 | 说明 |
|---|---|
| `onebot.ws` / `onebot.http` | OneBot 实现的正向 WS 与 HTTP 地址 |
| `onebot.accessToken` | OneBot HTTP 的 access token（无则留空） |
| `onebot.wsToken` | OneBot WS 的 token；部分实现（如 SnowLuma）WS 也要鉴权，会自动拼成 `?access_token=` |
| `dsh.baseUrl` / `dsh.token` | DSH 地址与启动 token；留空且 `autoDiscover: true` 时自动发现 |
| `agentPreset` | DSH 里的预设名，默认 `onebot-listen` |
| `allow.private` | 白名单 QQ 号；**为空 = 所有人被拒**（fail-closed） |
| `listen.enabled` / `listen.maxMessages` | 旁听开关与条数（1–30，默认 16） |
| `data.dir` | 状态数据目录（默认 `./data`） |

## 工作原理

```
OneBot 私聊消息（WS）
  → 白名单校验
  → 会话映射（每个 QQ 号一个 DSH 会话，自动创建）
  → 拼唤醒提示：会话令牌 + 消息快照 + 【旁听】其他会话最近 N 条
  → DSH 会话（AI 思考）
  → AI 调用 mcp__onebot-listen__qq_send_message（带令牌）→ OneBot HTTP 发出
```

AI 可选工具（全部要求令牌）：

| 工具 | 作用 |
|---|---|
| `qq_send_message` | 回复（跨会话发需 `cross=true`） |
| `qq_get_recent_messages` | 看当前会话最近消息 |
| `qq_status` | 看服务状态（含旁听配置） |

## 旁听长什么样

```
【旁听】另一个会话 private:123456 最近 16 条：
- 16:44:21 对方：这是在喝汽水
- 16:44:32 我：行，汽水，那杯子看着像咖啡杯
- 16:45:02 对方：笑死了

（旁听只是让你了解另一边的对话；你仍然只回复当前会话，
  不要回复旁听里的内容，除非对方明确要求跨会话发送）
```

实测 16 条约 300–500 字符，token 成本可以忽略。

## 常见问题

**Q：AI 不说话？**
检查顺序：白名单有没有这个号 → `node src/bridge.mjs` 的日志有没有「已投递」→ DSH 是否重启过 → DSH 会话是否创建成功。

**Q：OneBot 一直 connecting/disconnected？**
多半是 WS 也要鉴权：把实现的 WS token 填进 `onebot.wsToken`。

**Q：一边能旁听、一边不能？**
旁听在「拼新提示」时注入。会话卡在长回合时会复用旧提示，等回合结束即可；必要时删掉 `data/state.json` 里的 `sessions` 映射让它重建。

**Q：两个号会不会互相串台？**
不会。回复按会话令牌硬绑定，跨会话发送必须显式 `cross=true`。

## 安全边界

- 只有白名单里的 QQ 号能触发会话
- 每个会话有自己的令牌，MCP 工具校验令牌
- 人格预设禁止访问本地工具：模型只有 `mcp__onebot-listen__*`
- 旁听只读，不改变回复路由

## 开发

```bash
npm test        # node:test
```

## 相关项目

- [`onebot-dsh-diary`](https://github.com/) —— 同一套桥接的「日记」版本（两个包**不能同时运行**，都连同一个 OneBot）

## License

MIT
