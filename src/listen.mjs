/**
 * qq-cross-listen —— 旁听
 *
 * 把「另一个私聊会话」的最近消息原文，作为一段只读上下文注入当前会话的提示里。
 *
 * 设计背景：一个 QQ 号接一个独立会话时，上下文天然隔离。想「知道对方那边聊了什么」
 * 有两条路——合并会话（会因单会话串行而互相卡死）或旁听（保留独立会话，只共享可见性）。
 * 这个包只做后者：纯函数，不碰发送，不改回复路由。
 *
 * 关键性质：
 *   - 只读：输出的是提示文本，调用方决定怎么用；本包不发送任何消息。
 *   - 不越权：默认只旁听 private: 会话（群聊默认排除，避免跨群串味）。
 *   - 确定性：同一份输入永远产出同一段文本，方便测试与回放。
 */

/** 默认注入条数。 */
export const DEFAULT_MAX_MESSAGES = 16;
/** 条数上限，防止把提示撑爆。 */
export const MAX_MESSAGES_LIMIT = 30;
/** 单条消息截断长度。 */
export const DEFAULT_MAX_CHARS_PER_MESSAGE = 120;

/**
 * 把任意数值收敛到 [1, MAX_MESSAGES_LIMIT] 的整数。
 * 非法输入（NaN、0、负数、字符串）回退到 defaultMax。
 */
export function clampMaxMessages(value, defaultMax = DEFAULT_MAX_MESSAGES) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const d = Number(defaultMax);
    if (!Number.isFinite(d) || d <= 0) return DEFAULT_MAX_MESSAGES;
    return Math.min(MAX_MESSAGES_LIMIT, Math.max(1, Math.floor(d)));
  }
  return Math.min(MAX_MESSAGES_LIMIT, Math.max(1, Math.floor(n)));
}

/** 把 Map 或普通对象统一成 [key, value] 的数组。 */
function entriesOf(conversations) {
  if (!conversations) return [];
  if (conversations instanceof Map) return [...conversations.entries()];
  if (typeof conversations === 'object') return Object.entries(conversations);
  return [];
}

function defaultClock(ms) {
  const d = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 一条消息取哪个字段当正文（兼容 text / plain 两种存法）。 */
function messageBody(m) {
  return String(m?.text ?? m?.plain ?? '');
}

/** 这条消息是谁说的：自己 → 我，否则用发送者名字。 */
function speakerOf(m) {
  if (m?.isSelf) return '我';
  return String(m?.sender || '对方');
}

/**
 * 生成旁听段。
 *
 * @param {object} opts
 * @param {string} opts.key - 当前会话 key（例如 "private:123456"）
 * @param {Map|object} opts.conversations - 所有会话状态，形如 Map<key, {recentMessages: []}>
 * @param {boolean} [opts.enabled=true] - false 时直接返回空串
 * @param {number} [opts.maxMessages=16] - 每个其他会话带几条
 * @param {number} [opts.maxCharsPerMessage=120] - 每条正文截断长度
 * @param {boolean} [opts.includeGroups=false] - 是否也旁听群聊
 * @param {(ms:number)=>string} [opts.clock] - 时间格式化函数
 * @param {(line:string)=>void} [opts.logger] - 日志回调（可省略）
 * @param {string} [opts.header='【旁听】'] - 段落标题，便于本地化
 * @param {string} [opts.footer] - 段尾说明；传空串表示不要
 * @returns {string} 可直接拼进提示的文本；没有可旁听内容时返回空串
 */
export function formatCrossListen(opts = {}) {
  const {
    key = '',
    conversations = null,
    enabled = true,
    maxMessages = DEFAULT_MAX_MESSAGES,
    maxCharsPerMessage = DEFAULT_MAX_CHARS_PER_MESSAGE,
    includeGroups = false,
    clock = defaultClock,
    logger = null,
    header = '【旁听】',
    footer
  } = opts;

  const say = typeof logger === 'function' ? logger : null;

  if (enabled === false) {
    say?.(`[旁听] ${key} 已禁用`);
    return '';
  }

  const max = clampMaxMessages(maxMessages);
  const cap = Number.isFinite(Number(maxCharsPerMessage)) && Number(maxCharsPerMessage) > 0
    ? Math.floor(Number(maxCharsPerMessage))
    : DEFAULT_MAX_CHARS_PER_MESSAGE;
  const fmtTime = typeof clock === 'function' ? clock : defaultClock;

  const parts = [];
  let scanned = 0;

  for (const [otherKey, st] of entriesOf(conversations)) {
    scanned += 1;
    if (!otherKey || otherKey === key) continue;
    if (!includeGroups && !String(otherKey).startsWith('private:')) continue;

    const list = Array.isArray(st?.recentMessages) ? st.recentMessages : [];
    if (!list.length) continue;

    const tail = list
      .slice(-max)
      .map((m) => {
        const when = m?.time ? fmtTime(m.time) : '';
        const body = messageBody(m).replace(/\s+/g, ' ').slice(0, cap);
        const prefix = when ? `- ${when} ` : '- ';
        return `${prefix}${speakerOf(m)}：${body}`;
      })
      .join('\n');

    const count = Math.min(max, list.length);
    parts.push(`${header}另一个会话 ${otherKey} 最近 ${count} 条：\n${tail}`);
  }

  if (!parts.length) {
    say?.(`[旁听] ${key} 扫描 ${scanned} 个会话，命中 0`);
    return '';
  }

  say?.(`[旁听] ${key} 注入 ${parts.length} 个会话（共扫 ${scanned}）`);

  const tailNote = footer === undefined
    ? `（旁听内容只供你了解另一边的对话；你仍然只回复当前会话 ${key}，不要回复旁听里的内容，除非用户明确要求跨会话发送）\n\n`
    : (footer ? `${footer}\n\n` : '');

  return `${parts.join('\n\n')}\n${tailNote}`;
}

export default formatCrossListen;
