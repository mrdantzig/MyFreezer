const { createClient } = require("@supabase/supabase-js");

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 .env에 설정되어 있지 않습니다.");
  process.exit(1);
}

// service_role 키는 RLS를 우회하므로, 사용자별 접근 제어는 이 클라이언트를 쓰는
// 서버 코드(각 함수에서 명시적으로 user_id를 조건에 거는 방식)가 책임진다.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = supabase;
