import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadState, saveState, ensureConversation, pushMessage, mergeOutbox,
  keyForToken, isLiveToken, textFromOneBotMessage, newAgentToken, RECENT_LIMIT
} from '../src/state.mjs';

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'listen-state-'));
}

test('ensureConversation 发放稳定 token', () => {
  const state = loadState(path.join(tmp(), 'nope.json'));
  const st = ensureConversation(state, 'private:123');
  assert.equal(st.agentToken.length, 48);
  assert.equal(ensureConversation(state, 'private:123').agentToken, st.agentToken);
});

test('keyForToken 反查', () => {
  const state = loadState(path.join(tmp(), 'nope.json'));
  const st = ensureConversation(state, 'private:123');
  assert.equal(keyForToken(state, st.agentToken), 'private:123');
  assert.equal(isLiveToken(state, st.agentToken), true);
  assert.equal(keyForToken(state, 'bad'), null);
});

test('pushMessage 截断到 RECENT_LIMIT', () => {
  const state = loadState(path.join(tmp(), 'nope.json'));
  const st = ensureConversation(state, 'private:123');
  for (let i = 0; i < RECENT_LIMIT + 50; i++) pushMessage(st, { sender: 'x', text: String(i) });
  assert.equal(st.recentMessages.length, RECENT_LIMIT);
  assert.equal(st.recentMessages[0].text, '50');
});

test('mergeOutbox 把发送记录并进会话并清空 outbox', () => {
  const dir = tmp();
  const outbox = path.join(dir, 'outbox.json');
  fs.writeFileSync(outbox, [
    JSON.stringify({ key: 'private:123', text: '你好', time: 1000 }),
    JSON.stringify({ key: 'private:123', text: '在吗', time: 2000 }),
    '坏行'
  ].join('\n'));
  const state = loadState(path.join(dir, 'state.json'));
  const merged = mergeOutbox(state, outbox);
  assert.equal(merged, 2);
  const st = state.conversations['private:123'];
  assert.equal(st.recentMessages.length, 2);
  assert.ok(st.recentMessages.every((m) => m.isSelf === true));
  assert.equal(fs.readFileSync(outbox, 'utf8'), '');
});

test('textFromOneBotMessage 各种段', () => {
  assert.equal(textFromOneBotMessage('纯文本'), '纯文本');
  assert.equal(
    textFromOneBotMessage([
      { type: 'text', data: { text: '你好' } },
      { type: 'image', data: {} },
      { type: 'at', data: { qq: '123' } }
    ]),
    '你好[图片]@123'
  );
  assert.equal(textFromOneBotMessage([]), '');
});

test('save/load 往返', () => {
  const file = path.join(tmp(), 'state.json');
  const state = loadState(file);
  ensureConversation(state, 'private:1');
  saveState(file, state);
  const again = loadState(file);
  assert.equal(again.conversations['private:1'].agentToken, state.conversations['private:1'].agentToken);
});

test('token 格式为 48 位十六进制', () => {
  assert.match(newAgentToken(), /^[0-9a-f]{48}$/);
});
