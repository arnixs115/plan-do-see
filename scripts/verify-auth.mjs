// 인증 종단 간 확인 스크립트. 실제 Supabase와 연결된 서버를 대상으로 한다.
//
// 사용법:  1) 터미널 A:  npm run dev
//          2) 터미널 B:
//   (A) 로그인 정보 없이도 되는 시험 — 비로그인 접근 차단
//       node scripts/verify-auth.mjs                      (기본 http://localhost:3000)
//   (B) 시험 계정까지 쓰는 시험 — 로그인·로그아웃·세션 폐기·오류 문구
//       NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//       TEST_EMAIL=<이메일 확인을 마친 시험 계정> TEST_PASSWORD=<비밀번호> \
//       node scripts/verify-auth.mjs
//
// 주의
//  * 비밀번호·토큰은 출력하지 않는다. 다만 환경변수로 준 비밀번호는 명령 기록에 남으니 시험 전용 계정만 쓴다.
//  * (B)는 시험 계정 이름으로 계획 1개("[API-TEST-AUTH] ...")를 만든다. 계획 삭제 API가 아직 없어 DB에 남는다.
//  * (B)는 시험 계정의 현재 세션을 로그아웃으로 폐기한다. (다른 곳에서 같은 계정으로 로그인해 둔 것은 그대로다)
//  * 서버 쪽(Supabase) 동작은 이 스크립트가 직접 확인한다: 폐기된 토큰이 정말로 거절되는지, 로그인 오류 응답이 같은지.

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { NEXT_PUBLIC_SUPABASE_URL: SB_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

const P = "11111111-1111-4111-8111-111111111111";
const T = "33333333-3333-4333-8333-333333333333";
const E = "44444444-4444-4444-8444-444444444444";

// 모든 API 핸들러 17개
const API_CALLS = [
  ["GET", "/api/plans"], ["POST", "/api/plans", { title: "x" }],
  ["GET", `/api/plans/${P}`], ["PATCH", `/api/plans/${P}`, { title: "y" }],
  ["GET", `/api/plans/${P}/todos`], ["POST", `/api/plans/${P}/todos`, { title: "t" }],
  ["GET", `/api/plans/${P}/summary`], ["GET", `/api/plans/${P}/export`], ["GET", "/api/export"],
  ["GET", `/api/todos/${T}`], ["PATCH", `/api/todos/${T}`, { status: "completed" }], ["DELETE", `/api/todos/${T}`],
  ["POST", `/api/todos/${T}/executions`], ["GET", `/api/executions/${E}`],
  ["POST", `/api/executions/${E}/pause`], ["POST", `/api/executions/${E}/resume`], ["POST", `/api/executions/${E}/end`],
];

async function api(method, path, { body, token, cookie } = {}) {
  const headers = { "Idempotency-Key": `verify-auth-${Date.now()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, res };
}

async function authApi(path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", apikey: SB_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SB_URL.replace(/\/$/, "")}${path}`, { method: "POST", headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

try {
  // ===== A. 비로그인 접근 차단 =====
  const bad = [];
  for (const [method, path, body] of API_CALLS) {
    const r = await api(method, path, { body });
    if (r.status !== 401) bad.push(`${method} ${path} -> ${r.status}`);
  }
  check(`비로그인 API ${API_CALLS.length}개 호출이 모두 401`, bad.length === 0, bad.join(" | "));

  let r = await api("GET", "/api/plans", { token: "aaa.bbb.ccc" });
  check("엉터리 Bearer 토큰은 401", r.status === 401, String(r.status));
  r = await api("GET", "/api/plans", { cookie: "sb-garbage-auth-token=garbage" });
  check("엉터리 세션 쿠키는 401", r.status === 401, String(r.status));

  for (const path of ["/plans", `/plans/${P}`]) {
    r = await api("GET", path);
    const loc = r.res.headers.get("location") ?? "";
    check(`비로그인 ${path} 은 로그인 화면으로 이동(307)`, [307, 308].includes(r.status) && loc.endsWith("/login"), `${r.status} ${loc}`);
  }
  r = await api("GET", "/login");
  check("로그인 화면(/login)은 열림", r.status === 200 && r.text.includes("로그인"), String(r.status));

  // ===== B. 시험 계정 =====
  if (!SB_URL || !SB_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
    console.log("\n(B) 건너뜀: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL / TEST_PASSWORD 가 없습니다.");
    console.log("    로그인·로그아웃·세션 폐기 시험은 실행되지 않았으므로 통과로 보고하면 안 됩니다.");
  } else {
    // 로그인 오류 응답: 없는 이메일 vs 틀린 비밀번호
    const unknown = await authApi("/auth/v1/token?grant_type=password", { body: { email: `nobody-${Date.now()}@example.com`, password: "wrong-password-123" } });
    const wrong = await authApi("/auth/v1/token?grant_type=password", { body: { email: TEST_EMAIL, password: `${TEST_PASSWORD}-wrong` } });
    check("Supabase 로그인 오류: 없는 이메일과 틀린 비밀번호의 응답이 같다 (상태·코드·메시지)",
      unknown.status === wrong.status && unknown.json?.error_code === wrong.json?.error_code && unknown.json?.msg === wrong.json?.msg,
      JSON.stringify({ unknown: [unknown.status, unknown.json?.error_code, unknown.json?.msg], wrong: [wrong.status, wrong.json?.error_code, wrong.json?.msg] }));

    const login = await authApi("/auth/v1/token?grant_type=password", { body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
    check("시험 계정 로그인 성공", login.status === 200 && !!login.json?.access_token, `${login.status} ${login.json?.error_code ?? ""}`);
    const token = login.json?.access_token;
    if (!token) throw new Error("시험 계정으로 로그인하지 못해 (B)를 중단합니다. 이메일 확인을 마친 계정인지 확인하세요.");
    const userId = login.json.user?.id;

    r = await api("GET", "/api/plans", { token });
    check("로그인 토큰으로 API 접근 200", r.status === 200 && Array.isArray(r.json), `${r.status} ${r.text.slice(0, 120)}`);

    r = await api("POST", "/api/plans", { token, body: { title: `[API-TEST-AUTH] ${new Date().toISOString()}`, user_id: "00000000-0000-4000-8000-000000000000", is_example: true } });
    check("계획 생성 201, 소유자는 로그인한 사용자 (본문의 user_id·is_example은 무시)", r.status === 201 && r.json?.user_id === userId && r.json?.is_example === false, `${r.status} ${r.text.slice(0, 160)}`);

    // 로그아웃(세션 폐기) → 같은 토큰으로 다시 접근
    const out = await authApi("/auth/v1/logout?scope=local", { token });
    check("Supabase 로그아웃 요청 성공(scope=local)", out.status === 204 || out.status === 200, String(out.status));
    r = await api("GET", "/api/plans", { token });
    check("로그아웃(세션 폐기) 후 같은 토큰은 서버가 거절한다 (401)", r.status === 401, `상태 ${r.status} — 200이면 폐기된 세션의 토큰이 아직 통한다는 뜻이므로 설명서에 그대로 적어야 한다`);
  }
} catch (e) {
  failed++;
  console.log("ERROR ", e.message);
}

console.log(`\n${results.length - failed}/${results.length} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
