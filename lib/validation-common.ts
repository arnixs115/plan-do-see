// plans와 todos가 함께 쓰는 입력 검증 헬퍼.
// 각 check 함수는 { ok: true, value } 또는 { ok: false, error }를 돌려준다.
// 값의 범위는 DB의 CHECK 제약조건과 맞춘다.

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

// 검증을 통과한 값(values)과 오류 메시지(errors)를 모으는 상자.
// apply(field, 검사결과): 통과하면 values에 담고, 실패하면 errors에 메시지를 추가한다.
export function createCollector() {
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  function apply(field: string, result: Check<unknown>) {
    if (result.ok) {
      values[field] = result.value;
    } else {
      errors.push(result.error);
    }
  }

  return { values, errors, apply };
}

export const PRIORITIES = ["low", "medium", "high"];

// PostgreSQL integer(int4)의 최댓값
export const MAX_INT4 = 2147483647;

export function hasField(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

// 문자열인지, 깨진 문자(U+FFFD)가 없는지 확인한다.
// 본문이 올바른 UTF-8이어도 글자 자체가 이미 깨져서 들어올 수 있다.
export function checkText(field: string, value: unknown): Check<string> {
  if (typeof value !== "string") {
    return { ok: false, error: `${field}는 문자열이어야 합니다.` };
  }

  if (value.includes("�")) {
    return {
      ok: false,
      error: `${field}에 깨진 문자(�)가 포함되어 있습니다. UTF-8로 보내주세요.`,
    };
  }

  return { ok: true, value };
}

// title은 공백만으로 이루어질 수 없다. (DB CHECK: char_length(trim(title)) > 0)
export function checkTitle(value: unknown): Check<string> {
  const text = checkText("title", value);

  if (text.ok && text.value.trim().length === 0) {
    return { ok: false, error: "title은 비어 있을 수 없습니다." };
  }

  return text;
}

// "YYYY-MM-DD" 형식이면서 실제로 존재하는 날짜인지 확인한다. (예: 2026-02-30은 거부)
function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// 날짜 문자열 또는 null(값 비우기)
export function checkDate(field: string, value: unknown): Check<string | null> {
  if (value === null || isValidDateString(value)) {
    return { ok: true, value };
  }

  return {
    ok: false,
    error: `${field}는 YYYY-MM-DD 형식의 날짜이거나 null이어야 합니다.`,
  };
}

export function checkPriority(value: unknown): Check<string> {
  if (typeof value === "string" && PRIORITIES.includes(value)) {
    return { ok: true, value };
  }

  return { ok: false, error: "priority는 low, medium, high 중 하나여야 합니다." };
}

export function checkMinutes(value: unknown): Check<number> {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_INT4
  ) {
    return { ok: true, value };
  }

  return { ok: false, error: "estimated_minutes는 0 이상의 정수여야 합니다." };
}
