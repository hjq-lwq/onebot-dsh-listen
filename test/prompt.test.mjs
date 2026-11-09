import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWakePrompt } from '../src/prompt.mjs';

const st = {
  agentToken: 'abc123',
  recentMessages: [
    { sender: '对方', text: '在吗', time: 1000 },
    { sender: '我', text: '在', time: 2000, isSelf: true }
  ]
};

test('提示包含令牌、消息快照与发送要求', () => {
  const out = buildWakePrompt({ key: 'private:123', st, conversations: new Map(), listenCfg: {} });
  assert.match(out, /【会话令牌】abc123/);
  assert.match(out, /对方：在吗/);
  assert.match(out, /我：在/);
  assert.match(out, /mcp__onebot-listen__qq_send_message/);
});

test('旁听注入另一会话', () => {
  const conversations = new Map([
    ['private:123', st],
    ['private:456', { recentMessages: [{ sender: '对方', text: '另一边的话', time: 3000 }] }]
  ]);
  const out = buildWakePrompt({
    key: 'private:123',
    st,
    conversations,
    listenCfg: { enabled: true, maxMessages: 8 },
    clock: () => '12:00:00'
  });
  assert.match(out, /【旁听】另一个会话 private:456 最近 1 条/);
  assert.match(out, /另一边的话/);
  assert.match(out, /仍然只回复当前会话 private:123/);
});

test('旁听关闭时不出现', () => {
  const conversations = new Map([
    ['private:123', st],
    ['private:456', { recentMessages: [{ sender: '对方', text: 'x', time: 3000 }] }]
  ]);
  const out = buildWakePrompt({
    key: 'private:123',
    st,
    conversations,
    listenCfg: { enabled: false }
  });
  assert.doesNotMatch(out, /【旁听】/);
});
