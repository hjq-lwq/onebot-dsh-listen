/**
 * stdio MCP 服务器：DSH 通过它调用
 *   qq_send_message / qq_get_recent_messages / qq_status
 * 所有工具都要求携带会话令牌（【会话令牌】），防止越权。
 * 配置路径：环境变量 ONE_BOT_LISTEN_CONFIG（绝对路径），否则 ./config.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig, resolveAgainst } from './config.mjs';
import { loadState, keyForToken } from './state.mjs';
import { allowedPrivate, parsePrivateKey } from './auth.mjs';
import { sendPrivateMessage } from './onebot.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function configPath() {
  return process.env.ONE_BOT_LISTEN_CONFIG
    || path.resolve(PACKAGE_ROOT, 'config.json');
}

function boot() {
  const { config, problems, file } = loadConfig(configPath());
  if (!config) {
    throw new Error(problems.join('；'));
  }
  const dataDir = resolveAgainst(file, config.data.dir);
  const stateFile = resolveAgainst(file, path.join(dataDir, 'state.json'));
  const outboxFile = resolveAgainst(file, path.join(dataDir, 'outbox.json'));
  fs.mkdirSync(dataDir, { recursive: true });
  return { config, file, dataDir, stateFile, outboxFile };
}

function state() {
  return loadState(boot().stateFile);
}

/** 会话工具：token 必须等于目标会话自己的 token。 */
function requireSessionToken(key, token) {
  const owner = keyForToken(state(), token);
  if (owner !== key) {
    throw new Error('会话令牌与目标会话不匹配');
  }
}

/** 全局工具：任一活跃会话令牌即可。 */
function requireAnyToken(token) {
  if (!keyForToken(state(), token)) {
    throw new Error('会话令牌无效');
  }
}

function toolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function toolError(error) {
  return { content: [{ type: 'text', text: `失败：${error?.message ?? error}` }], isError: true };
}

async function main() {
  const { config, dataDir, stateFile, outboxFile } = boot();
  const server = new McpServer({ name: 'onebot-listen', version: '0.1.0' });

  server.tool(
    'qq_send_message',
    '向指定会话发送一条或多条 QQ 私聊消息。必须携带提示中的【会话令牌】。',
    {
      key: z.string().describe('会话 key，格式 private:QQ号'),
      token: z.string().describe('会话令牌（见唤醒提示中的【会话令牌】）'),
      messages: z.union([z.string(), z.array(z.string()).min(1)]).describe('要发送的内容'),
      cross: z.boolean().optional().describe('跨会话主动发送时显式传 true')
    },
    async ({ key, token, messages, cross }) => {
      try {
        const uid = parsePrivateKey(key);
        if (!uid) return toolError(new Error('key 格式应为 private:QQ号'));
        const st = state();
        if (cross === true) {
          if (!keyForToken(st, token)) return toolError(new Error('会话令牌无效'));
          if (!allowedPrivate(config.allow.private, uid)) return toolError(new Error('目标不在白名单内'));
        } else {
          requireSessionToken(key, token);
        }
        const list = Array.isArray(messages) ? messages : [messages];
        const results = [];
        for (const text of list) {
          const sent = await sendPrivateMessage({
            http: config.onebot.http,
            accessToken: config.onebot.accessToken,
            userId: uid,
            text
          });
          if (sent.ok) {
            fs.appendFileSync(outboxFile, JSON.stringify({ key, text, time: Date.now() }) + '\n', 'utf8');
          }
          results.push(sent);
        }
        return toolResult({ sent: results });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    'qq_get_recent_messages',
    '查看当前会话的最近消息。',
    {
      key: z.string().describe('会话 key，格式 private:QQ号'),
      token: z.string().describe('会话令牌'),
      limit: z.number().optional().describe('最多返回条数，默认 20')
    },
    async ({ key, token, limit }) => {
      try {
        requireSessionToken(key, token);
        const st = state();
        const conv = st.conversations[key] ?? { recentMessages: [] };
        const count = Math.min(50, Math.max(1, Number(limit) || 20));
        const list = (conv.recentMessages ?? []).slice(-count).map((m) => ({
          sender: m.isSelf ? '我' : (m.sender || '对方'),
          text: m.text ?? m.plain ?? '',
          time: m.time ?? null
        }));
        return toolResult({ key, recent: list });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.tool(
    'qq_status',
    '查看本服务状态：白名单、旁听配置、已知会话。',
    { token: z.string().describe('会话令牌') },
    async ({ token }) => {
      try {
        requireAnyToken(token);
        return toolResult({
          allow: { private: config.allow.private },
          listen: config.listen,
          sessions: Object.keys(state().sessions)
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[onebot-listen mcp] 已启动，state=${stateFile}`);
}

main().catch((error) => {
  console.error(`[onebot-listen mcp] 启动失败：${error?.message ?? error}`);
  process.exit(1);
});
