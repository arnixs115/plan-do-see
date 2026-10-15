// 실행(Execution) API가 함께 쓰는 헬퍼.
// 상태 전이는 DB 함수(start/pause/resume/end_execution)가 처리하고,
// 여기서는 그 함수가 던지는 오류 코드(SQLSTATE)를 HTTP 응답으로 바꾼다.
//
//   P0002  대상 없음                     → 404
//   55000  현재 상태에서 불가능한 요청    → 409
//   23505  Idempotency-Key 충돌          → 409
//   22023  Idempotency-Key가 비어 있음   → 400
//   그 외                                 → dbErrorResponse (제약 위반 400 / 나머지 500)

import { NextResponse } from "next/server";
import { dbErrorResponse, errorResponse } from "@/lib/api-utils";

type DbError = { code?: string; message?: string };

export function executionErrorResponse(
  error: DbError,
  label: string,
  notFoundMessage: string
) {
  switch (error.code) {
    case "P0002":
      return errorResponse(notFoundMessage, 404);

    case "55000":
      if (error.message?.includes("already_active")) {
        return errorResponse("이 할 일에 이미 진행 중인 실행이 있습니다.", 409);
      }

      if (error.message?.includes("already_ended")) {
        return errorResponse("이미 종료된 실행입니다.", 409);
      }

      return errorResponse("현재 상태에서는 할 수 없는 요청입니다.", 409);

    case "23505":
      return errorResponse(
        "같은 Idempotency-Key가 이미 다른 요청에 사용되었습니다.",
        409
      );

    case "22023":
      return errorResponse("Idempotency-Key가 올바르지 않습니다.", 400);

    default:
      return dbErrorResponse(error, label);
  }
}

// 헤더의 Idempotency-Key 검사: 1~128자의 공백 없는 ASCII 문자(예: uuid)
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,128}$/;

export function readIdempotencyKey(
  request: Request
): { ok: true; key: string } | { ok: false; response: NextResponse } {
  const key = request.headers.get("idempotency-key")?.trim();

  if (!key) {
    return {
      ok: false,
      response: errorResponse(
        "Idempotency-Key 헤더가 필요합니다. 같은 요청을 다시 보낼 때는 같은 값을 쓰세요.",
        400
      ),
    };
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      response: errorResponse(
        "Idempotency-Key는 공백 없는 1~128자의 ASCII 문자여야 합니다. (예: uuid)",
        400
      ),
    };
  }

  return { ok: true, key };
}

// DB 함수가 돌려준 실행 상태(JSON)의 모양
export type ExecutionResult = {
  status: "running" | "paused" | "ended";
  changed: boolean;
  created: boolean;
  work_seconds: number;
  execution: Record<string, unknown>;
  segments: Record<string, unknown>[];
};

export function emptyResultResponse(label: string) {
  console.error(`${label}: 함수가 빈 결과를 반환했습니다.`);
  return errorResponse("서버 오류가 발생했습니다.", 500);
}
