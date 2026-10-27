import test from "node:test";
import assert from "node:assert/strict";
import { describeToken, tamperExp } from "./verify-session.mjs";

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const SIGNATURE = "c2lnbmF0dXJlLWZvci10ZXN0";
const token = `${b64({ alg: "ES256", typ: "JWT" })}.${b64({ iat: 1000, exp: 4600, session_id: "SECRET-SESSION-ID-1234", role: "authenticated" })}.${SIGNATURE}`;

test("describeToken: 시각·유효 시간·session_id 유무만 돌려주고 값은 돌려주지 않는다", () => {
  const meta = describeToken(token);

  assert.equal(meta.issuedAt, 1000);
  assert.equal(meta.expiresAt, 4600);
  assert.equal(meta.lifetimeSeconds, 3600);
  assert.equal(meta.hasSessionId, true);
  assert.equal(meta.alg, "ES256");
  assert.ok(!JSON.stringify(meta).includes("SECRET-SESSION-ID-1234"));
  assert.ok(!JSON.stringify(meta).includes(SIGNATURE));
});

test("describeToken: 형식이 틀리면 null", () => {
  assert.equal(describeToken("abc"), null);
  assert.equal(describeToken("a.b.c"), null);
  assert.equal(describeToken(undefined), null);
});

test("tamperExp: exp 만 바뀌고 머리·서명은 그대로", () => {
  const forged = tamperExp(token);
  const [h1, , s1] = token.split(".");
  const [h2, , s2] = forged.split(".");

  assert.equal(h1, h2);
  assert.equal(s1, s2);
  assert.ok(describeToken(forged).expiresAt > 4600);
  assert.equal(describeToken(forged).issuedAt, 1000);
});
