/**
 * 配置加载与校验。零依赖。
 */
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULTS = Object.freeze({
  onebot: { ws: 'ws://127.0.0.1:3001', http: 'http://127.0.0.1:3000', accessToken: '', wsToken: '' },
  dsh: { baseUrl: '', token: '', autoDiscover: true },
  agentPreset: 'onebot-listen',
  workspace: { dir: './data/agents', title: 'OneBot Listen' },
  allow: { private: [] },
  listen: { enabled: true, maxMessages: 16 },
  data: { dir: './data' },
  mcp: { enabled: true }
});

function asString(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function asBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function asInteger(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 64);
}

/**
 * 解析并校验配置对象，缺失字段按默认值补齐。
 * 返回 { config, problems }：problems 非空时调用方应提示（但不中断）。
 */
export function normalizeConfig(raw = {}) {
  const problems = [];
  const onebot = {
    ws: asString(raw.onebot?.ws, DEFAULTS.onebot.ws),
    http: asString(raw.onebot?.http, DEFAULTS.onebot.http),
    accessToken: asString(raw.onebot?.accessToken, ''),
    wsToken: asString(raw.onebot?.wsToken, '')
  };
  if (!/^wss?:\/\//.test(onebot.ws)) problems.push('onebot.ws 必须是 ws:// 或 wss:// 地址');
  if (!/^https?:\/\//.test(onebot.http)) problems.push('onebot.http 必须是 http:// 或 https:// 地址');

  const dsh = {
    baseUrl: asString(raw.dsh?.baseUrl, ''),
    token: asString(raw.dsh?.token, ''),
    autoDiscover: asBoolean(raw.dsh?.autoDiscover, DEFAULTS.dsh.autoDiscover)
  };
  if (dsh.baseUrl && !/^https?:\/\//.test(dsh.baseUrl)) problems.push('dsh.baseUrl 格式无效');

  const listen = {
    enabled: asBoolean(raw.listen?.enabled, DEFAULTS.listen.enabled),
    maxMessages: asInteger(raw.listen?.maxMessages, DEFAULTS.listen.maxMessages, 1, 30)
  };

  const allowPrivate = asStringList(raw.allow?.private);
  if (allowPrivate.length === 0) {
    problems.push('allow.private 为空：没有任何人能和机器人对话（fail-closed）');
  }

  const config = {
    onebot,
    dsh,
    agentPreset: asString(raw.agentPreset, DEFAULTS.agentPreset),
    workspace: {
      dir: asString(raw.workspace?.dir, DEFAULTS.workspace.dir),
      title: asString(raw.workspace?.title, DEFAULTS.workspace.title)
    },
    allow: { private: allowPrivate },
    listen,
    data: { dir: asString(raw.data?.dir, DEFAULTS.data.dir) },
    mcp: { enabled: asBoolean(raw.mcp?.enabled, DEFAULTS.mcp.enabled) }
  };
  return { config, problems };
}

/**
 * 从磁盘加载 config.json。文件不存在时返回 null（调用方决定是否从模板生成）。
 */
export function loadConfig(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { config: null, problems: ['配置文件不存在: ' + file] };
  }
  const cleaned = text.replace(/^\uFEFF/, '');
  let raw;
  try {
    raw = JSON.parse(cleaned);
  } catch (error) {
    return { config: null, problems: [`config.json 不是合法 JSON：${error?.message ?? error}`] };
  }
  const result = normalizeConfig(raw);
  result.file = path.resolve(file);
  return result;
}

/** 把包根目录作为基准，解析相对路径。 */
export function resolveAgainst(file, rel) {
  if (path.isAbsolute(rel)) return rel;
  return path.resolve(path.dirname(file), rel);
}
