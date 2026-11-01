// 계정 간 데이터 격리(과제 8 카드 5) 확인 스크립트. A→B, B→A 두 방향을 모두 시험한다.
//
// 사용법 (가상 시험 계정 두 개가 필요하다. 이메일 확인을 마친 계정, 서로 다른 사용자)
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//   TEST_EMAIL_A=<계정 A> TEST_PASSWORD_A=<비밀번호> \
//   TEST_EMAIL_B=<계정 B> TEST_PASSWORD_B=<비밀번호> \
//   node scripts/verify-isolation.mjs [서비스 주소, 기본 http://localhost:3000]
//
// 주의
//  * 읽기(GET)와 "거절되어야 하는 쓰기 시도"만 보낸다. 항목을 만들거나 지우지 않는다. (첫 조회 때 계정 몫의 가상 항목이 채워지는 것은 서비스 동작이다)
//  * 전후 비교는 각 계정이 API 로 보는 목록(개수 + 내용 해시)으로 한다. DB 를 직접 세는 비교는 db/checks/private-isolation.sql 을 쓴다.
//  * 비밀번호·토큰은 출력하지 않는다. 실행하지 않은 시험을 "통과"로 보고하지 않는다. (환경변수가 없으면 시작하지 않고 종료한다)

import { createHash, randomUUID } from "node:crypto";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { NEXT_PUBLIC_SUPABASE_URL: SB_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL_A, TEST_PASSWORD_A, TEST_EMAIL_B, TEST_PASSWORD_B } = process.env;

if (!SB_URL || !SB_KEY || !TEST_EMAIL_A || !TEST_PASSWORD_A || !TEST_EMAIL_B || !TEST_PASSWORD_B) {
  console.error("환경변수가 부족합니다. 파일 맨 위 사용법을 보세요. (시험을 실행하지 않았으므로 '통과'가 아닙니다)");
  process.exit(2);
}

let failed = 0;
let total = 0;
function check(name, ok, detail = "") {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SB_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  return json.access_token ?? null;
}

async function call(method, path, { token, headers = {}, body } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

const digest = (items) => createHash("sha256").update(JSON.stringify(items)).digest("hex").slice(0, 12);
const leaked = (text, other) => other.items.flatMap((i) => [i.id, i.code, i.title, i.body]).filter((v) => text.includes(v));

const tokens = { A: await login(TEST_EMAIL_A, TEST_PASSWORD_A), B: await login(TEST_EMAIL_B, TEST_PASSWORD_B) };
check("계정 A 로그인", !!tokens.A);
check("계정 B 로그인", !!tokens.B);
if (!tokens.A || !tokens.B) process.exit(1);

const snap = {};
for (const k of ["A", "B"]) {
  const r = await call("GET", "/api/private-items", { token: tokens[k] });
  snap[k] = { items: r.json?.items ?? [] };
  check(`${k}: 자기 목록 200, 항목 3개 이상`, r.status === 200 && snap[k].items.length >= 3, `${r.status} ${snap[k].items.length}개`);
}
if (!snap.A.items.length || !snap.B.items.length) {
  console.error("자기 목록을 읽지 못해 교차 시험을 시작하지 않습니다. (시험을 실행하지 않았으므로 '통과'가 아닙니다)");
  process.exit(1);
}
check("A와 B의 항목 id·제목이 서로 겹치지 않는다", snap.A.items.every((a) => snap.B.items.every((b) => a.id !== b.id && a.title !== b.title)));

const before = { A: { n: snap.A.items.length, h: digest(snap.A.items) }, B: { n: snap.B.items.length, h: digest(snap.B.items) } };

async function attack(att, vic) {
  const tag = `${att}→${vic}`;
  const t = tokens[att], mine = snap[att], other = snap[vic];
  const vicItem = other.items[0].id;
  const vicUser = "00000000-0000-4000-8000-000000000000"; // 상대 사용자 id 를 모르는 시험이라 형식만 갖춘 값. 서버는 어차피 읽지 않는다.

  let r = await call("GET", `/api/private-items/${vicItem}`, { token: t });
  check(`${tag} 상대 항목 id 직접 조회 → 404, 상대 데이터 없음`, (r.status === 404 || r.status === 403) && leaked(r.text, other).length === 0, `${r.status}`);

  for (const q of ["user_id", "userId", "owner"]) {
    r = await call("GET", `/api/private-items?${q}=${vicUser}`, { token: t });
    check(`${tag} 목록 + ?${q}=<다른 id> → 여전히 내 목록`, r.status === 200 && leaked(r.text, other).length === 0 && r.json.items.length === mine.items.length, `${r.status}`);
  }
  r = await call("GET", `/api/private-items/${vicItem}?user_id=${vicUser}`, { token: t });
  check(`${tag} 상대 항목 id + ?user_id → 404`, r.status === 404 && leaked(r.text, other).length === 0, `${r.status}`);
  r = await call("GET", "/api/private-items", { token: t, headers: { "x-user-id": vicUser } });
  check(`${tag} 사용자 id 헤더 변조 → 여전히 내 목록`, r.status === 200 && leaked(r.text, other).length === 0, `${r.status}`);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
    r = await call(m, `/api/private-items/${vicItem}`, { token: t, body: { user_id: vicUser, title: "변조" } });
    check(`${tag} ${m} 상대 항목 + 본문 사용자 id → 405(쓰기 경로 없음)`, r.status === 405 && leaked(r.text, other).length === 0, `${r.status}`);
  }
  r = await call("GET", `/api/private-items/${randomUUID()}`, { token: t });
  const missing = r;
  r = await call("GET", `/api/private-items/${vicItem}`, { token: t });
  check(`${tag} 존재하지 않는 id 와 상대 항목 id 의 응답이 같다(존재 여부를 알 수 없음)`, missing.status === r.status && missing.text === r.text, `${missing.status}/${r.status}`);
}

await attack("A", "B");
await attack("B", "A");

let r = await call("GET", "/api/private-items");
check("비로그인 목록 401", r.status === 401, `${r.status}`);
r = await call("GET", `/api/private-items/${snap.A.items[0].id}`);
check("비로그인 항목 조회 401", r.status === 401, `${r.status}`);

const after = {};
for (const k of ["A", "B"]) {
  const x = await call("GET", "/api/private-items", { token: tokens[k] });
  after[k] = { n: x.json?.items?.length ?? -1, h: digest(x.json?.items ?? []) };
}
console.log("\n| 계정 | 테스트 전 항목 수 | 테스트 후 항목 수 | 내용 해시(전→후) | 결과 |\n|---|---|---|---|---|");
for (const k of ["A", "B"]) {
  const same = before[k].n === after[k].n && before[k].h === after[k].h;
  console.log(`| ${k} | ${before[k].n} | ${after[k].n} | ${before[k].h} → ${after[k].h} | ${same ? "변경 없음" : "변경됨"} |`);
  check(`${k} 항목 수·내용이 시험 전후 같다`, same);
}

console.log(`\n${total - failed}/${total} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
