/**
 * OneBot v11 客户端：WS 事件接收（自动重连）+ HTTP 发送。
 * 只依赖 Node ≥22 内置 WebSocket 与 fetch，零第三方库。
 */

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function connectOneBot({ ws, wsToken = '', onPrivateMessage, onStatus = () => {} }) {
  let closed = false;
  let retry = 0;
  let socket = null;
  let heartbeatTimer = null;

  // OneBot v11 标准：WS 鉴权可用 ?access_token= 查询参数（Node 内置 WebSocket 不能自定义 header）
  const wsUrl = (() => {
    if (!wsToken) return ws;
    const u = new URL(ws);
    u.searchParams.set('access_token', wsToken);
    return u.toString();
  })();

  function scheduleReconnect() {
    if (closed) return;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** retry);
    retry += 1;
    onStatus({ state: 'reconnecting', delayMs: delay });
    setTimeout(open, delay);
  }

  function open() {
    if (closed) return;
    onStatus({ state: 'connecting', url: ws });
    let s;
    try {
      s = new WebSocket(wsUrl);
    } catch (error) {
      onStatus({ state: 'error', message: error?.message ?? String(error) });
      scheduleReconnect();
      return;
    }
    socket = s;
    s.addEventListener('open', () => {
      retry = 0;
      onStatus({ state: 'connected' });
      // OneBot v11 约定：每 5s 一次心跳（部分实现可选，发错不会致命）
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        try {
          s.send(JSON.stringify({ action: '.handle_quick_operation', params: {} }));
        } catch {
          // 心跳失败由 close 事件兜底
        }
      }, 5000);
    });
    s.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(String(event.data ?? ''));
      } catch {
        return;
      }
      if (data?.post_type === 'meta_event') return;
      if (data?.post_type === 'message' && data?.message_type === 'private') {
        onPrivateMessage({
          userId: String(data.user_id ?? ''),
          message: data.message ?? '',
          rawMessage: data.raw_message ?? '',
          messageId: data.message_id ?? null,
          sender: data.sender ?? {},
          time: data.time ?? Date.now() / 1000
        });
      }
    });
    s.addEventListener('close', () => {
      clearInterval(heartbeatTimer);
      onStatus({ state: 'disconnected' });
      scheduleReconnect();
    });
    s.addEventListener('error', () => {
      // close 事件随后会触发重连
    });
  }

  open();

  return {
    close() {
      closed = true;
      clearInterval(heartbeatTimer);
      try {
        socket?.close();
      } catch {
        // 忽略
      }
    }
  };
}

/** 通过 OneBot HTTP 发一条私聊文本。返回 { ok, messageId?, error? }。 */
export async function sendPrivateMessage({ http, accessToken, userId, text }) {
  const body = JSON.stringify({
    user_id: Number(userId),
    message: [{ type: 'text', data: { text: String(text) } }]
  });
  const headers = { 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(`${http.replace(/\/+$/, '')}/send_private_msg`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    return { ok: false, error: `OneBot HTTP 请求失败：${error?.message ?? error}` };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    // 非 JSON 响应
  }
  if (!res.ok) return { ok: false, error: `OneBot HTTP ${res.status}` };
  if (data?.status === 'ok' || data?.retcode === 0) {
    return { ok: true, messageId: data?.data?.message_id ?? null };
  }
  return { ok: false, error: data?.wording || data?.msg || '发送被 OneBot 拒绝' };
}
