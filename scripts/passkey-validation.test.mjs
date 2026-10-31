// 패스키 순수 규칙 단위 시험: node --test scripts/passkey-validation.test.mjs  (Node 22.18 이상)
import test from "node:test";
import assert from "node:assert/strict";
import { parseWebAuthnConfig } from "../lib/passkeys/config.ts";
import {
  normalizePasskeyName,
  allowedTransports,
  originHeaderAllowed,
  isUniqueViolation,
  isRegistrationResponseShape,
  isAuthenticationResponseShape,
  userHandleMatches,
} from "../lib/passkeys/validation.ts";

import { hardenCookieOptions, SESSION_COOKIE_MAX_AGE_SECONDS } from "../lib/auth/cookie-options.ts";

const PROD = { WEBAUTHN_ORIGIN: "https://plan-do-see-silk.vercel.app", WEBAUTHN_RP_ID: "plan-do-see-silk.vercel.app" };

test("설정: 개발 기본값은 localhost", () => {
  const r = parseWebAuthnConfig({}, false);
  assert.ok(r.ok);
  assert.equal(r.config.rpID, "localhost");
  assert.equal(r.config.origin, "http://localhost:3000");
});

test("설정: production 은 두 값이 모두 있어야 한다", () => {
  assert.equal(parseWebAuthnConfig({}, true).ok, false);
  assert.equal(parseWebAuthnConfig({ WEBAUTHN_ORIGIN: PROD.WEBAUTHN_ORIGIN }, true).ok, false);
  assert.ok(parseWebAuthnConfig(PROD, true).ok);
});

test("설정: 잘못된 origin·RP ID 는 거부", () => {
  assert.equal(parseWebAuthnConfig({ ...PROD, WEBAUTHN_ORIGIN: "http://plan-do-see-silk.vercel.app" }, true).ok, false);
  assert.equal(parseWebAuthnConfig({ ...PROD, WEBAUTHN_ORIGIN: "https://plan-do-see-silk.vercel.app/" }, true).ok, false);
  assert.equal(parseWebAuthnConfig({ ...PROD, WEBAUTHN_RP_ID: "https://plan-do-see-silk.vercel.app" }, true).ok, false);
  assert.equal(parseWebAuthnConfig({ ...PROD, WEBAUTHN_RP_ID: "other.example.com" }, true).ok, false);
  assert.equal(parseWebAuthnConfig({ WEBAUTHN_ORIGIN: "https://127.0.0.1", WEBAUTHN_RP_ID: "127.0.0.1" }, true).ok, false);
});

test("설정: RP ID 는 origin 호스트의 상위 도메인이면 허용", () => {
  assert.ok(parseWebAuthnConfig({ WEBAUTHN_ORIGIN: "https://app.example.com", WEBAUTHN_RP_ID: "example.com" }, true).ok);
});

test("이름: 공백 정리, 길이, 제어 문자", () => {
  assert.deepEqual(normalizePasskeyName("  내   노트북 "), { ok: true, name: "내 노트북" });
  assert.equal(normalizePasskeyName("").ok, false);
  assert.equal(normalizePasskeyName("   ").ok, false);
  assert.equal(normalizePasskeyName(123).ok, false);
  assert.equal(normalizePasskeyName("a".repeat(41)).ok, false);
  assert.ok(normalizePasskeyName("a".repeat(40)).ok);
  assert.equal(normalizePasskeyName("a\u0000b").ok, false);
  assert.equal(normalizePasskeyName("a‮b").ok, false);
});

test("transports: 알려진 값만, 중복 제거", () => {
  assert.deepEqual(allowedTransports(["internal", "usb", "internal", "evil"]), ["internal", "usb"]);
  assert.deepEqual(allowedTransports(undefined), []);
});

test("Origin 헤더: 없으면 통과, 있으면 정확히 일치해야 한다", () => {
  assert.equal(originHeaderAllowed(null, "https://a.com"), true);
  assert.equal(originHeaderAllowed("https://a.com", "https://a.com"), true);
  assert.equal(originHeaderAllowed("https://evil.com", "https://a.com"), false);
  assert.equal(originHeaderAllowed("https://a.com.evil.com", "https://a.com"), false);
});

test("고유 제약 위반 코드", () => {
  assert.equal(isUniqueViolation({ code: "23505" }), true);
  assert.equal(isUniqueViolation({ code: "23502" }), false);
  assert.equal(isUniqueViolation(null), false);
});

test("등록 결과 모양 검사", () => {
  const ok = { id: "abc", rawId: "abc", type: "public-key", response: { clientDataJSON: "x", attestationObject: "y" } };
  assert.equal(isRegistrationResponseShape(ok), true);
  assert.equal(isRegistrationResponseShape({ ...ok, type: "password" }), false);
  assert.equal(isRegistrationResponseShape({ ...ok, response: {} }), false);
  assert.equal(isRegistrationResponseShape(null), false);
  assert.equal(isRegistrationResponseShape("x"), false);
});

test("로그인 결과 모양 검사", () => {
  const ok = { id: "a", rawId: "a", type: "public-key", response: { clientDataJSON: "x", authenticatorData: "x", signature: "x" } };
  assert.equal(isAuthenticationResponseShape(ok), true);
  assert.equal(isAuthenticationResponseShape({ ...ok, response: { ...ok.response, userHandle: "dQ" } }), true);
  assert.equal(isAuthenticationResponseShape({ ...ok, response: { ...ok.response, userHandle: "" } }), false);
  assert.equal(isAuthenticationResponseShape({ ...ok, type: "password" }), false);
  assert.equal(isAuthenticationResponseShape({ ...ok, response: { clientDataJSON: "x", authenticatorData: "x" } }), false);
  assert.equal(isAuthenticationResponseShape(null), false);
  assert.equal(isAuthenticationResponseShape([]), false);
  assert.equal(isAuthenticationResponseShape({ ...ok, id: "a".repeat(1025) }), false);
});

test("userHandle: 저장된 소유자 id 와 같아야 통과, 없으면 비교하지 않음", () => {
  const uid = "11111111-1111-4111-8111-111111111111";
  const handle = Buffer.from(uid, "utf8").toString("base64url");
  assert.equal(userHandleMatches(handle, uid), true);
  assert.equal(userHandleMatches(handle, "22222222-2222-4222-8222-222222222222"), false);
  assert.equal(userHandleMatches(undefined, uid), true);
  assert.equal(userHandleMatches(null, uid), true);
  assert.equal(userHandleMatches(Buffer.from("not-the-id").toString("base64url"), uid), false);
});

test("로그인 쿠키: httpOnly, 수명은 7일 이하로 제한, 삭제(maxAge 0)는 그대로", () => {
  const long = hardenCookieOptions({ path: "/", maxAge: 400 * 24 * 60 * 60, sameSite: "lax" });
  assert.equal(long.httpOnly, true);
  assert.equal(long.maxAge, SESSION_COOKIE_MAX_AGE_SECONDS);
  assert.equal(long.sameSite, "lax");
  assert.equal(hardenCookieOptions({ maxAge: 0 }).maxAge, 0);
  assert.equal(hardenCookieOptions({ maxAge: 60 }).maxAge, 60);
  assert.equal(hardenCookieOptions({ path: "/" }).maxAge, undefined);
});
