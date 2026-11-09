/**
 * 唤醒提示组装：
 *  - 【会话令牌】：模型调用工具时必须携带
 *  - 【本次消息】：刚收到的消息快照
 *  - 【旁听】：其他私聊会话的最近消息（由 src/listen.mjs 生成）
 * 零依赖。
 */
import { formatCrossListen } from './listen.mjs';

const SNAPSHOT_LIMIT = 12;

function senderOf(m) {
  return m?.isSelf ? '我' : (m?.sender || '对方');
}

function bodyOf(m) {
  return String(m?.text ?? m?.plain ?? '').replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * @param {object} args
 * @param {string} args.key - 当前会话 key（private:<QQ号>）
 * @param {object} args.st - 该会话状态（recentMessages / agentToken）
 * @param {Map|object} args.conversations - 全部会话状态（旁听遍历）
 * @param {object} args.listenCfg - { enabled, maxMessages }
 * @param {(ms:number)=>string} [args.clock]
 * @param {(line:string)=>void} [args.logger]
 */
export function buildWakePrompt({ key, st, conversations, listenCfg = {}, clock, logger }) {
  const tokenLine = `【会话令牌】${st.agentToken}（调用任何 mcp__onebot-listen__* 工具都必须带这个 token）\n\n`;
  const recent = Array.isArray(st.recentMessages) ? st.recentMessages.slice(-SNAPSHOT_LIMIT) : [];
  const snapshot = recent.length
    ? `【本次消息】\n${recent.map((m) => `${senderOf(m)}：${bodyOf(m)}`).join('\n')}\n\n`
    : '';
  const listenBlock = formatCrossListen({
    key,
    conversations,
    ...listenCfg,
    clock,
    logger,
    header: '【旁听】',
    footer: `（旁听只是让你了解另一边的对话；你仍然只回复当前会话 ${key}，不要回复旁听里的内容，除非对方明确要求跨会话发送）`
  });
  return `${tokenLine}${snapshot}${listenBlock}【要求】请以聊天对象的身份自然回复当前会话 ${key}。文本输出不会自动发送到 QQ：发言必须调用 mcp__onebot-listen__qq_send_message（key 和 token 用上面的）。回复简短、口语化、不要 Markdown。没有可回的内容时可以只看不回。`;
}
