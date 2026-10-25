// check-password-leak.mjs 가 실제로 "발견"과 "깨끗함"을 구분하는지 확인하는 시험.
//   node --test scripts/check-password-leak.test.mjs
// 서버·DB 없이 가짜 기록(HAR)과 가짜 로그로만 돌린다. (시험 전용 가짜 비밀번호 사용)

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { variantsOf, containsPassword, scanHar, scanLog } from "./check-password-leak.mjs";

const PW = "Zq7-Fake-Probe-PW-4821";
const variants = variantsOf(PW);
const SCRIPT = new URL("./check-password-leak.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function entry(overrides = {}) {
  return {
    request: { method: "POST", url: "http://localhost:3000/login", headers: [{ name: "content-type", value: "multipart/form-data" }], cookies: [], queryString: [], postData: { text: `email=a@b.co&password=${PW}` }, ...(overrides.request ?? {}) },
    response: { headers: [{ name: "content-type", value: "text/x-component" }], cookies: [], content: { text: '1:{"email":"a@b.co"}' }, ...(overrides.response ?? {}) },
  };
}

const har = (...entries) => ({ log: { entries } });

test("깨끗한 기록: 요청 본문에만 있고 금지된 칸에는 없다", () => {
  const result = scanHar(har(entry()), variants);
  assert.equal(result.requestBodyHits, 1);
  assert.equal(result.forbidden.length, 0);
});

test("응답 본문·응답 헤더·요청 주소·쿠키에 새면 잡는다", () => {
  const cases = [
    ["응답 본문", entry({ response: { content: { text: `{"echo":"${PW}"}` } } })],
    ["응답 헤더", entry({ response: { headers: [{ name: "x-debug", value: PW }] } })],
    ["요청 주소", entry({ request: { url: `http://localhost:3000/login?pw=${encodeURIComponent(PW)}` } })],
    ["응답 쿠키", entry({ response: { cookies: [{ name: "sb-x-auth-token", value: `base64-${Buffer.from(JSON.stringify({ leaked: PW })).toString("base64url")}` }] } })],
    ["요청 헤더", entry({ request: { headers: [{ name: "referer", value: `http://x/?p=${PW}` }] } })],
  ];

  for (const [field, e] of cases) {
    const result = scanHar(har(e), variants);
    assert.ok(result.forbidden.some((f) => f.field === field), `${field} 를 못 잡음: ${JSON.stringify(result.forbidden)}`);
  }
});

test("base64로 감싼 응답 본문도 푼다", () => {
  const e = entry({ response: { content: { encoding: "base64", text: Buffer.from(`pw=${PW}`).toString("base64") } } });
  assert.equal(scanHar(har(e), variants).forbidden.length, 1);
});

test("비슷하지만 다른 문자열은 잡지 않는다", () => {
  assert.equal(containsPassword("Zq7-Fake-Probe-PW-4822", variants), false);
  assert.equal(containsPassword("", variants), false);
});

test("로그: 비밀번호가 든 줄 번호만 알려 준다", () => {
  const text = ["GET / 200", `POST /login 200 body=${encodeURIComponent(PW)}`, "POST /signup 200"].join("\n");
  assert.deepEqual(scanLog(text, variants), [2]);
  assert.deepEqual(scanLog("GET / 200\nPOST /login 200", variants), []);
});

test("명령줄: 발견되면 종료 코드 1이고, 출력에 비밀번호가 없다", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leakcheck-"));
  const file = path.join(dir, "leaky.har");
  fs.writeFileSync(file, JSON.stringify(har(entry({ response: { content: { text: `oops ${PW}` } } }))));

  const run = spawnSync(process.execPath, [SCRIPT, "--har", file], { env: { ...process.env, TEST_PASSWORD: PW }, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.ok(!run.stdout.includes(PW) && !run.stderr.includes(PW), "출력에 비밀번호가 찍힘");
  assert.match(run.stdout, /FAIL/);
});

test("명령줄: 깨끗하면 종료 코드 0, 짧은 비밀번호·인자 없음은 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leakcheck-"));
  const file = path.join(dir, "clean.har");
  fs.writeFileSync(file, JSON.stringify(har(entry())));

  let run = spawnSync(process.execPath, [SCRIPT, "--har", file], { env: { ...process.env, TEST_PASSWORD: PW }, encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.ok(!run.stdout.includes(PW));

  run = spawnSync(process.execPath, [SCRIPT, "--har", file], { env: { ...process.env, TEST_PASSWORD: "short" }, encoding: "utf8" });
  assert.equal(run.status, 2);

  run = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, TEST_PASSWORD: PW }, encoding: "utf8" });
  assert.equal(run.status, 2);
});
