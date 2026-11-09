/**
 * 白名单与文件路径安全。零依赖。
 */

/** 数字/字符串 QQ 号是否在白名单内。白名单为空 = 一律拒绝（fail-closed）。 */
export function allowedPrivate(list, userId) {
  const s = String(userId).trim();
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.map(String).includes(s);
}

/** 会话 key 只接受 private:<数字>（本包只服务私聊）。 */
export function parsePrivateKey(key) {
  const m = /^private:(\d{1,20})$/.exec(String(key ?? ''));
  return m ? m[1] : null;
}

const SAFE_NAME = /^[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]{0,119}$/u;

/** 文件名校验：拒绝路径穿越与非法字符。 */
export function safeFilename(name) {
  const s = String(name ?? '').trim();
  if (!SAFE_NAME.test(s)) return null;
  if (s === '.' || s === '..') return null;
  if (/[\\/:*?"<>|]/.test(s)) return null;
  return s;
}

/** 日期字符串：只接受 YYYY-MM-DD。 */
export function safeDate(str) {
  const s = String(str ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/** 本地日期 YYYY-MM-DD（Asia/Shanghai 通常靠系统时区）。 */
export function todayStr(now = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 时间戳 HH:mm。 */
export function timeStr(ms) {
  const d = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
