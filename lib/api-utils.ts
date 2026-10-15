import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// 응답 헬퍼
// ---------------------------------------------------------------------------

export function errorResponse(message: string | string[], status: number) {
  return NextResponse.json({ error: message }, { status });
}

// ---------------------------------------------------------------------------
// uuid 검사
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// 요청 본문(JSON) 읽기
//
// request.json()은 UTF-8이 아닌 바이트를 만나면 오류를 내지 않고 깨진 글자(U+FFFD)로
// 바꿔서 읽는다. 그러면 깨진 문자열이 그대로 DB에 저장된다.
// (예: Windows 터미널의 curl이 한글을 CP949로 보낸 경우)
// 그래서 본문을 바이트로 읽고, 올바른 UTF-8이 아니면 오류를 내는 디코더로 직접 해석한다.
// ---------------------------------------------------------------------------

type ReadBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

// allowEmpty: true 이면 본문이 아예 비어 있는 요청을 빈 객체({})로 취급한다.
// (본문이 선택 사항인 API용. 내용이 있는데 JSON이 아니면 여전히 400이다.)
export async function readJsonObject(
  request: Request,
  options: { allowEmpty?: boolean } = {}
): Promise<ReadBodyResult> {
  let bytes: ArrayBuffer;

  try {
    bytes = await request.arrayBuffer();
  } catch {
    return {
      ok: false,
      response: errorResponse("요청 본문을 읽을 수 없습니다.", 400),
    };
  }

  let text: string;

  try {
    // fatal: true → 올바르지 않은 UTF-8 바이트가 있으면 TypeError를 던진다.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return {
      ok: false,
      response: errorResponse(
        "요청 본문이 올바른 UTF-8이 아닙니다. 한글 등이 깨지지 않도록 UTF-8로 인코딩해서 보내주세요.",
        400
      ),
    };
  }

  if (options.allowEmpty && text.trim().length === 0) {
    return { ok: true, body: {} };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: errorResponse("요청 본문이 올바른 JSON이 아닙니다.", 400),
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      response: errorResponse("요청 본문은 JSON 객체여야 합니다.", 400),
    };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// DB 오류 → HTTP 응답
//
// 요청 값 문제로 DB가 거절한 경우의 SQLSTATE 코드는 400으로 응답한다.
//   23514: CHECK 위반 / 23502: NOT NULL 위반
//   22007, 22008: 날짜 형식·범위 오류 / 22003: 숫자 범위 초과 / 22P02: 잘못된 입력 형식
// 그 외는 서버 오류로 보고, DB 내부 메시지는 응답에 노출하지 않고 서버 로그에만 남긴다.
// ---------------------------------------------------------------------------

const CLIENT_ERROR_CODES = new Set([
  "23514",
  "23502",
  "22007",
  "22008",
  "22003",
  "22P02",
]);

export function dbErrorResponse(error: { code?: string }, label: string) {
  if (error.code && CLIENT_ERROR_CODES.has(error.code)) {
    return errorResponse("요청 값이 데이터 제약조건에 맞지 않습니다.", 400);
  }

  console.error(`${label} failed:`, error);
  return errorResponse("서버 오류가 발생했습니다.", 500);
}
