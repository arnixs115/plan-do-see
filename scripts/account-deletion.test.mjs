// 계정 삭제 확인 규칙 단위 시험: node --test scripts/account-deletion.test.mjs  (Node 22.18 이상: .ts 를 바로 읽는다)
import test from "node:test";
import assert from "node:assert/strict";
import { confirmationMatches } from "../lib/auth/account-deletion.ts";

test("내 이메일과 같으면 통과 (대소문자·앞뒤 공백 무시)", () => {
  assert.equal(confirmationMatches("me@example.com", "me@example.com"), true);
  assert.equal(confirmationMatches("  ME@Example.com ", "me@example.com"), true);
});

test("다른 이메일, 빈 값, 문자열이 아닌 값은 거절", () => {
  assert.equal(confirmationMatches("other@example.com", "me@example.com"), false);
  assert.equal(confirmationMatches("", "me@example.com"), false);
  assert.equal(confirmationMatches(undefined, "me@example.com"), false);
  assert.equal(confirmationMatches(123, "me@example.com"), false);
  assert.equal(confirmationMatches(["me@example.com"], "me@example.com"), false);
});

test("계정 이메일이 없으면(null) 어떤 입력도 거절", () => {
  assert.equal(confirmationMatches("", null), false);
  assert.equal(confirmationMatches("null", null), false);
  assert.equal(confirmationMatches("x", undefined), false);
});
