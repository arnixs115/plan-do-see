// 세션·토큰 검증 스크립트 (과제 7 카드 3). 실제 Supabase와 연결된 서버를 대상으로 한다.
//
// 사용법:  1) 터미널 A:  npm run dev          (또는 배포 주소를 첫 인자로 준다)
//          2) 터미널 B:
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//   TEST_EMAIL=<시험 계정> TEST_PASSWORD=<시험 비밀번호> \
//   node scripts/verify-session.mjs [서버 주소, 기본 http://localhost:3000]
//
//   만료 시험(약 1시간 걸린다. 토큰의 exp 까지 기다린 뒤 같은 토큰으로 다시 호출한다):
//   ... node scripts/verify-session.mjs [서버 주소] --wait-expiry
//
// 무엇을 확인하나
//   A. 로그인한 토큰으로 보호된 API(GET /api/plans)를 부르면 200. 주소에 토큰이 없다.
//   B. 로그아웃(Auth 서버에서 세션 폐기) 뒤 **같은 메서드·같은 주소·같은 토큰**으로 다시 부르면 401.
//      Supabase Auth 서버에 직접 물어도 그 토큰이 거절되고, 리프레시 토큰도 더는 안 통한다.
//   C. 토큰의 발급·만료 시각과 유효 시간(iat, exp). 서명이 틀린 토큰은 거절된다.
//      실제 만료 시험은 --wait-expiry 로만 한다. 이 옵션 없이는 "만료 거절"을 확인하지 않은 것이다.
//   E. 로그아웃은 이 기기(scope=local)의 세션만 폐기한다: 같은 계정의 다른 세션은 계속 유효하다.
//
// 주의
//  * 토큰·세션 ID·비밀번호는 출력하지 않는다. 시각, 길이, 상태 코드, 오류 코드만 출력한다.
//  * 시험 계정 전용으로 쓴다. 이 스크립트가 만든 세션은 끝날 때 모두 로그아웃한다.
//  * 이 스크립트는 DB에 자료를 쓰지 않는다. (GET 요청만 보낸다)
//  * 브라우저 화면의 로그아웃 버튼(Server Action)은 여기서 부르지 않는다. 그 경로는 브라우저에서 직접 확인한다.

import { pathToFileURL } from "node:url";

// 토큰(JWT)의 머리·본문을 풀어 필요한 값만 돌려준다. 토큰 자체나 세션 ID 값은 돌려주지 않는다.
export function describeToken(token) {
  const parts = String(token ?? "").split(".");

  if (parts.length !== 3) return null;

  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

    return {
      alg: header.alg ?? null,
      issuedAt: typeof claims.iat === "number" ? claims.iat : null,
      expiresAt: typeof claims.exp === "number" ? claims.exp : null,
      lifetimeSeconds:
        typeof claims.iat === "number" && typeof claims.exp === "number" ? claims.exp - claims.iat : null,
      hasSessionId: typeof claims.session_id === "string" && claims.session_id.length > 0,
      role: claims.role ?? null,
    };
  } catch {
    return null;
  }
}

// 본문(exp)만 먼 미래로 바꾼 토큰. 서명은 그대로라서 서명 검증이 있으면 거절되어야 한다.
export function tamperExp(token) {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

  claims.exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;

  return `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
}

const iso = (seconds) => new Date(seconds * 1000).toISOString();

async function main() {
  const args = process.argv.slice(2);
  const waitExpiry = args.includes("--wait-expiry");
  const BASE = (args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL, TEST_PASSWORD } = process.env;

  if (!NEXT_PUBLIC_SUPABASE_URL || !SB_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
    console.log("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL / TEST_PASSWORD 가 필요합니다. (파일 맨 위 사용법 참고)");
    process.exit(2);
  }

  const SB_URL = NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  const results = [];
  let failed = 0;
  const sessions = []; // 끝날 때 정리할 토큰

  const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
  };
  const info = (text) => console.log(`      ${text}`);

  async function authCall(method, path, { body, token } = {}) {
    const headers = { "Content-Type": "application/json", apikey: SB_KEY };

    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${SB_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => null);

    return { status: res.status, json };
  }

  async function appGet(path, token) {
    const url = BASE + path;
    const res = await fetch(url, { method: "GET", headers: token ? { Authorization: `Bearer ${token}` } : {}, redirect: "manual" });
    const text = await res.text();
    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      // JSON 아님
    }

    return { url, status: res.status, text, json };
  }

  async function login() {
    const r = await authCall("POST", "/auth/v1/token?grant_type=password", { body: { email: TEST_EMAIL, password: TEST_PASSWORD } });

    if (r.status !== 200 || !r.json?.access_token) {
      throw new Error(`시험 계정 로그인 실패 (상태 ${r.status}, 코드 ${r.json?.error_code ?? "?"}). 계정과 비밀번호를 확인하세요.`);
    }

    sessions.push(r.json.access_token);

    return { access: r.json.access_token, refresh: r.json.refresh_token, expiresIn: r.json.expires_in };
  }

  try {
    // ===== 로그인 + 토큰 정보 (C) =====
    const s1 = await login();
    const meta = describeToken(s1.access);

    check("로그인 응답의 액세스 토큰이 JWT 형식이고 session_id 를 담고 있다", !!meta && meta.hasSessionId, "토큰 형식을 읽을 수 없음");

    if (meta?.issuedAt != null && meta?.expiresAt != null) {
      info(`발급 ${iso(meta.issuedAt)} / 만료 ${iso(meta.expiresAt)} / 유효 시간 ${meta.lifetimeSeconds}초 (서명 방식 ${meta.alg})`);
      info(`로그인 응답의 expires_in = ${s1.expiresIn}초`);
    }

    check("액세스 토큰에 만료 시각(exp)이 있다 (고정 만료, 이 토큰 자체는 연장되지 않는다)", meta?.expiresAt != null, "exp 없음");
    check("리프레시 토큰이 따로 발급된다 (활동 중에는 새 토큰으로 교환되어 세션이 이어진다)", typeof s1.refresh === "string" && s1.refresh.length > 0, "리프레시 토큰 없음");

    // ===== A. 로그인 상태의 성공 요청 =====
    const before = await appGet("/api/plans", s1.access);

    check("A. 로그인한 토큰으로 GET /api/plans → 200 + 목록(배열)", before.status === 200 && Array.isArray(before.json), `상태 ${before.status}`);
    info(`요청: GET ${new URL(before.url).pathname}  (Authorization 헤더: Bearer ****)  → 응답 ${before.status}, 계획 ${Array.isArray(before.json) ? before.json.length : "?"}개`);
    check("A. 요청 주소(경로·쿼리)에 토큰이 들어 있지 않다", !before.url.includes(s1.access) && !before.url.includes(s1.refresh), "주소에 토큰이 있음");
    check("A. 응답 본문에 토큰이 되돌아오지 않는다", !before.text.includes(s1.access) && !before.text.includes(s1.refresh), "응답에 토큰이 있음");

    // 같은 계정의 둘째 세션 (E: scope=local 확인용)
    const s2 = await login();
    const second = await appGet("/api/plans", s2.access);

    check("E. 같은 계정으로 만든 둘째 세션도 200", second.status === 200, `상태 ${second.status}`);
    check("E. 두 세션의 토큰은 서로 다르다", s1.access !== s2.access, "같은 토큰");

    // ===== 서명이 틀린 토큰 (C 보조) =====
    const forged = await appGet("/api/plans", tamperExp(s1.access));

    check("C. 본문(exp)을 바꾼 토큰(서명 불일치)은 401", forged.status === 401, `상태 ${forged.status}`);

    // ===== B. 로그아웃 후 같은 요청 =====
    const out = await authCall("POST", "/auth/v1/logout?scope=local", { token: s1.access });

    check("B. 로그아웃 요청(scope=local) 성공", out.status === 204 || out.status === 200, `상태 ${out.status}`);

    const after = await appGet("/api/plans", s1.access);

    check("B. 로그아웃 후 같은 메서드·같은 주소·같은 토큰 → 401", after.status === 401 && after.url === before.url, `상태 ${after.status}`);
    info(`요청: GET ${new URL(after.url).pathname}  (Authorization 헤더: Bearer ****, 로그아웃 전과 같은 토큰)  → 응답 ${after.status} ${after.json?.error ? `"${after.json.error}"` : ""}`);
    info("두 요청의 차이는 '그 사이에 로그아웃이 일어났다'는 것뿐이다. (주소·메서드·토큰 동일)");

    const direct = await authCall("GET", "/auth/v1/user", { token: s1.access });

    check("B. Supabase Auth 서버에 직접 물어도 그 토큰이 거절된다 (401/403)", direct.status === 401 || direct.status === 403, `상태 ${direct.status} — 200이면 폐기된 세션의 토큰이 아직 통한다는 뜻이므로 설명서에 그대로 적어야 한다`);
    info(`Auth 서버 직접 확인: GET /auth/v1/user → ${direct.status} ${direct.json?.error_code ?? direct.json?.code ?? ""}`);

    const refreshed = await authCall("POST", "/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s1.refresh } });

    check("B. 로그아웃한 세션의 리프레시 토큰으로는 새 토큰을 받을 수 없다", refreshed.status >= 400 && !refreshed.json?.access_token, `상태 ${refreshed.status}`);
    info(`리프레시 토큰 교환 → ${refreshed.status} ${refreshed.json?.error_code ?? refreshed.json?.error ?? ""}`);

    // ===== E. 현재 기기 세션만 폐기 =====
    const secondAfter = await appGet("/api/plans", s2.access);

    check("E. 로그아웃(scope=local) 후에도 같은 계정의 다른 세션은 계속 유효하다", secondAfter.status === 200, `상태 ${secondAfter.status}`);
    info("→ 로그아웃은 '이 기기만' 폐기한다. 모든 기기를 끊으려면 scope=global 이 필요하지만 현재 구현은 쓰지 않는다.");

    // ===== C. 실제 만료 시험 (선택) =====
    if (waitExpiry) {
      const s3 = await login();
      const m3 = describeToken(s3.access);

      if (!m3?.expiresAt) throw new Error("만료 시각을 읽을 수 없어 만료 시험을 할 수 없습니다.");

      const live = await appGet("/api/plans", s3.access);

      check("C. 만료 전에는 같은 토큰이 200", live.status === 200, `상태 ${live.status}`);

      const target = (m3.expiresAt + 10) * 1000;

      console.log(`      만료 시험: ${iso(m3.expiresAt)} 에 만료되는 토큰을 ${Math.ceil((target - Date.now()) / 60000)}분 기다립니다. (이 사이 이 창을 닫지 마세요)`);

      while (Date.now() < target) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(60000, Math.max(1000, target - Date.now()))));
      }

      const expired = await appGet("/api/plans", s3.access);

      check("C. 만료 시각이 지난 뒤 같은 토큰 → 401", expired.status === 401, `상태 ${expired.status}`);

      const expiredDirect = await authCall("GET", "/auth/v1/user", { token: s3.access });

      check("C. 만료 후 Auth 서버에 직접 물어도 거절 (401/403)", expiredDirect.status === 401 || expiredDirect.status === 403, `상태 ${expiredDirect.status}`);
    } else {
      console.log("\n(만료 시험 건너뜀) 실제 만료 거절은 --wait-expiry 로 약 1시간 기다려야 확인된다. 이 실행에서는 확인하지 않았으므로 통과로 보고하면 안 됩니다.");
    }
  } catch (error) {
    failed++;
    console.log("ERROR ", error.message);
  } finally {
    // 만든 세션을 모두 정리 (이미 폐기된 것은 오류가 나도 무시)
    for (const token of sessions) {
      try {
        await authCall("POST", "/auth/v1/logout?scope=local", { token });
      } catch {
        // 무시
      }
    }
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} 통과, 실패 ${failed}`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
