// 실제 Supabase에 연결된 서버를 대상으로 하는 종단 간(end-to-end) 확인 스크립트.
//
// 사용법:  1) 터미널 A:  npm run dev
//          2) 터미널 B:  node scripts/verify-api.mjs            (기본 http://localhost:3000)
//                        node scripts/verify-api.mjs http://localhost:3001
//
// 주의: 시험용 계획 1개("[API-TEST] ...")가 DB에 남는다. (계획 삭제 API가 아직 없다)
//       할 일은 마지막에 soft delete 한다. 비밀 키는 쓰지 않고 HTTP 호출만 한다.
// Node의 fetch는 항상 UTF-8로 보내므로 Windows 터미널에서도 한글이 깨지지 않는다.
// 실행 시간 확인 때문에 약 6초가 걸린다.

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

async function call(method, path, { body, headers = {}, raw = false } = {}) {
  const t0 = performance.now() / 1000;
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json; charset=utf-8" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const t1 = performance.now() / 1000;
  // res.text()는 UTF-8 BOM을 자동으로 제거하므로, BOM은 바이트로 직접 확인한다.
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = new TextDecoder("utf-8").decode(buf);
  let json = null;
  if (!raw) { try { json = JSON.parse(text); } catch {} }
  return { status: res.status, json, text, bom, t0, t1, type: res.headers.get("content-type") ?? "", res };
}

// CSV 한 줄 단위 파서(따옴표 안의 쉼표·줄바꿈 처리)
function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  return rows;
}

const KEY = `verify-${Date.now()}`;
const TITLE = "[API-TEST] 한글 계획, \"따옴표\"";
let planId, todoId, execId;

try {
  // 1. 계획 생성 / 수정(revision)
  let r = await call("POST", "/api/plans", { body: { title: TITLE, estimated_minutes: 60, priority: "high" } });
  check("계획 생성 201", r.status === 201 && r.json?.title === TITLE, `${r.status} ${r.text.slice(0, 200)}`);
  planId = r.json?.id;
  if (!planId) throw new Error("계획 id가 없어 중단합니다. .env.local이 새 DB를 가리키는지 확인하세요.");

  r = await call("PATCH", `/api/plans/${planId}`, { body: { description: "수정됨" } });
  check("계획 수정 200 + revision_no 1 (revision RPC)", r.status === 200 && r.json?.revision_no === 1 && r.json?.data?.description === "수정됨", `${r.status} ${r.text.slice(0, 200)}`);

  r = await call("GET", `/api/plans/${planId}`);
  check("계획 조회 200", r.status === 200 && r.json?.id === planId, `${r.status}`);

  // 2. 할 일
  r = await call("POST", `/api/plans/${planId}/todos`, { body: { title: "=할 일, 수식 시험", estimated_minutes: 10, tags: ["a", "b"] } });
  check("할 일 생성 201", r.status === 201, `${r.status} ${r.text.slice(0, 200)}`);
  todoId = r.json?.id;
  r = await call("GET", `/api/plans/${planId}/todos`);
  check("할 일 목록에 1개", r.status === 200 && Array.isArray(r.json) && r.json.length === 1, `${r.status} ${r.text.slice(0, 200)}`);

  // 3. 실행: START → PAUSE → RESUME → END
  r = await call("POST", `/api/todos/${todoId}/executions`, { headers: { "Idempotency-Key": KEY } });
  check("START 201", r.status === 201 && r.json?.status === "running", `${r.status} ${r.text.slice(0, 200)}`);
  execId = r.json?.execution?.id;
  const startCall = { t0: r.t0, t1: r.t1 };

  r = await call("POST", `/api/todos/${todoId}/executions`, { headers: { "Idempotency-Key": KEY } });
  check("START 같은 키 재요청 200 (새로 만들지 않음)", r.status === 200 && r.json?.execution?.id === execId, `${r.status}`);

  r = await call("POST", `/api/todos/${todoId}/executions`, { headers: { "Idempotency-Key": KEY + "-other" } });
  check("START 다른 키 + 진행 중 → 409", r.status === 409, `${r.status} ${r.text.slice(0, 120)}`);

  r = await call("POST", `/api/todos/${todoId}/executions`);
  check("START Idempotency-Key 없음 → 400", r.status === 400, `${r.status}`);

  await sleep(2000);
  r = await call("POST", `/api/executions/${execId}/pause`);
  check("PAUSE 200 paused", r.status === 200 && r.json?.status === "paused", `${r.status} ${r.text.slice(0, 200)}`);
  const afterPause = r.json?.work_seconds;
  const pauseCall = { t0: r.t0, t1: r.t1 };

  await sleep(1500); // 일시정지 시간: 작업 시간에서 빠져야 한다
  r = await call("GET", `/api/executions/${execId}`);
  check("일시정지 중 work_seconds가 늘지 않음", r.status === 200 && r.json?.work_seconds === afterPause, `${afterPause} -> ${r.json?.work_seconds}`);

  r = await call("POST", `/api/executions/${execId}/resume`);
  check("RESUME 200 running", r.status === 200 && r.json?.status === "running", `${r.status} ${r.text.slice(0, 200)}`);
  const resumeCall = { t0: r.t0, t1: r.t1 };

  await sleep(2000);
  r = await call("POST", `/api/executions/${execId}/end`, { body: { blocker_reason: "막힘, \"시험\"" } });
  check("END 200 ended", r.status === 200 && r.json?.status === "ended", `${r.status} ${r.text.slice(0, 200)}`);
  const workSeconds = r.json?.work_seconds;
  const endCall = { t0: r.t0, t1: r.t1 };
  // 서버가 잰 작업 시간은 "START 처리 ~ END 처리" 사이에서 일시정지 시간을 뺀 값이다.
  // 요청이 서버에 닿은 정확한 시각은 모르니(dev 서버는 첫 호출 때 컴파일하느라 느리다),
  // 클라이언트가 잰 요청/응답 시각으로 가능한 범위를 계산해 그 안에 있는지 본다.
  //   최소 = (END 요청 - START 응답) - (RESUME 응답 - PAUSE 요청)
  //   최대 = (END 응답 - START 요청) - (RESUME 요청 - PAUSE 응답)
  // 일시정지 시간이 작업 시간에 섞여 들어가면 최대값을 넘어서 FAIL이 된다.
  const lo = endCall.t0 - startCall.t1 - (resumeCall.t1 - pauseCall.t0);
  const hi = endCall.t1 - startCall.t0 - (resumeCall.t0 - pauseCall.t1);
  const SLACK = 1; // work_seconds는 반올림된 정수라 ±1초 여유
  console.log(`      (참고) 허용 범위 ${lo.toFixed(1)}~${hi.toFixed(1)}초, 서버 측정 ${workSeconds}초, 정지 구간 약 ${(resumeCall.t0 - pauseCall.t1).toFixed(1)}초`);
  check("작업 시간이 클라이언트가 잰 범위 안 (일시정지 시간 제외)", workSeconds >= lo - SLACK && workSeconds <= hi + SLACK && workSeconds >= 3, `work_seconds=${workSeconds}, 범위 ${lo.toFixed(1)}~${hi.toFixed(1)}`);

  r = await call("POST", `/api/executions/${execId}/end`);
  check("END 재요청 200 changed:false", r.status === 200 && r.json?.changed === false, `${r.status} ${r.text.slice(0, 120)}`);
  r = await call("POST", `/api/executions/${execId}/pause`);
  check("종료된 실행 PAUSE → 409", r.status === 409, `${r.status}`);

  // 4. 요약 (summary 패치가 적용된 경우만)
  r = await call("GET", `/api/plans/${planId}/summary`);
  if (r.json === null) console.log("SKIP  summary 라우트 없음 (summary 패치 미적용)");
  else {
    check("summary 200 + work_seconds 일치", r.status === 200 && r.json?.actual?.work_seconds === workSeconds, `${r.status} ${r.text.slice(0, 200)}`);
    check("summary에 work_minutes 있음", typeof r.json?.actual?.work_minutes === "number", r.text.slice(0, 200));
  }

  // 5. 내보내기 (export 패치가 적용된 경우만)
  r = await call("GET", `/api/plans/${planId}/export`, { raw: true });
  if (r.status === 404 && !r.type.includes("text/csv") && !r.text.includes("계획을 찾을 수 없습니다")) {
    console.log("SKIP  export 라우트 없음 (export 패치 미적용)");
  } else {
    check("export(todos) 200 text/csv + BOM", r.status === 200 && r.type.includes("text/csv") && r.bom, `${r.status} ${r.type} bom=${r.bom}`);
    const rows = parseCsv(r.text);
    const h = rows[0] ?? [], ix = (k) => h.indexOf(k);
    check("export(todos) 헤더+1행", rows.length === 2 && rows[1].length === h.length, `rows=${rows.length}`);
    const row = rows[1] ?? [];
    check("계획 제목(한글·따옴표) 보존", row[ix("plan_title")] === TITLE, row[ix("plan_title")]);
    check("수식 문자 방어: '=로 시작", row[ix("todo_title")] === "'=할 일, 수식 시험", row[ix("todo_title")]);
    check("work_seconds가 END와 일치", Number(row[ix("work_seconds")]) === workSeconds, `${row[ix("work_seconds")]} vs ${workSeconds}`);

    r = await call("GET", `/api/plans/${planId}/export?type=executions`, { raw: true });
    const er = parseCsv(r.text);
    const eh = er[0] ?? [];
    check("export(executions) 1행, status ended", r.status === 200 && er.length === 2 && er[1][eh.indexOf("status")] === "ended", `${r.status} rows=${er.length}`);
    check("blocker_reason 보존", er[1]?.[eh.indexOf("blocker_reason")] === "막힘, \"시험\"", er[1]?.[eh.indexOf("blocker_reason")]);

    r = await call("GET", `/api/export`, { raw: true });
    const ar = parseCsv(r.text);
    check("전체 export 200, 시험 계획 포함", r.status === 200 && ar.some((x) => x[0] === planId), `${r.status} rows=${ar.length}`);
  }

  // 6. 정리: 할 일 soft delete
  r = await call("DELETE", `/api/todos/${todoId}`);
  check("할 일 삭제 204", r.status === 204, `${r.status}`);
  r = await call("GET", `/api/todos/${todoId}`);
  check("삭제된 할 일 조회 404", r.status === 404, `${r.status}`);
} catch (e) {
  failed++;
  console.log("ERROR ", e.message);
}

console.log(`\n${results.length - failed}/${results.length} 통과, 실패 ${failed}`);
console.log(planId ? `시험용 계획이 남아 있습니다: ${planId}` : "");
process.exit(failed ? 1 : 0);
