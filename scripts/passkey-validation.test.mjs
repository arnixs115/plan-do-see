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
} from "../lib/passkeys/validation.ts";

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
