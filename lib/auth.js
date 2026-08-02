const crypto = require("crypto");
const supabase = require("./supabaseClient");

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

// 세션은 Supabase(sessions 테이블)에 저장한다 — Vercel 서버리스 환경에서는 함수 인스턴스가
// 요청마다 다른 컨테이너에서 실행되거나 재시작될 수 있어, 메모리(Map)에만 세션을 두면
// 로그인 직후에도 다른 인스턴스에서 401이 발생할 수 있기 때문이다.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7일

async function createSession(userId) {
  const { data, error } = await supabase
    .from("sessions")
    .insert({ user_id: userId })
    .select("token")
    .single();
  if (error) {
    console.error("세션 생성 실패:", error);
    throw new Error("세션 생성 중 오류가 발생했습니다.");
  }
  return data.token;
}

async function destroySession(token) {
  await supabase.from("sessions").delete().eq("token", token);
}

function isExpired(createdAt) {
  return Date.now() - new Date(createdAt).getTime() > SESSION_TTL_MS;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, error: "로그인이 필요합니다." });
  }

  const { data: entry, error } = await supabase
    .from("sessions")
    .select("user_id, created_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("세션 조회 실패:", error);
    return res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
  }

  if (!entry || isExpired(entry.created_at)) {
    if (entry) await destroySession(token);
    return res.status(401).json({ success: false, error: "로그인이 필요합니다." });
  }

  req.userId = entry.user_id;
  next();
}

// 로그아웃 없이 방치된 만료 세션을 주기적으로 정리한다. (전통적인 상시 구동 서버 전용 —
// 서버리스 환경에서는 함수가 상시 실행되지 않으므로 이 타이머는 사실상 동작하지 않을 수 있지만,
// requireAuth가 요청마다 만료 여부를 자체 검사하므로 보안·정합성에는 영향이 없다.)
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1시간마다
const sessionCleanupTimer = setInterval(() => {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
  supabase
    .from("sessions")
    .delete()
    .lt("created_at", cutoff)
    .then(({ error }) => {
      if (error) console.error("만료 세션 정리 실패:", error);
    });
}, SESSION_CLEANUP_INTERVAL_MS);
if (typeof sessionCleanupTimer.unref === "function") sessionCleanupTimer.unref();

module.exports = { hashPassword, verifyPassword, createSession, destroySession, requireAuth };
