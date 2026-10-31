// 패스키 등록(과제 8 카드 2) 서버 쪽 확인 스크립트. 브라우저 패스키 창이 필요한 부분(실제 등록)은 하지 않는다. (docs/passkey-registration.md 의 수동 절차)
//
// 사용법:  npm run dev (또는 build 후 start) 를 띄운 뒤
//   (A) 로그인 없이:           node scripts/verify-passkey.mjs [http://localhost:3000]
//   (B) 시험 계정으로 (선택):  NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
//                              TEST_EMAIL=... TEST_PASSWORD=... node scripts/verify-passkey.mjs [주소]
//       (B)는 등록 시작을 2번 요청해 챌린지가 다른지 보고(만료 5분짜리 챌린지 행이 2개 생긴다. 패스키는 만들지 않는다),
//       잘못된 challenge_id 로 verify 를 보내 거부되는지 확인한다. 비밀번호·토큰은 출력하지 않는다.
// (B)를 실행하지 않았다면 "통과"로 보고하면 안 된다.

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { NEXT_PUBLIC_SUPABASE_URL: SB_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;

let failed = 0;
let total = 0;

function check(name, ok, detail = "") {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

async function call(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const nilUuid = "00000000-0000-4000-8000-000000000000";

const a1 = await call("GET", "/api/passkeys");
const a2 = await call("POST", "/api/passkeys/register/options", { body: { name: "x" } });
const a3 = await call("POST", "/api/passkeys/register/verify", { body: { challenge_id: nilUuid, response: {} } });
check("비로그인 GET /api/passkeys 는 401", a1.status === 401, a1.status);
check("비로그인 POST /api/passkeys/register/options 는 401", a2.status === 401, a2.status);
check("비로그인 POST /api/passkeys/register/verify 는 401", a3.status === 401, a3.status);
check("그 응답들에 passkeys/options/challenge 가 없다", ![a1, a2, a3].some((r) => /passkeys"|challenge/.test(JSON.stringify(r.json))), "");
const badToken = await call("GET", "/api/passkeys", { token: "not-a-real-token" });
check("엉터리 Bearer 토큰은 401", badToken.status === 401, badToken.status);

if (SB_URL && SB_KEY && TEST_EMAIL && TEST_PASSWORD) {
  const login = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SB_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  });
  const token = (await login.json().catch(() => ({}))).access_token;
  check("시험 계정 로그인(토큰 받기)", Boolean(token), login.status);

  if (token) {
    const list = await call("GET", "/api/passkeys", { token });
    check("로그인 후 GET /api/passkeys 200 + passkeys 배열", list.status === 200 && Array.isArray(list.json?.passkeys), list.status);
    check("목록에 credential_id·public_key·counter 가 없다", !/credential_id|public_key|counter/.test(JSON.stringify(list.json)), "");

    const o1 = await call("POST", "/api/passkeys/register/options", { token, body: { name: "verify-script" } });
    const o2 = await call("POST", "/api/passkeys/register/options", { token, body: { name: "verify-script" } });
    check("등록 시작 2번 모두 200", o1.status === 200 && o2.status === 200, `${o1.status}/${o2.status}`);
    check("두 챌린지와 challenge_id 가 서로 다르다", o1.json?.options?.challenge && o1.json.options.challenge !== o2.json?.options?.challenge && o1.json.challenge_id !== o2.json?.challenge_id, "");
    check("옵션이 discoverable credential·사용자 확인을 요구한다", o1.json?.options?.authenticatorSelection?.residentKey === "required" && o1.json?.options?.authenticatorSelection?.userVerification === "required", "");

    const bad = await call("POST", "/api/passkeys/register/verify", { token, body: { challenge_id: nilUuid, response: { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "x", attestationObject: "x" } } } });
    check("모르는 challenge_id 로 verify 하면 400", bad.status === 400, bad.status);
    const spoof = await call("POST", "/api/passkeys/register/options", { token, body: { name: "x", user_id: nilUuid } });
    check("본문에 user_id 를 넣어도 무시되고(200) 사용자 핸들은 내 계정 값이다", spoof.status === 200 && !JSON.stringify(spoof.json).includes(nilUuid), spoof.status);
  }
} else {
  console.log("\n(B) 건너뜀: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL / TEST_PASSWORD 가 없습니다.");
  console.log("    로그인 후 시험은 실행되지 않았으므로 통과로 보고하면 안 됩니다.");
}

console.log(`\n${total - failed}/${total} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
