// 통계 정확도 + 내보내기 검증 (과제 7 카드 5). 실제 Supabase와 연결된 서버를 대상으로 한다.
//
// 사용법 (서버: npm run dev 또는 배포 주소):
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 키> \
//   TEST_EMAIL_A=<a-test> TEST_PASSWORD_A=<비밀번호> TEST_EMAIL_B=<b-test> TEST_PASSWORD_B=<비밀번호> \
//   node scripts/verify-stats-export.mjs [서버 주소, 기본 http://localhost:3000]
//
// 시험 자료 (A 계정, 제목 [STATS-TEST]): 계획 예상 100분, 할 일 4개
//   T1 예상 10분: 시작 → 2초 → 일시정지 → 1초 → 재개 → 2초 → 종료         (완료, 구간 2개)
//   T2 예상 20분: 시작 → 2초 → 일시정지                                   (진행 중, 실행은 끝나지 않음, 구간 1개)
//   T3 예상 30분: 시작 → 1초 → 종료 → 할 일 삭제(소프트)                   (집계에서 빠져야 함)
//   T4 예상 40분: 실행 없음                                               (할 일)
// 직접 계산한 기대값 (아래 expected): 할 일 3개(삭제 제외), 완료 1, 진행 중 1, 할 일 1, 완료율 1/3 = 0.3333,
//   할 일 예상 합계 70분(삭제된 T3 제외), 실행 2번, 진행 중 실행 1, 작업 시간 = T1·T2 구간 길이 합.
// 작업 시간 기대값은 API 응답이 준 각 구간의 시작·종료 시각에서 이 스크립트가 직접 더해 만든다.
// 시간은 반올림 때문에 1초 이내 차이를 허용한다. (DB는 합계를 초 단위로 반올림, 여기서는 밀리초로 계산)
//
// 비밀번호·토큰은 출력하지 않는다. 시험 자료는 삭제 API가 없어 남는다. ([STATS-TEST] 제목으로 구분)

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { NEXT_PUBLIC_SUPABASE_URL: SB_URL0, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SB_KEY, TEST_EMAIL_A, TEST_PASSWORD_A, TEST_EMAIL_B, TEST_PASSWORD_B } = process.env;

if (!SB_URL0 || !SB_KEY || !TEST_EMAIL_A || !TEST_PASSWORD_A || !TEST_EMAIL_B || !TEST_PASSWORD_B) {
  console.log("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / TEST_EMAIL_A·B / TEST_PASSWORD_A·B 가 필요합니다. (파일 맨 위 사용법 참고)");
  process.exit(2);
}
const SB_URL = SB_URL0.replace(/\/$/, "");
const PREFIX = "[STATS-TEST]";
let failed = 0, total = 0;
const table = [];
const check = (name, ok, detail = "") => { total++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`); };
const short = (id) => (id ? `${String(id).slice(0, 8)}…` : "?");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const row = (metric, hand, shown, ok, basis) => { table.push(`| ${metric} | ${hand} | ${shown} | ${ok ? "일치" : "불일치"} | ${basis} |`); check(`${metric}: 직접 계산 ${hand} = 화면·API ${shown}`, ok, `직접 ${hand}, API ${shown}`); };

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SB_KEY }, body: JSON.stringify({ email, password }) });
  const j = await res.json().catch(() => null);
  if (res.status !== 200 || !j?.access_token) throw new Error(`로그인 실패 (상태 ${res.status}, 코드 ${j?.error_code ?? "?"})`);
  return { token: j.access_token, id: j.user?.id };
}
async function api(method, path, { token, body } = {}) {
  const headers = { "Idempotency-Key": `verify-stats-${Date.now()}-${Math.random().toString(36).slice(2)}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let json = null; try { json = JSON.parse(text); } catch { /* JSON 아님 */ }
  return { status: res.status, json, text, buf, headers: res.headers };
}
// 최소 CSV 해석기 (큰따옴표, 줄바꿈 처리)
function parseCsv(text) {
  const t = text.replace(/^﻿/, "");
  const rows = []; let cur = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { cur.push(cell); cell = ""; }
    else if (c === "\r") { /* CRLF */ }
    else if (c === "\n") { cur.push(cell); rows.push(cur); cur = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || cur.length) { cur.push(cell); rows.push(cur); }
  const [header, ...body] = rows;
  return { header, records: body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))) };
}
const segSeconds = (segs) => segs.reduce((s, g) => s + ((g.ended_at ? new Date(g.ended_at).getTime() : Date.now()) - new Date(g.started_at).getTime()) / 1000, 0);

try {
  const A = await login(TEST_EMAIL_A, TEST_PASSWORD_A);
  const B = await login(TEST_EMAIL_B, TEST_PASSWORD_B);
  check("A와 B는 서로 다른 사용자다", !!A.id && A.id !== B.id);

  // ===== 시험 자료 만들기 =====
  const mkPlan = await api("POST", "/api/plans", { token: A.token, body: { title: `${PREFIX} 통계 검증`, estimated_minutes: 100 } });
  check("A: 시험 계획을 만들었다 (201)", mkPlan.status === 201, `상태 ${mkPlan.status} ${mkPlan.text.slice(0, 120)}`);
  const planId = mkPlan.json?.id;
  if (!planId) throw new Error("계획을 만들지 못해 중단합니다.");
  const mkTodo = async (title, est) => (await api("POST", `/api/plans/${planId}/todos`, { token: A.token, body: { title: `${PREFIX} ${title}`, estimated_minutes: est } })).json?.id;
  const [t1, t2, t3, t4] = [await mkTodo("T1", 10), await mkTodo("T2", 20), await mkTodo("T3", 30), await mkTodo("T4", 40)];
  check("A: 할 일 4개를 만들었다", [t1, t2, t3, t4].every(Boolean));
  const start = async (t) => (await api("POST", `/api/todos/${t}/executions`, { token: A.token, body: {} })).json?.execution?.id;
  const act = async (e, a) => (await api("POST", `/api/executions/${e}/${a}`, { token: A.token, body: {} })).json;

  console.log("      실행 시뮬레이션 중… (약 12초)");
  const e1 = await start(t1); await sleep(2000); await act(e1, "pause"); await sleep(1000); await act(e1, "resume"); await sleep(2000); const r1 = await act(e1, "end");
  const e2 = await start(t2); await sleep(2000); const r2 = await act(e2, "pause");
  const e3 = await start(t3); await sleep(1000); await act(e3, "end");
  const delT3 = await api("DELETE", `/api/todos/${t3}`, { token: A.token });
  check("T3 소프트 삭제 (204)", delT3.status === 204, `상태 ${delT3.status}`);
  check("T1 종료 결과: 구간 2개", r1?.segments?.length === 2, JSON.stringify(r1?.segments?.length));
  check("T2 일시정지 결과: 구간 1개", r2?.segments?.length === 1, JSON.stringify(r2?.segments?.length));

  // ===== 직접 계산 =====
  const secT1 = segSeconds(r1.segments), secT2 = segSeconds(r2.segments);
  const expected = { total: 3, todo: 1, in_progress: 1, completed: 1, rate: 0.3333, todosEst: 70, planEst: 100, execCount: 2, active: 1, work: secT1 + secT2 };

  // ===== API 값 =====
  const sumRes = await api("GET", `/api/plans/${planId}/summary`, { token: A.token });
  check("GET /api/plans/{id}/summary → 200", sumRes.status === 200, `상태 ${sumRes.status}`);
  const S = sumRes.json;
  console.log(`\n--- 통계 대조 (계획 ${short(planId)}) ---`);
  table.push("| 지표 | 직접 계산 | 화면·API 값 | 일치 | 근거 |", "|---|---|---|---|---|");
  table.length = 2;
  row("할 일 수(삭제 제외)", expected.total, S.todo_counts.total, S.todo_counts.total === expected.total, "T1·T2·T4. T3는 소프트 삭제");
  row("완료 / 진행 중 / 할 일", "1 / 1 / 1", `${S.todo_counts.completed} / ${S.todo_counts.in_progress} / ${S.todo_counts.todo}`, S.todo_counts.completed === 1 && S.todo_counts.in_progress === 1 && S.todo_counts.todo === 1, "T1 종료=완료, T2 시작=진행 중, T4 실행 없음");
  row("완료율", "1/3 → 0.3333", S.completion_rate, S.completion_rate === expected.rate, "완료 ÷ 삭제 제외 전체, 소수 넷째 자리 반올림");
  row("할 일 예상 합계(분)", expected.todosEst, S.estimated_minutes.todos, S.estimated_minutes.todos === expected.todosEst, "10+20+40, 삭제된 T3(30) 제외");
  row("계획 예상(분)", expected.planEst, S.estimated_minutes.plan, S.estimated_minutes.plan === expected.planEst, "계획에 입력한 값");
  row("실행 횟수", expected.execCount, S.actual.execution_count, S.actual.execution_count === expected.execCount, "T1·T2 각 1회, 삭제된 T3 제외");
  row("끝나지 않은 실행", expected.active, S.actual.active_execution_count, S.actual.active_execution_count === expected.active, "T2 (일시정지, 종료 안 함)");
  const dw = Math.abs(S.actual.work_seconds - expected.work);
  row("작업 시간(초)", expected.work.toFixed(1), S.actual.work_seconds, dw <= 1, "응답 구간의 시작·종료 시각 차의 합 (T1 2구간 + T2 1구간), ±1초 허용");
  const s1 = S.todos.find((x) => x.id === t1), s2 = S.todos.find((x) => x.id === t2);
  row("T1 작업 시간(초)", secT1.toFixed(1), s1?.work_seconds, !!s1 && Math.abs(s1.work_seconds - secT1) <= 1, "일시정지 1초는 제외된다");
  row("T2 작업 시간(초)", secT2.toFixed(1), s2?.work_seconds, !!s2 && Math.abs(s2.work_seconds - secT2) <= 1, "일시정지 시점에 구간이 닫혀 있음");
  check("삭제된 T3가 todos 목록에 없다", !S.todos.some((x) => x.id === t3));
  check("분 환산: work_minutes = 초/60 소수 첫째 자리", S.actual.work_minutes === Math.round((S.actual.work_seconds / 60) * 10) / 10, `${S.actual.work_minutes} vs ${S.actual.work_seconds}`);
  console.log("\n" + table.join("\n"));

  // ===== 내보내기 =====
  console.log("\n--- 내보내기 ---");
  const exNo = await api("GET", "/api/export");
  check("비로그인 GET /api/export → 401", exNo.status === 401, `상태 ${exNo.status}`);
  const exPlanNo = await api("GET", `/api/plans/${planId}/export`);
  check("비로그인 GET /api/plans/{id}/export → 401", exPlanNo.status === 401, `상태 ${exPlanNo.status}`);

  const mkB = await api("POST", "/api/plans", { token: B.token, body: { title: `${PREFIX} B 전용(A에게 보이면 안 됨)` } });
  const bPlanId = mkB.json?.id;
  check("B: 비공개 시험 계획을 만들었다 (201)", mkB.status === 201 && !!bPlanId, `상태 ${mkB.status}`);

  const exTodos = await api("GET", "/api/export?type=todos", { token: A.token });
  check("A: GET /api/export?type=todos → 200, CSV", exTodos.status === 200 && /text\/csv/.test(exTodos.headers.get("content-type") ?? ""), `상태 ${exTodos.status}`);
  console.log(`      파일 이름: ${/filename="([^"]+)"/.exec(exTodos.headers.get("content-disposition") ?? "")?.[1] ?? "?"}`);
  const csvTodos = parseCsv(exTodos.text);
  check("UTF-8 BOM과 CRLF 줄 끝", exTodos.buf[0] === 0xef && exTodos.buf[1] === 0xbb && exTodos.buf[2] === 0xbf && exTodos.text.includes("\r\n"));
  const mine = (await api("GET", "/api/plans", { token: A.token })).json ?? [];
  const mineIds = new Set(mine.map((p) => p.id));
  const csvPlanIds = new Set(csvTodos.records.map((r) => r.plan_id));
  check("CSV의 계획 ID가 모두 A에게 보이는 계획(내 계획+예시)이다", [...csvPlanIds].every((id) => mineIds.has(id)), `밖의 ID ${[...csvPlanIds].filter((id) => !mineIds.has(id)).map(short)}`);
  check("A에게 보이는 모든 계획이 CSV에 있다 (누락 없음)", [...mineIds].every((id) => csvPlanIds.has(id)), `누락 ${[...mineIds].filter((id) => !csvPlanIds.has(id)).map(short)}`);
  check("B의 계획이 A의 CSV에 없다 (ID·제목)", !csvPlanIds.has(bPlanId) && !exTodos.text.includes("B 전용"));
  const keyList = csvTodos.records.map((r) => `${r.plan_id}|${r.todo_id}`);
  check("중복 행이 없다", new Set(keyList).size === keyList.length, `행 ${keyList.length}, 고유 ${new Set(keyList).size}`);
  const mineRows = csvTodos.records.filter((r) => r.plan_id === planId);
  check("시험 계획의 행은 4개(삭제된 T3 포함, deleted_at 표시)", mineRows.length === 4, `행 ${mineRows.length}`);
  const rT3 = mineRows.find((r) => r.todo_id === t3);
  check("T3 행의 todo_deleted_at 이 채워져 있다", !!rT3?.todo_deleted_at);
  const rT1 = mineRows.find((r) => r.todo_id === t1);
  check("T1 행: 상태 completed, 실행 1, work_seconds 가 summary 와 ±1초", rT1?.todo_status === "completed" && rT1.execution_count === "1" && Math.abs(Number(rT1.work_seconds) - s1.work_seconds) <= 1, JSON.stringify(rT1 && { s: rT1.todo_status, c: rT1.execution_count, w: rT1.work_seconds }));
  const csvWork = mineRows.filter((r) => r.todo_id !== t3).reduce((s, r) => s + Number(r.work_seconds || 0), 0);
  check("CSV 작업 시간 합(삭제 제외) = summary 작업 시간 (±2초)", Math.abs(csvWork - S.actual.work_seconds) <= 2, `CSV ${csvWork}, summary ${S.actual.work_seconds}`);

  const exExec = parseCsv((await api("GET", "/api/export?type=executions", { token: A.token })).text);
  const execMine = exExec.records.filter((r) => r.plan_id === planId);
  check("executions CSV: 시험 계획의 실행 3건(T1·T2·T3)", execMine.length === 3, `행 ${execMine.length}`);
  check("executions CSV 에 B의 계획이 없다", !exExec.records.some((r) => r.plan_id === bPlanId));

  const spoof = await api("GET", `/api/export?type=todos&user_id=${B.id}&owner_id=${B.id}`, { token: A.token });
  const spoofIds = new Set(parseCsv(spoof.text).records.map((r) => r.plan_id));
  check("A가 ?user_id=B 를 붙여도 결과가 같다 (무시됨)", spoof.status === 200 && spoofIds.size === csvPlanIds.size && [...spoofIds].every((id) => csvPlanIds.has(id)) && !spoofIds.has(bPlanId), `상태 ${spoof.status}`);
  const bExport = parseCsv((await api("GET", "/api/export?type=todos", { token: B.token })).text);
  check("B의 CSV 에는 A의 시험 계획이 없다", !bExport.records.some((r) => r.plan_id === planId));
  const crossPlan = await api("GET", `/api/plans/${bPlanId}/export`, { token: A.token });
  check("A가 B의 계획 export 를 요청 → 404", crossPlan.status === 404, `상태 ${crossPlan.status}`);
  const onePlan = await api("GET", `/api/plans/${planId}/export?type=todos`, { token: A.token });
  check("A: 내 계획 하나 export → 200, 행 4개", onePlan.status === 200 && parseCsv(onePlan.text).records.length === 4, `상태 ${onePlan.status}`);
  const bad = await api("GET", "/api/export?type=nonsense", { token: A.token });
  check("알 수 없는 type → 400", bad.status === 400, `상태 ${bad.status}`);

  console.log("\n--- DB 대조용 정보 (제가 읽기 전용 SQL로 비교합니다) ---");
  console.log(`      A 시험 계획 ID: ${short(planId)}  (T1 ${short(t1)}, T2 ${short(t2)}, T3 ${short(t3)}, T4 ${short(t4)})`);
  console.log(`      B 시험 계획 ID: ${short(bPlanId)}`);
  console.log(`      CSV(todos) 전체 행 ${csvTodos.records.length}, 고유 계획 ${csvPlanIds.size}, executions CSV 전체 행 ${exExec.records.length}`);
} catch (error) {
  failed++;
  console.log("ERROR ", error.message);
}
console.log(`\n${total - failed}/${total} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
