/**
 * DSH Host API 客户端（最小面）：
 *  - 发现 baseUrl / 启动 token（环境变量或 ~/.dsh/logs）
 *  - 会话创建 / 投递（复用 vendored-dsh-client.mjs，与生产桥接同一套客户端）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  NodeApiClient, unwrap, discoverDshLaunchToken, discoverDshSessionCookie, resolveDshHome
} from './vendored-dsh-client.mjs';

/** 从环境变量或 DSH 启动日志里找 baseUrl + token（成对出现）。 */
export function discoverDsh() {
  const fromEnvUrl = process.env.DSH_BASE_URL;
  const fromEnvToken = process.env.DSH_LAUNCH_TOKEN;
  if (fromEnvUrl && /^https?:\/\//.test(fromEnvUrl)) {
    return { baseUrl: fromEnvUrl, token: fromEnvToken || '' };
  }
  const home = resolveDshHome();
  const dirs = [path.join(home, 'logs'), path.join(home, 'guard', 'logs')];
  for (const dir of dirs) {
    let files;
    try {
      files = fs.readdirSync(dir)
        .filter((name) => /^server-.*\.(?:out\.)?log$/.test(name))
        .map((name) => ({ name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      continue;
    }
    for (const { name } of files) {
      try {
        const text = fs.readFileSync(path.join(dir, name), 'utf8');
        const match = text.match(/(https?:\/\/127\.0\.0\.1:\d+)\/?\?token=([A-Za-z0-9_-]+)/);
        if (match) return { baseUrl: match[1], token: match[2] };
      } catch {
        // 日志可能正被占用，继续找更早的
      }
    }
  }
  return { baseUrl: '', token: '' };
}

/**
 * Windows：按「最新 DSH 进程的监听端口」探测 baseUrl。
 * 与生产看门狗同一套逻辑：找 DeepSeek Harness.exe，枚举其监听端口，用 /api 探活。
 */
export function discoverDshPortWindows() {
  if (process.platform !== 'win32') return '';
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$procs = Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Sort-Object CreationDate -Descending",
    "foreach ($p in $procs) {",
    "  $ports = Get-NetTCPConnection -State Listen -OwningProcess $p.ProcessId -EA 0 | Select-Object -ExpandProperty LocalPort",
    "  foreach ($lp in $ports) {",
    "    $code = & curl.exe -s -o NUL -w '%{http_code}' --max-time 2 \"http://127.0.0.1:$lp/api\" 2>$null",
    "    if ($code -in @('200','401','403','404')) { Write-Output $lp; exit 0 }",
    "  }",
    "}",
    "exit 0"
  ].join('\n');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', timeout: 30000, windowsHide: true
    }).trim();
    const port = (out.match(/\d+/) || [])[0];
    return port ? `http://127.0.0.1:${port}` : '';
  } catch {
    return '';
  }
}

/**
 * 建立 DSH 客户端。
 * @param {{baseUrl?, token?, autoDiscover?, agentPreset?, workspaceDir?, workspaceTitle?}} opts
 */
export function makeDshApi(opts = {}) {
  let baseUrl = typeof opts.baseUrl === 'string' ? opts.baseUrl.trim() : '';
  let token = typeof opts.token === 'string' ? opts.token.trim() : '';
  if (!baseUrl && opts.autoDiscover !== false) {
    const found = discoverDsh();
    if (found.baseUrl) {
      baseUrl = found.baseUrl;
      if (!token) token = found.token;
    }
    if (!baseUrl) {
      const winPort = discoverDshPortWindows();
      if (winPort) baseUrl = winPort;
    }
  }
  if (!baseUrl) throw new Error('找不到 DSH：请在 config.json 的 dsh.baseUrl 填地址，或保持 dsh.autoDiscover 开启');
  if (!token) token = discoverDshLaunchToken();
  const api = new NodeApiClient(baseUrl, undefined, {
    token: token || undefined,
    tokenExplicit: Boolean(opts.token),
    allowRemote: false
  });

  async function ensureSession(key) {
    const dir = opts.workspaceDir || path.resolve('./data/agents');
    fs.mkdirSync(dir, { recursive: true });
    const wsValue = unwrap(await api.workspace.create({ path: dir }), 'workspace.create');
    const params = { workspaceId: wsValue.workspace.workspaceId };
    if (opts.agentPreset) params.agentPreset = opts.agentPreset;
    const value = unwrap(await api.sessions.create(params), 'session.create');
    try {
      api.events.follow(value.sessionId);
    } catch {
      // follow 失败不阻塞
    }
    return value.sessionId;
  }

  async function prompt(sessionId, text) {
    const response = await api.sessions.prompt({
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }]
    });
    if (response?.result?.ok === false) {
      const err = response.result.error;
      throw new Error(`投递失败：${err?.code ?? ''} ${err?.message ?? JSON.stringify(err ?? '')}`);
    }
    return response?.result?.value ?? response?.result;
  }

  return { baseUrl, token, api, ensureSession, prompt };
}
