import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedPrivate, parsePrivateKey, safeFilename, safeDate, todayStr, timeStr
} from '../src/auth.mjs';

test('白名单 fail-closed', () => {
  assert.equal(allowedPrivate([], 123), false);
  assert.equal(allowedPrivate(['123'], 123), true);
  assert.equal(allowedPrivate(['123'], '123'), true);
  assert.equal(allowedPrivate(['123'], 456), false);
});

test('private key 解析', () => {
  assert.equal(parsePrivateKey('private:123'), '123');
  assert.equal(parsePrivateKey('group:123'), null);
  assert.equal(parsePrivateKey('private:abc'), null);
  assert.equal(parsePrivateKey(''), null);
});

test('文件名安全', () => {
  assert.equal(safeFilename('global.md'), 'global.md');
  assert.equal(safeFilename('友-123.md'), '友-123.md');
  assert.equal(safeFilename('../etc'), null);
  assert.equal(safeFilename('..'), null);
  assert.equal(safeFilename('a/b.md'), null);
  assert.equal(safeFilename('a\\b.md'), null);
  assert.equal(safeFilename(''), null);
});

test('日期校验', () => {
  assert.equal(safeDate('2026-11-08'), '2026-11-08');
  assert.equal(safeDate('2026-13-08'), null);
  assert.equal(safeDate('2026/11/08'), null);
  assert.equal(safeDate(''), null);
});

test('今天与时间格式', () => {
  assert.match(todayStr(new Date('2026-11-08T10:00:00')), /^2026-11-08$/);
  assert.match(timeStr(new Date('2026-11-08T09:05:00')), /^09:05$/);
});
