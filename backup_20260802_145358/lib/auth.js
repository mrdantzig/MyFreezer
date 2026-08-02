const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// 서버 재시작 시 초기화됨(프로토타입 범위) — 세션 영속화는 이후 단계에서 필요 시 추가.
// 로그아웃하지 않는 세션이 무한정 쌓여 메모리를 누수하지 않도록 발급 시각을 함께 저장하고
// 일정 기간이 지나면 만료시킨다.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일
const sessions = new Map(); // token -> { userId, createdAt }

function createSession(userId) {
  const token = crypto.randomUUID();
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function isExpired(entry) {
  return Date.now() - entry.createdAt > SESSION_TTL_MS;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const entry = token ? sessions.get(token) : null;
  if (!entry || isExpired(entry)) {
    if (entry) sessions.delete(token);
    return res.status(401).json({ success: false, error: "로그인이 필요합니다." });
  }
  req.userId = entry.userId;
  next();
}

// 만료된 세션이 로그아웃 없이도 결국 정리되도록 주기적으로 훑어서 제거한다.
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1시간마다
const sessionCleanupTimer = setInterval(() => {
  for (const [token, entry] of sessions) {
    if (isExpired(entry)) {
      sessions.delete(token);
    }
  }
}, SESSION_CLEANUP_INTERVAL_MS);
if (typeof sessionCleanupTimer.unref === "function") sessionCleanupTimer.unref();

module.exports = { hashPassword, verifyPassword, createSession, destroySession, requireAuth };
