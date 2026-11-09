/**
 * 持久化状态：会话映射 + 每会话最近消息 + 会话令牌。
 * 与 MCP 进程共享同一份 JSON 文件（MCP 只读）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RECENT_LIMIT = 200;

export function newAgentToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function emptyState() {
  return { sessions: {}, conversations: {} };
}

export function loadState(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(text);
    const state = emptyState();
    if (parsed && typeof parsed === 'object') {
      if (parsed.sessions && typeof parsed.sessions === 'object') state.sessions = parsed.sessions;
      if (parsed.conversations && typeof parsed.conversations === 'object') state.conversations = parsed.conversations;
    }
    return state;
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** 取（或创建）一个会话的状态，保证有 agentToken。 */
export function ensureConversation(state, key) {
  const st = state.conversations[key] ?? {};
  if (!Array.isArray(st.recentMessages)) st.recentMessages = [];
  if (!st.agentToken) st.agentToken = newAgentToken();
  state.conversations[key] = st;
  return st;
}

/** 追加一条消息到会话最近列表，带截断。 */
export function pushMessage(st, message) {
  st.recentMessages.push(message);
  if (st.recentMessages.length > RECENT_LIMIT) {
    st.recentMessages.splice(0, st.recentMessages.length - RECENT_LIMIT);
  }
}

/** token 是否属于某个活跃会话（供 MCP 校验调用方身份）。 */
export function keyForToken(state, token) {
  if (typeof token !== 'string' || !token) return null;
  for (const [key, st] of Object.entries(state.conversations ?? {})) {
    if (st?.agentToken === token) return key;
  }
  return null;
}

/** 是否命中任一活跃会话令牌。 */
export function isLiveToken(state, token) {
  return keyForToken(state, token) !== null;
}

/**
 * 合并 outbox（MCP 进程写入的已发送消息）进对应会话的最近消息。
 * MCP 与桥接是两个进程，用独立文件避免并发写坏 state.json。
 */
export function mergeOutbox(state, outboxFile) {
  let lines;
  try {
    lines = fs.readFileSync(outboxFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    return 0;
  }
  if (!lines.length) return 0;
  let merged = 0;
  const now = Date.now();
  for (const raw of lines) {
    try {
      const entry = JSON.parse(raw);
      const st = ensureConversation(state, String(entry.key));
      pushMessage(st, {
        sender: '我',
        text: String(entry.text ?? '').slice(0, 500),
        time: Number(entry.time) || now,
        isSelf: true
      });
      merged += 1;
    } catch {
      // 丢弃坏行
    }
  }
  try {
    fs.truncateSync(outboxFile, 0);
  } catch {
    // 截断失败下次会重放，可接受
  }
  return merged;
}

/** 从一段 OneBot message 数组取纯文本。 */
export function textFromOneBotMessage(message) {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message
    .map((seg) => {
      if (!seg) return '';
      if (seg.type === 'text') return String(seg.data?.text ?? '');
      if (seg.type === 'image') return '[图片]';
      if (seg.type === 'face') return '[表情]';
      if (seg.type === 'at') return `@${seg.data?.qq ?? ''}`;
      return `[${seg.type}]`;
    })
    .join('')
    .trim();
}
