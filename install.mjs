#!/usr/bin/env node
/**
 * 安装器：
 *   1. 从 config.example.json 生成 config.json（可传参数覆盖）
 *   2. 建 data 目录
 *   3. 把 MCP 条目 + agent preset 插入 DSH profile 的 cordis.patch.yml（自动备份）
 *
 * 用法：
 *   node install.mjs [--profile desktop]
 *     [--onebot-ws ws://127.0.0.1:3001] [--onebot-http http://127.0.0.1:3000] [--onebot-token xxx]
 *     [--dsh-url http://127.0.0.1:3080] [--dsh-token xxx]
 *     [--allow 123456,654321]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const PACKAGE_ROOT = path.dirname(fileURLToPath(import.meta.url));

const log = (...args) => console.log(`[install]`, ...args);
const fatal = (...args) => { console.error(`[install]`, ...args); process.exit(1); };

function argValue(flags) {
  for (const flag of flags) {
    const i = process.argv.indexOf(flag);
    if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  }
  return '';
}

const PROFILE = argValue(['--profile']) || 'desktop';
if (PROFILE === '.' || PROFILE === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(PROFILE)) fatal('profile 名不合法');
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', PROFILE);
const PATCH_FILE = path.join(PROFILE_DIR, 'cordis.patch.yml');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// ── 1. 生成 config.json ─────────────────────────────────────────────
const example = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'config.example.json'), 'utf8'));
const allowArg = argValue(['--allow']).split(',').map((s) => s.trim()).filter(Boolean);
if (allowArg.length) example.allow.private = allowArg;
for (const [key, flags, target] of [
  ['onebot.ws', ['--onebot-ws'], example],
  ['onebot.http', ['--onebot-http'], example],
  ['onebot.accessToken', ['--onebot-token'], example],
  ['dsh.baseUrl', ['--dsh-url'], example],
  ['dsh.token', ['--dsh-token'], example]
]) {
  const v = argValue(flags);
  if (v) {
    const [a, b] = key.split('.');
    target[a][b] = v;
  }
}
const CONFIG_FILE = path.join(PACKAGE_ROOT, 'config.json');
if (fs.existsSync(CONFIG_FILE)) {
  fs.copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.bak-${Date.now()}`);
}
fs.writeFileSync(CONFIG_FILE, JSON.stringify(example, null, 2) + '\n', 'utf8');
log('已生成', CONFIG_FILE);

// ── 2. data 目录 ────────────────────────────────────────────────────
for (const dir of ['data', 'data/agents']) {
  ensureDir(path.join(PACKAGE_ROOT, dir));
}
log('已建 data 目录');

// ── 3. cordis.patch.yml ─────────────────────────────────────────────
if (!fs.existsSync(PATCH_FILE)) fatal(`找不到 DSH profile：${PATCH_FILE}`);
fs.copyFileSync(PATCH_FILE, `${PATCH_FILE}.bak-${Date.now()}`);
const doc = yaml.load(fs.readFileSync(PATCH_FILE, 'utf8').replace(/^\uFEFF/, '')) ?? [];
const entries = Array.isArray(doc) ? doc : fatal('cordis.patch.yml 顶层不是数组');

const mcpId = 'mcp-onebot-listen';
const presetId = 'preset-onebot-listen';

const nodeExe = process.execPath.replace(/\\/g, '/');
const mcpEntry = {
  insert: [{
    id: mcpId,
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: 'onebot-listen',
      transport: 'stdio',
      command: nodeExe,
      args: [path.join(PACKAGE_ROOT, 'src', 'mcp.mjs').replace(/\\/g, '/')],
      toolCallTimeoutMs: 725000
    }
  }]
};

const presetDoc = yaml.load(
  fs.readFileSync(path.join(PACKAGE_ROOT, 'preset', 'onebot-listen.patch.yml'), 'utf8')
);
const presetEntry = Array.isArray(presetDoc) && presetDoc[0] ? presetDoc[0] : null;
if (!presetEntry) fatal('预设文件解析失败');

function hasInsertId(list, id) {
  return list.some((entry) => Array.isArray(entry?.insert) && entry.insert.some((row) => row?.id === id));
}

let changed = false;
if (!hasInsertId(entries, mcpId)) { entries.push(mcpEntry); changed = true; log('已插入 MCP 条目', mcpId); }
else log('MCP 条目已存在，跳过', mcpId);
if (!hasInsertId(entries, presetId)) { entries.push(presetEntry); changed = true; log('已插入 agent preset', presetId); }
else log('agent preset 已存在，跳过', presetId);

if (changed) {
  fs.writeFileSync(PATCH_FILE, yaml.dump(entries, { lineWidth: 200 }) + '\n', 'utf8');
  log('已写回', PATCH_FILE);
}

log('完成。接下来：');
log('  1. 编辑 config.json（OneBot 地址/token、白名单）');
log(`  2. 启动：node ${path.join('src', 'bridge.mjs')}`);
log('  3. 重启 DSH（加载新 preset 与 MCP）');
