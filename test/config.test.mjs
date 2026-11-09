import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, loadConfig, resolveAgainst } from '../src/config.mjs';

test('默认值补齐', () => {
  const { config } = normalizeConfig({});
  assert.equal(config.onebot.ws, 'ws://127.0.0.1:3001');
  assert.equal(config.listen.maxMessages, 16);
  assert.equal(config.listen.enabled, true);
  assert.deepEqual(config.allow.private, []);
});

test('allow.private 为空时提示 fail-closed', () => {
  const { problems } = normalizeConfig({});
  assert.ok(problems.some((p) => p.includes('allow.private')));
});

test('非法地址被标记', () => {
  const { problems } = normalizeConfig({ onebot: { ws: 'http://x', http: 'ftp://y' } });
  assert.ok(problems.some((p) => p.includes('onebot.ws')));
  assert.ok(problems.some((p) => p.includes('onebot.http')));
});

test('maxMessages 收敛到 1..30', () => {
  assert.equal(normalizeConfig({ listen: { maxMessages: 999 } }).config.listen.maxMessages, 30);
  assert.equal(normalizeConfig({ listen: { maxMessages: 0 } }).config.listen.maxMessages, 1);
  assert.equal(normalizeConfig({ listen: { maxMessages: 'x' } }).config.listen.maxMessages, 16);
});

test('loadConfig 处理 BOM 与坏 JSON', () => {
  const dir = loadConfig(new URL('./fixtures/nonexistent.json', import.meta.url).pathname);
  assert.equal(dir.config, null);
});

test('resolveAgainst 相对与绝对路径', () => {
  const rel = resolveAgainst('C:/a/config.json', './data');
  assert.ok(rel.endsWith('a\\data') || rel.endsWith('a/data'));
  assert.equal(resolveAgainst('C:/a/config.json', 'D:/x'), 'D:/x');
});
