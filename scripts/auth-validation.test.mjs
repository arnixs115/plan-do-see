// 가입·로그인 입력 검사와 오류 문구의 단위 시험. 서버나 DB가 필요 없다.
//   node --test scripts/auth-validation.test.mjs
// (TypeScript 파일을 바로 불러오므로 Node 22.18 이상 또는 --experimental-strip-types 가 필요하다.)

import test from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_FAILED_MESSAGE,
  AUTH_UNAVAILABLE_MESSAGE,
  AUTH_RATE_LIMITED_MESSAGE,
  normalizeEmail,
  passwordProblem,
  classifyAuthError,
  loginErrorMessage,
} from "../lib/auth/validation.ts";

test("이메일: 공백 제거 + 소문자, 형식이 아니면 null", () => {
  assert.equal(normalizeEmail("  User@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail("a@b.co"), "a@b.co");
  for (const bad of ["", "   ", "abc", "a@b", "a b@c.com", "@c.com", "a@", null, undefined, 123]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
  assert.equal(normalizeEmail("a".repeat(250) + "@b.co"), null, "254자 초과");
});

test("비밀번호: 8자 이상, 72바이트 이하", () => {
  assert.equal(passwordProblem("12345678"), null);
  assert.match(passwordProblem("1234567"), /8자 이상/);
  assert.match(passwordProblem(""), /입력/);
  assert.match(passwordProblem(undefined), /입력/);
  assert.equal(passwordProblem("a".repeat(72)), null, "72바이트는 허용");
  assert.match(passwordProblem("a".repeat(73)), /너무 깁니다/);
  // 한글은 한 글자 3바이트: 24자 = 72바이트(허용), 25자 = 75바이트(거절)
  assert.equal(passwordProblem("가".repeat(24)), null);
  assert.match(passwordProblem("가".repeat(25)), /너무 깁니다/);
});

test("로그인 실패 문구: 없는 계정·틀린 비밀번호·미확인·형식 오류가 모두 같은 문구", () => {
  const errors = [
    { name: "AuthApiError", status: 400, code: "invalid_credentials" }, // 없는 이메일 또는 틀린 비밀번호
    { name: "AuthApiError", status: 400, code: "email_not_confirmed" },
    { name: "AuthApiError", status: 400, code: "user_not_found" },
    { name: "AuthApiError", status: 422, code: "validation_failed" },
    { name: "AuthApiError", status: 400 },
    {},
  ];
  for (const error of errors) {
    assert.equal(loginErrorMessage(error), LOGIN_FAILED_MESSAGE, JSON.stringify(error));
  }
});

test("서버 장애와 요청 과다만 다른 문구 (계정 존재 여부와 무관한 경우)", () => {
  assert.equal(classifyAuthError({ name: "AuthRetryableFetchError", status: 0 }), "unavailable");
  assert.equal(classifyAuthError({ status: 502 }), "unavailable");
  assert.equal(classifyAuthError({ status: 429 }), "rate_limited");
  assert.equal(classifyAuthError({ code: "over_request_rate_limit" }), "rate_limited");
  assert.equal(loginErrorMessage({ name: "AuthRetryableFetchError" }), AUTH_UNAVAILABLE_MESSAGE);
  assert.equal(loginErrorMessage({ status: 429 }), AUTH_RATE_LIMITED_MESSAGE);
});
