// 계정 삭제 검증 (과제 7 카드 5). 실제 Supabase와 연결된 서버를 대상으로 한다.
//
// !! 이 스크립트는 TEST_EMAIL_DEL 계정을 **영구 삭제**한다. 되돌릴 수 없다. !!
//    삭제 전용으로 새로 만든 시험 계정만 쓰고, 실제 사용자·a-test·b-test·admin 계정은 쓰지 않는다.
//    실수로 실행하지 않도록 `--delete-test-account` 인자를 꼭 줘야 한다.
//
// 사용법:  1) 터미널 A:  npm run dev          (또는 배포 주소를 첫 인자로 준다)
//          2) 삭제용 시험 계정을 가입 화면에서 만든다. (예: del-test@example.com)
//          3) 터미널 B:
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//   TEST_EMAIL_DEL=<삭제 전용 시험 계정> TEST_PASSWORD_DEL=<비밀번호> \
//   TEST_EMAIL_B=<남아야 하는 다른 시험 계정> TEST_PASSWORD_B=<비밀번호> \
//   node scripts/verify-account-deletion.mjs [서버 주소, 기본 http://localhost:3000] --delete-test-account
//
// 하는 일
//   1. 삭제 계정(D)과 다른 계정(B)이 각자 시험 자료를 만든다. (제목 [ACCOUNT-DEL-TEST])
//   2. 삭제가 거절되어야 하는 요청: 확인 이메일 없음/틀림(400), 비로그인(401), B가 D의 이메일을 적어도 B 자신만 대상(400)
//   3. D가 자신의 이메일을 확인하고 삭제(204)
//   4. 삭제 후: D의 이전 토큰은 401, Auth 서버도 거절, D로 다시 로그인 불가, 리프레시 토큰 거절
//   5. B의 자료와 예시 계획은 그대로
//   6. DB에서 확인할 것을 안내한다. (D의 자료가 지워졌는지는 SQL Editor 조회로 확인)
//
// 주의: 비밀번호·토큰은 출력하지 않는다. B가 만든 시험 계획은 남는다. (계획 삭제 API 없음)

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL_DEL, TEST_PASSWORD_DEL, TEST_EMAIL_B, TEST_PASSWORD_B } = process.env;

if (!args.includes("--delete-test-account")) {
  console.log("이 스크립트는 TEST_EMAIL_DEL 계정을 영구 삭제합니다. 삭제 전용 시험 계정이 맞으면 `--delete-test-account` 를 붙여 다시 실행하세요.");
  process.exit(2);
}

if (!NEXT_PUBLIC_SUPABASE_URL || !SB_KEY || !TEST_EMAIL_DEL || !TEST_PASSWORD_DEL || !TEST_EMAIL_B || !TEST_PASSWORD_B) {
  console.log("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL_DEL·B / TEST_PASSWORD_DEL·B 가 필요합니다. (파일 맨 위 사용법 참고)");
  process.exit(2);
}

if (TEST_EMAIL_DEL.trim().toLowerCase() === TEST_EMAIL_B.trim().toLowerCase()) {
  console.log("삭제 계정과 남는 계정이 같습니다. 서로 다른 계정을 쓰세요.");
  process.exit(2);
}

const SB_URL = NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const PREFIX = "[ACCOUNT-DEL-TEST]";
let failed = 0;
let total = 0;
const evidence = [];

const check = (name, ok, detail = "") => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
};
const short = (id) => (id ? `${String(id).slice(0, 8)}…` : "?");
const mask = (email) => `${email.slice(0, 2)}***${email.slice(email.indexOf("@"))}`;

async function authCall(method, path, { body, token } = {}) {
  const headers = { "Content-Type": "application/json", apikey: SB_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${SB_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function login(email, password) {
  const r = await authCall("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
  if (r.status !== 200 || !r.json?.access_token) throw new Error(`로그인 실패 (${mask(email)}: 상태 ${r.status}, 코드 ${r.json?.error_code ?? "?"})`);
  return { token: r.json.access_token, refresh: r.json.refresh_token, id: r.json.user?.id };
}

async function api(method, path, { token, body } = {}) {
  const headers = { "Idempotency-Key": `verify-del-${Date.now()}-${Math.random().toString(36).slice(2)}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON 아님 */ }
  return { status: res.status, json, text, res };
}

const ownPlans = async (who) => ((await api("GET", "/api/plans", { token: who.token })).json ?? []).filter((p) => !p.is_example);

try {
  const D = await login(TEST_EMAIL_DEL, TEST_PASSWORD_DEL);
  const B = await login(TEST_EMAIL_B, TEST_PASSWORD_B);

  check("삭제 계정(D)과 남는 계정(B)은 서로 다른 사용자다", !!D.id && D.id !== B.id);

  // ===== 1. 시험 자료 =====
  console.log("\n--- 1. 삭제 전 상태 ---");
  const make = async (who, label) => {
    const plan = await api("POST", "/api/plans", { token: who.token, body: { title: `${PREFIX} ${label}` } });
    const todo = plan.status === 201 ? await api("POST", `/api/plans/${plan.json.id}/todos`, { token: who.token, body: { title: `${PREFIX} ${label} 할 일` } }) : null;
    const exec = todo?.status === 201 ? await api("POST", `/api/todos/${todo.json.id}/executions`, { token: who.token, body: {} }) : null;
    return { planId: plan.json?.id, todoId: todo?.json?.id, execId: exec?.json?.execution?.id, ok: plan.status === 201 && todo?.status === 201 && exec?.status === 201, statuses: [plan.status, todo?.status, exec?.status] };
  };
  const dData = await make(D, "삭제 대상 (D)");
  const bData = await make(B, "남는 자료 (B)");
  check("D: 계획·할 일·실행을 만들었다 (201)", dData.ok, JSON.stringify(dData.statuses));
  check("B: 계획·할 일·실행을 만들었다 (201)", bData.ok, JSON.stringify(bData.statuses));
  console.log(`      D 자료: 계획 ${short(dData.planId)}, 할 일 ${short(dData.todoId)}, 실행 ${short(dData.execId)}`);
  console.log(`      B 자료: 계획 ${short(bData.planId)}, 할 일 ${short(bData.todoId)}, 실행 ${short(bData.execId)}`);

  const dBefore = await ownPlans(D);
  const bBefore = await ownPlans(B);
  const exampleBefore = ((await api("GET", "/api/plans", { token: B.token })).json ?? []).filter((p) => p.is_example).map((p) => p.id).sort();
  check("삭제 전: D의 내 계획 수와 B의 내 계획 수를 기록했다", dBefore.length >= 1 && bBefore.length >= 1);
  console.log(`      삭제 전 내 계획 수: D ${dBefore.length}개, B ${bBefore.length}개, 예시 계획 ${exampleBefore.length}개`);

  // ===== 2. 삭제가 거절되어야 하는 요청 =====
  console.log("\n--- 2. 삭제가 거절되는 요청 ---");
  const noAuth = await api("DELETE", "/api/account", { body: { confirm_email: TEST_EMAIL_DEL } });
  check("비로그인 DELETE /api/account → 401", noAuth.status === 401, `상태 ${noAuth.status}`);
  const noBody = await api("DELETE", "/api/account", { token: D.token, body: {} });
  check("D: 확인 이메일 없이 DELETE → 400", noBody.status === 400, `상태 ${noBody.status}`);
  const wrong = await api("DELETE", "/api/account", { token: D.token, body: { confirm_email: "wrong-address@example.com" } });
  check("D: 틀린 이메일로 DELETE → 400", wrong.status === 400, `상태 ${wrong.status}`);
  const bWithD = await api("DELETE", "/api/account", { token: B.token, body: { confirm_email: TEST_EMAIL_DEL } });
  check("B가 D의 이메일을 적어도 → 400 (삭제 대상은 항상 로그인한 본인)", bWithD.status === 400, `상태 ${bWithD.status}`);
  const bWithId = await api("DELETE", `/api/account?user_id=${D.id}`, { token: B.token, body: { confirm_email: TEST_EMAIL_DEL, user_id: D.id } });
  check("B가 쿼리·본문에 D의 user_id 를 넣어도 → 400", bWithId.status === 400, `상태 ${bWithId.status}`);
  const dStill = await api("GET", "/api/plans", { token: D.token });
  const bStill = await api("GET", "/api/plans", { token: B.token });
  check("거절된 요청들 뒤에도 D와 B의 계정이 그대로 동작한다 (200)", dStill.status === 200 && bStill.status === 200, `D ${dStill.status}, B ${bStill.status}`);
  evidence.push(["비로그인", "DELETE /api/account", noAuth.status, noAuth.json?.error ?? ""]);
  evidence.push(["D", "DELETE /api/account {}", noBody.status, noBody.json?.error ?? ""]);
  evidence.push(["D", "DELETE /api/account {confirm_email: 틀림}", wrong.status, wrong.json?.error ?? ""]);
  evidence.push(["B", "DELETE /api/account {confirm_email: D의 이메일}", bWithD.status, bWithD.json?.error ?? ""]);

  // ===== 3. 삭제 =====
  console.log("\n--- 3. D 계정 삭제 ---");
  const del = await api("DELETE", "/api/account", { token: D.token, body: { confirm_email: TEST_EMAIL_DEL.toUpperCase() } });
  check("D: 자신의 이메일을 확인하고 DELETE → 204 (대소문자 무시)", del.status === 204, `상태 ${del.status} ${del.text.slice(0, 100)}`);
  evidence.push(["D", "DELETE /api/account {confirm_email: 본인}", del.status, "(본문 없음)"]);

  // ===== 4. 삭제 후 D의 이전 인증 정보 =====
  console.log("\n--- 4. 삭제 후 D의 이전 인증 정보 ---");
  const after = await api("GET", "/api/plans", { token: D.token });
  check("삭제 전 받은 토큰으로 GET /api/plans → 401", after.status === 401, `상태 ${after.status}`);
  const direct = await authCall("GET", "/auth/v1/user", { token: D.token });
  check("Auth 서버에 직접 물어도 그 토큰이 거절된다 (401/403)", direct.status === 401 || direct.status === 403, `상태 ${direct.status}`);
  console.log(`      Auth 서버 직접 확인: GET /auth/v1/user → ${direct.status} ${direct.json?.error_code ?? direct.json?.code ?? ""}`);
  const relog = await authCall("POST", "/auth/v1/token?grant_type=password", { body: { email: TEST_EMAIL_DEL, password: TEST_PASSWORD_DEL } });
  check("D로 다시 로그인할 수 없다 (400 계열)", relog.status >= 400 && !relog.json?.access_token, `상태 ${relog.status}`);
  const refreshed = await authCall("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: D.refresh } });
  check("D의 리프레시 토큰으로 새 토큰을 받을 수 없다", refreshed.status >= 400 && !refreshed.json?.access_token, `상태 ${refreshed.status}`);
  evidence.push(["D(삭제 후)", "GET /api/plans (이전 토큰)", after.status, after.json?.error ?? ""]);

  // ===== 5. B와 예시 계획은 그대로 =====
  console.log("\n--- 5. 다른 사용자 영향 확인 ---");
  const bAfter = await ownPlans(B);
  const exampleAfter = ((await api("GET", "/api/plans", { token: B.token })).json ?? []).filter((p) => p.is_example).map((p) => p.id).sort();
  check("B의 내 계획 수가 그대로다", bAfter.length === bBefore.length, `${bBefore.length} → ${bAfter.length}`);
  check("B의 계획 ID 목록이 그대로다", JSON.stringify(bAfter.map((p) => p.id).sort()) === JSON.stringify(bBefore.map((p) => p.id).sort()));
  check("B가 자기 계획과 할 일을 계속 읽을 수 있다 (200)", (await api("GET", `/api/plans/${bData.planId}`, { token: B.token })).status === 200 && (await api("GET", `/api/todos/${bData.todoId}`, { token: B.token })).status === 200);
  check("예시 계획이 그대로다", JSON.stringify(exampleAfter) === JSON.stringify(exampleBefore), `${exampleBefore.length} → ${exampleAfter.length}`);
  console.log(`      삭제 후 B의 내 계획 수 ${bAfter.length}개, 예시 계획 ${exampleAfter.length}개`);

  // ===== 6. DB에서 직접 확인 =====
  console.log("\n--- 6. DB에서 직접 확인할 것 (SQL Editor, 읽기 전용) ---");
  console.log(`      D 의 계획 ID 앞 8자리: ${String(dData.planId).slice(0, 8)}  /  B 의 계획 ID 앞 8자리: ${String(bData.planId).slice(0, 8)}`);
  console.log("      select count(*) from auth.users where lower(email) = lower('<D 이메일>');                       -- 0 이어야 한다");
  console.log(`      select count(*) from plans where title like '${PREFIX}%';                                      -- B 의 계획만 남아야 한다`);
  console.log("      select count(*) from auth.sessions s join auth.users u on u.id = s.user_id where lower(u.email) = lower('<D 이메일>');  -- 0");

  console.log("\n--- 증거 표 (제출문에 붙일 수 있음. 인증 정보는 포함되지 않음) ---");
  console.log("| 계정 | 요청 | 응답 상태 | 응답 내용 |\n|---|---|---|---|");
  for (const [who, req, status, body] of evidence) console.log(`| ${who} | \`${req}\` | ${status} | ${body} |`);
} catch (error) {
  failed++;
  console.log("ERROR ", error.message);
}

console.log(`\n${total - failed}/${total} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
