// 사용자별 자료 접근 통제 검증 (과제 7 카드 4). 실제 Supabase와 연결된 서버를 대상으로 한다.
//
// 사용법:  1) 터미널 A:  npm run dev          (또는 배포 주소를 첫 인자로 준다)
//          2) 터미널 B:
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//   TEST_EMAIL_A=<시험 계정 A> TEST_PASSWORD_A=<비밀번호> \
//   TEST_EMAIL_B=<시험 계정 B> TEST_PASSWORD_B=<비밀번호> \
//   [ADMIN_EMAIL=<admin 시험 계정> ADMIN_PASSWORD=<비밀번호>] \
//   node scripts/verify-access.mjs [서버 주소, 기본 http://localhost:3000]
//
// 하는 일
//   1. A와 B가 각자 계획 2개, 할 일 각 2개, 실행 1개를 만든다. (제목에 [ACCESS-TEST-A] / [ACCESS-TEST-B])
//   2. A→B, B→A 방향으로 읽기·수정·삭제를 시도하고 거절(403 또는 404)을 확인한다.
//   3. 사용자 ID 위조(본문·쿼리·헤더), 목록 격리, 비로그인 호출, 예시 계획 쓰기 거절을 확인한다.
//   4. 시도 전후로 양쪽 자료(건수, ID 목록, 내용)가 그대로인지 비교한다.
//   5. 끝에 마크다운 표로 요청·응답 상태를 출력한다. (제출문에 붙일 수 있다. 토큰·비밀번호는 없다)
//
// 주의
//  * 비밀번호·토큰은 출력하지 않는다.
//  * 계획 삭제 API가 없어서 시험 계획은 DB에 남는다. (할 일은 소프트 삭제 API가 있다.) 정리는 [ACCESS-TEST-] 접두사로 한다.
//  * 시험 계정 자료만 건드린다. 예시 계획에는 admin 시험(선택)에서만 쓰며, 만든 할 일은 바로 지운다.

const args = process.argv.slice(2);
const BASE = (args.find((arg) => !arg.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const {
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY,
  TEST_EMAIL_A, TEST_PASSWORD_A, TEST_EMAIL_B, TEST_PASSWORD_B, ADMIN_EMAIL, ADMIN_PASSWORD,
} = process.env;

if (!NEXT_PUBLIC_SUPABASE_URL || !SB_KEY || !TEST_EMAIL_A || !TEST_PASSWORD_A || !TEST_EMAIL_B || !TEST_PASSWORD_B) {
  console.log("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL_A·B / TEST_PASSWORD_A·B 가 필요합니다. (파일 맨 위 사용법 참고)");
  process.exit(2);
}

const SB_URL = NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
let failed = 0;
let total = 0;
const evidence = []; // 마크다운 표용

function check(name, ok, detail = "") {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);

  if (res.status !== 200 || !json?.access_token) {
    throw new Error(`시험 계정 로그인 실패 (상태 ${res.status}, 코드 ${json?.error_code ?? "?"}). 계정과 비밀번호를 확인하세요.`);
  }

  return { token: json.access_token, id: json.user?.id };
}

async function api(method, path, { token, body, headers = {} } = {}) {
  const h = { ...headers };

  if (body !== undefined) h["Content-Type"] = "application/json; charset=utf-8";
  if (token) h.Authorization = `Bearer ${token}`;
  if (method === "POST" && path.endsWith("/executions")) h["Idempotency-Key"] = `access-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    // JSON 아님 (CSV 등)
  }

  return { status: res.status, json, text };
}

const short = (id) => (id ? `${id.slice(0, 8)}…` : "?");
const REFUSED = [403, 404];

try {
  const A = { name: "A", ...(await login(TEST_EMAIL_A, TEST_PASSWORD_A)) };
  const B = { name: "B", ...(await login(TEST_EMAIL_B, TEST_PASSWORD_B)) };

  check("계정 A와 B는 서로 다른 사용자다", A.id && B.id && A.id !== B.id, "같은 계정");

  // ===== 1. 자료 만들기 =====
  console.log("\n--- 1. 시험 자료 만들기 ---");
  const owned = { A: { plans: [], todos: [], executions: [] }, B: { plans: [], todos: [], executions: [] } };

  for (const who of [A, B]) {
    for (let n = 1; n <= 2; n++) {
      const plan = await api("POST", "/api/plans", { token: who.token, body: { title: `[ACCESS-TEST-${who.name}] 계획 ${n}`, description: `${who.name} 소유 시험 자료` } });
      check(`${who.name}: 계획 ${n} 생성 201, 소유자는 ${who.name}`, plan.status === 201 && plan.json?.user_id === who.id, `${plan.status} ${plan.text.slice(0, 100)}`);
      if (plan.status !== 201) throw new Error("시험 자료를 만들 수 없어 중단합니다.");
      owned[who.name].plans.push(plan.json.id);

      for (let t = 1; t <= 2; t++) {
        const todo = await api("POST", `/api/plans/${plan.json.id}/todos`, { token: who.token, body: { title: `[ACCESS-TEST-${who.name}] 계획${n} 할 일 ${t}` } });
        check(`${who.name}: 계획 ${n}의 할 일 ${t} 생성 201`, todo.status === 201, `${todo.status} ${todo.text.slice(0, 100)}`);
        if (todo.status !== 201) throw new Error("시험 자료를 만들 수 없어 중단합니다.");
        owned[who.name].todos.push(todo.json.id);
      }
    }

    const exec = await api("POST", `/api/todos/${owned[who.name].todos[0]}/executions`, { token: who.token });
    check(`${who.name}: 실행 시작 201`, exec.status === 201 && !!exec.json?.execution?.id, `${exec.status} ${exec.text.slice(0, 100)}`);
    if (exec.status !== 201) throw new Error("시험 자료를 만들 수 없어 중단합니다.");
    owned[who.name].executions.push(exec.json.execution.id);
  }

  console.log("\n검증용 자료 표 (테스트 ID, 소유자):");
  for (const who of ["A", "B"]) {
    console.log(`  ${who}: 계획 ${owned[who].plans.map(short).join(", ")} / 할 일 ${owned[who].todos.map(short).join(", ")} / 실행 ${owned[who].executions.map(short).join(", ")}`);
  }

  // ===== 스냅샷: 각 계정이 자기 API로 자기 자료를 읽는다 =====
  async function snapshot(who) {
    const list = await api("GET", "/api/plans", { token: who.token });
    // 제목이 바뀌어도(남이 고쳤다면) 같은 자료로 세도록, 만든 ID 목록과 제목 접두사를 함께 본다.
    const mine = (list.json ?? []).filter((p) => p.user_id === who.id && (owned[who.name].plans.includes(p.id) || p.title.startsWith(`[ACCESS-TEST-${who.name}]`)));
    const planIds = mine.map((p) => p.id).sort();
    const todos = {};

    for (const id of planIds) {
      const r = await api("GET", `/api/plans/${id}/todos`, { token: who.token });
      todos[id] = (r.json ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, updated_at: t.updated_at, deleted_at: t.deleted_at ?? null })).sort((a, b) => a.id.localeCompare(b.id));
    }

    const execs = [];

    for (const id of owned[who.name].executions) {
      const r = await api("GET", `/api/executions/${id}`, { token: who.token });
      // 작업 시간(work_seconds)은 시간이 지나면 변하므로 비교에서 뺀다. 실행 행과 구간 목록(시작·종료 시각)을 비교한다.
      execs.push({ id, state: r.json?.status ?? "?", http: r.status, raw: JSON.stringify({ execution: r.json?.execution ?? null, segments: r.json?.segments ?? null }) });
    }

    return { plans: mine.map((p) => ({ id: p.id, title: p.title, description: p.description, priority: p.priority, user_id: p.user_id, is_example: p.is_example, updated_at: p.updated_at })).sort((a, b) => a.id.localeCompare(b.id)), planIds, todos, execs, list: list.json ?? [] };
  }

  const before = { A: await snapshot(A), B: await snapshot(B) };

  check("시험 전 스냅샷: A 계획 2개·할 일 4개, B 계획 2개·할 일 4개",
    before.A.planIds.length === 2 && before.B.planIds.length === 2 &&
    Object.values(before.A.todos).flat().length === 4 && Object.values(before.B.todos).flat().length === 4,
    JSON.stringify({ A: before.A.planIds.length, B: before.B.planIds.length }));

  // ===== 2. 양방향 접근 시도 =====
  console.log("\n--- 2. 양방향 접근 시도 (A→B, B→A) ---");

  async function attack(attacker, victim) {
    const P = owned[victim.name].plans[0];
    const T = owned[victim.name].todos[0];
    const T2 = owned[victim.name].todos[1];
    const E = owned[victim.name].executions[0];
    const victimTitles = [`[ACCESS-TEST-${victim.name}]`];
    const tests = [
      ["읽기", "GET", `/api/plans/${P}`],
      ["읽기", "GET", `/api/plans/${P}/todos`],
      ["읽기", "GET", `/api/plans/${P}/summary`],
      ["읽기", "GET", `/api/plans/${P}/export`],
      ["읽기", "GET", `/api/todos/${T}`],
      ["읽기", "GET", `/api/executions/${E}`],
      ["수정", "PATCH", `/api/plans/${P}`, { title: "HACKED-PLAN" }],
      ["수정", "PATCH", `/api/todos/${T}`, { title: "HACKED-TODO", status: "completed" }],
      ["수정", "POST", `/api/plans/${P}/todos`, { title: "INJECTED-TODO" }],
      ["수정", "POST", `/api/todos/${T2}/executions`, undefined],
      ["수정", "POST", `/api/executions/${E}/pause`, undefined],
      ["수정", "POST", `/api/executions/${E}/end`, {}],
      ["삭제", "DELETE", `/api/todos/${T}`],
    ];

    for (const [kind, method, path, body] of tests) {
      const r = await api(method, path, { token: attacker.token, body });
      const refused = REFUSED.includes(r.status);
      const leaked = victimTitles.some((marker) => r.text.includes(marker)) || r.text.includes(victim.id);

      check(`${attacker.name}→${victim.name} ${kind}: ${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => short(m))} → ${r.status}`, refused && !leaked,
        refused ? "응답에 상대 자료가 포함됨" : `거절되지 않음(상태 ${r.status}): ${r.text.slice(0, 100)}`);
      evidence.push({ who: `${attacker.name}→${victim.name}`, kind, request: `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => short(m))}`, status: r.status, body: r.json?.error ? String(r.json.error) : r.text.slice(0, 60).replace(/\|/g, "/") });
    }
  }

  await attack(A, B);
  await attack(B, A);

  // ===== 3. 위조 =====
  console.log("\n--- 3. 사용자 ID 위조·목록 격리 ---");

  const forged = await api("POST", "/api/plans", { token: A.token, body: { title: "[ACCESS-TEST-A] 위조 시도", user_id: B.id, owner_id: B.id, is_example: true } });
  check("본문에 B의 user_id·is_example 을 넣어 만들어도 소유자는 A, 예시 아님", forged.status === 201 && forged.json?.user_id === A.id && forged.json?.is_example === false, `${forged.status} ${forged.text.slice(0, 120)}`);
  evidence.push({ who: "A", kind: "위조(본문)", request: "POST /api/plans {user_id: B, is_example: true}", status: forged.status, body: `user_id=A, is_example=${forged.json?.is_example}` });
  if (forged.json?.id) owned.A.plans.push(forged.json.id);

  const patchForge = await api("PATCH", `/api/plans/${owned.A.plans[1]}`, { token: A.token, body: { description: "소유자 변경 시도", user_id: B.id, is_example: true } });
  const afterForge = await api("GET", `/api/plans/${owned.A.plans[1]}`, { token: A.token });
  check("내 계획을 PATCH 하며 본문에 B의 user_id 를 넣어도 소유자가 바뀌지 않는다", afterForge.json?.user_id === A.id && afterForge.json?.is_example === false, `PATCH ${patchForge.status}, 소유자 ${afterForge.json?.user_id === A.id ? "A" : "다름"}`);
  evidence.push({ who: "A", kind: "위조(본문 PATCH)", request: "PATCH /api/plans/<A계획> {user_id: B}", status: patchForge.status, body: `소유자=${afterForge.json?.user_id === A.id ? "A 그대로" : "변경됨"}` });

  for (const [label, path, headers] of [
    ["쿼리 ?user_id=B", `/api/plans?user_id=${B.id}`, {}],
    ["쿼리 ?owner=B", `/api/plans?owner=${B.id}&userId=${B.id}`, {}],
    ["헤더 X-User-Id: B", "/api/plans", { "X-User-Id": B.id, "X-Owner-Id": B.id }],
  ]) {
    const r = await api("GET", path, { token: A.token, headers });
    const list = Array.isArray(r.json) ? r.json : [];
    const foreign = list.filter((p) => p.user_id && p.user_id !== A.id);

    check(`${label} 로 다른 사용자를 지정해도 A의 목록에 B의 자료가 없다`, r.status === 200 && foreign.length === 0, `상태 ${r.status}, 남의 자료 ${foreign.length}개`);
    evidence.push({ who: "A", kind: "위조(쿼리/헤더)", request: `GET ${path.replace(B.id, "<B id>")} ${Object.keys(headers).length ? "+ " + Object.keys(headers).join(",") : ""}`.trim(), status: r.status, body: `목록 ${list.length}개, 남의 자료 ${foreign.length}개` });
  }

  const csvA = await api("GET", `/api/export?user_id=${B.id}`, { token: A.token });
  check("A의 전체 내보내기(CSV)에 B의 자료 제목이 없다", csvA.status === 200 && !csvA.text.includes("[ACCESS-TEST-B]"), `상태 ${csvA.status}`);

  for (const [me, other] of [[A, B], [B, A]]) {
    const list = await api("GET", "/api/plans", { token: me.token });
    const arr = Array.isArray(list.json) ? list.json : [];
    const foreign = arr.filter((p) => p.user_id && p.user_id !== me.id);
    const otherIds = new Set([...owned[other.name].plans]);

    check(`${me.name}의 목록 응답에 ${other.name}의 계획이 하나도 없다 (전체 ${arr.length}개, 남의 소유 ${foreign.length}개)`, list.status === 200 && foreign.length === 0 && !arr.some((p) => otherIds.has(p.id)), `남의 자료 ${foreign.length}개`);
    evidence.push({ who: me.name, kind: "목록 격리", request: "GET /api/plans", status: list.status, body: `전체 ${arr.length}개, 다른 사용자 소유 ${foreign.length}개 (예시 계획 ${arr.filter((p) => p.is_example).length}개는 공개)` });
  }

  // ===== 4. 비로그인 =====
  console.log("\n--- 4. 로그인하지 않은 직접 호출 ---");
  const P_B = owned.B.plans[0];
  const T_B = owned.B.todos[0];

  for (const [method, path, body] of [["GET", "/api/plans"], ["GET", `/api/plans/${P_B}`], ["PATCH", `/api/plans/${P_B}`, { title: "x" }], ["DELETE", `/api/todos/${T_B}`], ["GET", `/api/todos/${T_B}`]]) {
    const r = await api(method, path, { body });

    check(`비로그인 ${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => short(m))} → ${r.status}`, r.status === 401, `상태 ${r.status}`);
    evidence.push({ who: "(비로그인)", kind: "비로그인", request: `${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (m) => short(m))}`, status: r.status, body: r.json?.error ? String(r.json.error) : "" });
  }

  // ===== 5. 예시 계획 =====
  console.log("\n--- 5. 예시 계획 (읽기 전용) ---");
  const listA = await api("GET", "/api/plans", { token: A.token });
  const example = (listA.json ?? []).find((p) => p.is_example);

  if (!example) {
    console.log("      예시 계획이 없어 이 부분은 건너뜁니다. (통과로 세지 않음)");
  } else {
    const exTodos = await api("GET", `/api/plans/${example.id}/todos`, { token: A.token });
    const exTodoId = exTodos.json?.[0]?.id;

    check("A는 예시 계획을 읽을 수 있다 (200)", (await api("GET", `/api/plans/${example.id}`, { token: A.token })).status === 200);

    const w1 = await api("PATCH", `/api/plans/${example.id}`, { token: A.token, body: { title: "HACKED-EXAMPLE" } });
    const w2 = await api("POST", `/api/plans/${example.id}/todos`, { token: A.token, body: { title: "INJECTED-EXAMPLE" } });

    check("A가 예시 계획을 PATCH 하면 403", w1.status === 403, `상태 ${w1.status}`);
    check("A가 예시 계획에 할 일을 추가하면 403", w2.status === 403, `상태 ${w2.status}`);
    evidence.push({ who: "A", kind: "예시 쓰기", request: "PATCH /api/plans/<예시>", status: w1.status, body: String(w1.json?.error ?? "") });
    evidence.push({ who: "A", kind: "예시 쓰기", request: "POST /api/plans/<예시>/todos", status: w2.status, body: String(w2.json?.error ?? "") });

    if (exTodoId) {
      const w3 = await api("DELETE", `/api/todos/${exTodoId}`, { token: A.token });

      check("A가 예시 계획의 할 일을 DELETE 하면 403", w3.status === 403, `상태 ${w3.status}`);
      evidence.push({ who: "A", kind: "예시 쓰기", request: "DELETE /api/todos/<예시 할 일>", status: w3.status, body: String(w3.json?.error ?? "") });
    }

    if (ADMIN_EMAIL && ADMIN_PASSWORD) {
      const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      const made = await api("POST", `/api/plans/${example.id}/todos`, { token: admin.token, body: { title: "[ACCESS-TEST-ADMIN] 예시 쓰기 시험" } });

      check("admin 계정은 예시 계획에 할 일을 추가할 수 있다 (201)", made.status === 201, `상태 ${made.status} — admins 표에 이 계정이 등록되어 있어야 한다`);
      evidence.push({ who: "admin", kind: "예시 쓰기(admin)", request: "POST /api/plans/<예시>/todos", status: made.status, body: made.status === 201 ? "추가됨" : String(made.json?.error ?? "") });

      if (made.json?.id) {
        const del = await api("DELETE", `/api/todos/${made.json.id}`, { token: admin.token });

        check("admin 이 방금 만든 시험 할 일을 지운다 (204)", del.status === 204, `상태 ${del.status}`);
      }
    } else {
      console.log("      ADMIN_EMAIL/ADMIN_PASSWORD 가 없어 admin 쓰기 시험은 건너뜁니다. (통과로 세지 않음)");
    }
  }

  // ===== 6. 전후 무결성 =====
  console.log("\n--- 6. 거절 전후 무결성 ---");
  const after = { A: await snapshot(A), B: await snapshot(B) };

  for (const who of ["A", "B"]) {
    const b = before[who];
    const a = after[who];
    const expectedPlans = who === "A" ? b.planIds.length + 1 : b.planIds.length; // A는 위조 시도 계획 1개를 자기 소유로 만들었다

    check(`${who}: 계획 건수 ${b.planIds.length} → ${a.planIds.length} (${who === "A" ? "본인이 만든 위조 시도 계획 1개 포함" : "변화 없음"})`, a.planIds.length === expectedPlans, `${a.planIds.length} (기대 ${expectedPlans})`);

    const sameIds = b.planIds.every((id) => a.planIds.includes(id));

    check(`${who}: 시험 전 계획 ID가 모두 그대로 남아 있다`, sameIds);

    const beforeTodos = JSON.stringify(b.todos);
    const afterTodos = JSON.stringify(Object.fromEntries(Object.entries(a.todos).filter(([id]) => b.todos[id])));

    check(`${who}: 계획별 할 일 건수·ID·제목·상태·updated_at·deleted_at 이 시험 전과 같다 (할 일 ${Object.values(b.todos).flat().length}개)`, beforeTodos === afterTodos, "할 일이 바뀜");
    check(`${who}: 남의 시도로 새로 생긴 할 일이 없다 (INJECTED 없음)`, !JSON.stringify(a.todos).includes("INJECTED") && !JSON.stringify(a.todos).includes("HACKED"));

    const beforePlans = JSON.stringify(b.plans.filter((p) => !p.title.includes("위조")));
    const afterPlans = JSON.stringify(a.plans.filter((p) => b.planIds.includes(p.id)));
    const planFieldsSame = who === "B" ? beforePlans === afterPlans : b.plans.filter((p) => p.id !== owned.A.plans[1]).every((p) => JSON.stringify(p) === JSON.stringify(a.plans.find((x) => x.id === p.id)));

    check(`${who}: 계획의 제목·설명·우선순위·소유자가 시험 전과 같다${who === "A" ? " (본인이 PATCH 한 계획 제외)" : ""}`, planFieldsSame, "계획이 바뀜");
    check(`${who}: 실행 기록이 시험 전과 같고 진행 중이다 (상대방의 pause/end 시도가 반영되지 않음)`, JSON.stringify(b.execs.map((e) => [e.id, e.state, e.raw])) === JSON.stringify(a.execs.map((e) => [e.id, e.state, e.raw])) && a.execs.every((e) => e.state === "running"), JSON.stringify(a.execs.map((e) => e.state)));
    evidence.push({ who: `${who}(자료)`, kind: "무결성", request: "시험 전/후 비교", status: "-", body: `계획 ${b.planIds.length}→${a.planIds.length}, 할 일 ${Object.values(b.todos).flat().length}→${Object.values(a.todos).flat().length}` });
  }

  // ===== 정리: 각자 자기 실행을 종료 =====
  for (const who of [A, B]) {
    for (const id of owned[who.name].executions) await api("POST", `/api/executions/${id}/end`, { token: who.token, body: {} });
  }

  // ===== 증거 표 =====
  console.log("\n--- 증거 표 (제출문에 붙일 수 있음. 인증 정보는 포함되지 않음) ---");
  console.log("| 계정 | 구분 | 요청 | 응답 상태 | 응답 내용 |");
  console.log("|---|---|---|---|---|");
  for (const e of evidence) console.log(`| ${e.who} | ${e.kind} | \`${e.request}\` | ${e.status} | ${String(e.body).replace(/\|/g, "/")} |`);
} catch (error) {
  failed++;
  console.log("ERROR ", error.message);
}

console.log(`\n${total - failed}/${total} 통과, 실패 ${failed}`);
console.log("정리: 시험 계획은 삭제 API가 없어 DB에 남습니다. 제목의 [ACCESS-TEST- 접두사로 찾아 지우세요.");
process.exit(failed ? 1 : 0);
