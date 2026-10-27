// 접근 규칙 단위 시험: node --test scripts/access-rules.test.mjs  (Node 22.18 이상: .ts 를 바로 읽는다)
import test from "node:test";
import assert from "node:assert/strict";
import { decideAccess } from "../lib/auth/access-rules.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mine = { user_id: A, is_example: false };
const theirs = { user_id: B, is_example: false };
const example = { user_id: null, is_example: true };
const orphan = { user_id: null, is_example: false };

test("내 계획은 읽기·쓰기 허용", () => {
  assert.equal(decideAccess(A, mine, "read", false), "allow");
  assert.equal(decideAccess(A, mine, "write", false), "allow");
});

test("남의 계획은 읽기·쓰기 모두 not_found (admin이어도)", () => {
  for (const mode of ["read", "write"]) {
    assert.equal(decideAccess(A, theirs, mode, false), "not_found");
    assert.equal(decideAccess(A, theirs, mode, true), "not_found");
  }
});

test("없는 계획도 not_found, 소유자 없는 일반 계획도 not_found", () => {
  assert.equal(decideAccess(A, null, "read", false), "not_found");
  assert.equal(decideAccess(A, orphan, "read", false), "not_found");
  assert.equal(decideAccess(A, orphan, "write", true), "not_found");
});

test("예시 계획: 읽기는 모두, 쓰기는 admin만", () => {
  assert.equal(decideAccess(A, example, "read", false), "allow");
  assert.equal(decideAccess(A, example, "write", false), "example_read_only");
  assert.equal(decideAccess(A, example, "write", true), "allow");
});
