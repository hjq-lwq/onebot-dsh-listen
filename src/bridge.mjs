/**
 * 主循环：OneBot 消息 → 会话映射 → 唤醒提示 → DSH → （模型经 MCP 工具回复）
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveAgainst } from './config.mjs';
import { connectOneBot, sendPrivateMessage } from './onebot.mjs';
import { makeDshApi } from './dsh.mjs';
import {
  loadState, saveState, ensureConversation, pushMessage, mergeOutbox, textFromOneBotMessage
} from './state.mjs';
import { allowedPrivate } from './auth.mjs';
import { buildWakePrompt } from './prompt.mjs';

const log = (...args) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...args);

function main() {
  const configFile = process.argv[2] || path.resolve(process.cwd(), 'config.json');
  const { config, problems, file } = loadConfig(configFile);
  if (!config) {
    console.error('[onebot-dsh-listen] 配置错误：' + problems.join('；'));
    process.exit(1);
  }
  if (problems.length) log('配置提醒：' + problems.join('；'));

  const dataDir = resolveAgainst(file, config.data.dir);
  const stateFile = path.join(dataDir, 'state.json');
  const outboxFile = path.join(dataDir, 'outbox.json');
  fs.mkdirSync(dataDir, { recursive: true });

  const state = loadState(stateFile);
  const persist = () => saveState(stateFile, state);

  const dsh = makeDshApi({
    baseUrl: config.dsh.baseUrl,
    token: config.dsh.token,
    autoDiscover: config.dsh.autoDiscover,
    agentPreset: config.agentPreset,
    workspaceDir: resolveAgainst(file, config.workspace.dir)
  });
  log(`DSH 已连接：${dsh.baseUrl}（preset ${config.agentPreset || '无'}）`);

  const sessionCache = new Map();

  async function handlePrivate(msg) {
    const userId = String(msg.userId ?? '');
    if (!allowedPrivate(config.allow.private, userId)) {
      log(`忽略未授权私聊 ${userId}`);
      return;
    }
    const key = `private:${userId}`;
    const st = ensureConversation(state, key);
    mergeOutbox(state, outboxFile);

    const text = textFromOneBotMessage(msg.message);
    if (!text) return;
    pushMessage(st, { sender: '对方', text: text.slice(0, 500), time: Date.now() });
    persist();

    let sessionId = state.sessions[key] || sessionCache.get(key);
    if (!sessionId) {
      sessionId = await dsh.ensureSession(key);
      state.sessions[key] = sessionId;
      sessionCache.set(key, sessionId);
      persist();
      log(`会话 ${key} → ${sessionId}`);
    }

    const prompt = buildWakePrompt({
      key,
      st,
      conversations: state.conversations,
      listenCfg: config.listen,
      clock: (ms) => new Date(ms).toTimeString().slice(0, 8),
      logger: (line) => log(line)
    });

    try {
      await dsh.prompt(sessionId, prompt);
      log(`已投递 ${key}：${text.slice(0, 40)}`);
    } catch (error) {
      log(`投递失败 ${key}：${error?.message ?? error}`);
      try {
        await sendPrivateMessage({
          http: config.onebot.http,
          accessToken: config.onebot.accessToken,
          userId,
          text: '⚠️ 服务端暂时没响应，稍后再试。'
        });
      } catch {
        // 忽略
      }
    }
  }

  const conn = connectOneBot({
    ws: config.onebot.ws,
    wsToken: config.onebot.wsToken,
    onPrivateMessage: (msg) => {
      handlePrivate(msg).catch((error) => log(`处理消息出错：${error?.message ?? error}`));
    },
    onStatus: (s) => log('OneBot', s.state, s.message || '', s.delayMs ? `(${s.delayMs}ms 后重连)` : '')
  });

  log('旁听', config.listen.enabled ? `开启（${config.listen.maxMessages} 条）` : '关闭');
  log('白名单', config.allow.private.join(', '));

  process.on('SIGINT', () => {
    conn.close();
    persist();
    process.exit(0);
  });
}

main();
