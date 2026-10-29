// 비공개 영역(과제 8 카드 1) 접근 제어 확인 스크립트.
//
// 사용법:  1) 터미널 A:  npm run dev   (또는 npm run build 후 npm start)
//          2) 터미널 B:
//   (A) 로그인 정보 없이 되는 시험 — 비로그인 접근 차단, 응답·HTML에 비공개 항목이 없는가
//       node scripts/verify-private.mjs                       (기본 http://localhost:3000)
//       node scripts/verify-private.mjs http://localhost:3001
//   (B) 시험 계정까지 쓰는 시험 — 로그인한 토큰으로 항목 3개 이상이 오는가
//       NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//       NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//       TEST_EMAIL=<이메일 확인을 마친 시험 계정> TEST_PASSWORD=<비밀번호> \
//       node scripts/verify-private.mjs
//   (C) 빌드 결과에 비공개 항목이 없는가 — `npm run build` 뒤에 실행. 브라우저로 내려가는 파일(.next/static)을 훑는다.
//       CHECK_STATIC_DIR=.next/static node scripts/verify-private.mjs
//
// 주의
//  * 비밀번호·토큰은 출력하지 않는다. 시험 계정만 쓴다. (B)는 아무것도 만들거나 지우지 않는다. 읽기만 한다.
//  * (B)·(C)를 실행하지 않았다면 "통과"로 보고하면 안 된다. 건너뛴 경우 아래에 그 사실이 출력된다.
//  * 로그인한 상태의 /private 화면(쿠키 세션)은 이 스크립트가 보지 않는다. 브라우저로 직접 확인한다. (docs/private-area.md)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { NEXT_PUBLIC_SUPABASE_URL: SB_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL, TEST_PASSWORD, CHECK_STATIC_DIR } = process.env;

// lib/private/items.ts 의 항목에 들어 있는 값. 비로그인 응답·HTML·번들에 하나라도 있으면 안 된다.
const MARKERS = ["PDEMO-", "별빛 일지", "가상 메모: 주말에 정리할 것", "가상 학습 목표", "가상 프로젝트"];

const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

function leaked(text) {
  return MARKERS.filter((marker) => text.includes(marker));
}

async function request(method, path, { token, cookie } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, res };
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

try {
  // ===== A. 비로그인 접근 차단 =====
  let r = await request("GET", "/api/private-items");
  check("비로그인 GET /api/private-items 는 401", r.status === 401, String(r.status));
  check("그 응답에 비공개 항목이 없다", leaked(r.text).length === 0 && r.json?.items === undefined, leaked(r.text).join(", ") || r.text.slice(0, 120));
  check("그 응답은 no-store", (r.res.headers.get("cache-control") ?? "").includes("no-store"), r.res.headers.get("cache-control") ?? "(없음)");

  r = await request("GET", "/api/private-items", { token: "aaa.bbb.ccc" });
  check("엉터리 Bearer 토큰은 401, 항목 없음", r.status === 401 && leaked(r.text).length === 0, `${r.status} ${leaked(r.text).join(", ")}`);

  r = await request("GET", "/api/private-items", { cookie: "sb-garbage-auth-token=garbage" });
  check("엉터리 세션 쿠키는 401, 항목 없음", r.status === 401 && leaked(r.text).length === 0, `${r.status} ${leaked(r.text).join(", ")}`);

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    r = await request(method, "/api/private-items");
    check(`비로그인 ${method} /api/private-items 는 4xx(쓰기 경로 없음), 항목 없음`, r.status >= 400 && r.status < 500 && leaked(r.text).length === 0, `${r.status} ${leaked(r.text).join(", ")}`);
  }

  r = await request("GET", "/private");
  const location = r.res.headers.get("location") ?? "";
  check("비로그인 /private 는 로그인 화면으로 이동(307/308)", [307, 308].includes(r.status) && location.endsWith("/login"), `${r.status} ${location}`);
  check("그 응답 본문에 비공개 항목이 없다", leaked(r.text).length === 0, leaked(r.text).join(", "));

  r = await request("GET", "/private", { cookie: "sb-garbage-auth-token=garbage" });
  check("엉터리 쿠키로 /private 를 열어도 이동하고 항목이 없다", [307, 308].includes(r.status) && leaked(r.text).length === 0, `${r.status} ${leaked(r.text).join(", ")}`);

  r = await request("GET", "/login");
  check("로그인 화면(/login)은 열리고 비공개 항목이 없다", r.status === 200 && leaked(r.text).length === 0, `${r.status} ${leaked(r.text).join(", ")}`);

  r = await request("GET", "/");
  check("기존 동작 유지: 비로그인 / 는 로그인 화면으로 이동", [307, 308].includes(r.status) && (r.res.headers.get("location") ?? "").endsWith("/login"), String(r.status));

  r = await request("GET", "/api/plans");
  check("기존 동작 유지: 비로그인 GET /api/plans 는 401", r.status === 401, String(r.status));

  // ===== B. 시험 계정 =====
  if (!SB_URL || !SB_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
    console.log("\n(B) 건너뜀: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL / TEST_PASSWORD 가 없습니다.");
    console.log("    로그인한 토큰으로 항목을 받는 시험은 실행되지 않았으므로 통과로 보고하면 안 됩니다.");
  } else {
    const res = await fetch(`${SB_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_KEY },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    const login = await res.json().catch(() => null);
    const token = login?.access_token;
    check("시험 계정 로그인 성공", res.status === 200 && !!token, `${res.status} ${login?.error_code ?? ""}`);
    if (!token) throw new Error("시험 계정으로 로그인하지 못해 (B)를 중단합니다. 이메일 확인을 마친 계정인지 확인하세요.");

    r = await request("GET", "/api/private-items", { token });
    const items = r.json?.items;
    check("로그인 토큰으로 GET /api/private-items 200, 항목 3개 이상", r.status === 200 && Array.isArray(items) && items.length >= 3, `${r.status} ${r.text.slice(0, 120)}`);
    check("각 항목에 id·kind·title·body 가 있다", Array.isArray(items) && items.every((i) => i.id && i.kind && i.title && i.body), "");
    check("항목이 모두 가상 데이터로 표시돼 있다 (제목에 '가상')", Array.isArray(items) && items.every((i) => i.title.includes("가상")), "");
    check("응답에 계정 이메일이 없다", !r.text.toLowerCase().includes(TEST_EMAIL.toLowerCase()), "");
    check("응답은 no-store", (r.res.headers.get("cache-control") ?? "").includes("no-store"), r.res.headers.get("cache-control") ?? "(없음)");
  }

  // ===== C. 빌드 결과(브라우저로 내려가는 파일) =====
  if (!CHECK_STATIC_DIR) {
    console.log("\n(C) 건너뜀: CHECK_STATIC_DIR 가 없습니다. `npm run build` 뒤에 CHECK_STATIC_DIR=.next/static 으로 실행하세요.");
  } else {
    let files = 0;
    const hits = [];
    for (const path of walk(CHECK_STATIC_DIR)) {
      if (!/\.(js|css|html|json|txt|map)$/.test(path)) continue;
      files++;
      const found = leaked(readFileSync(path, "utf8"));
      if (found.length > 0) hits.push(`${path}: ${found.join(", ")}`);
    }
    check(`브라우저용 파일 ${files}개에 비공개 항목이 없다`, files > 0 && hits.length === 0, files === 0 ? "훑은 파일이 0개" : hits.join(" | "));
  }
} catch (e) {
  failed++;
  console.log("ERROR ", e.message);
}

console.log(`\n${results.length - failed}/${results.length} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
