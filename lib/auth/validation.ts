// 가입·로그인 입력 검사와 오류 문구. 다른 파일을 import하지 않는 순수 함수만 둔다.
// (Node의 test runner로 바로 시험할 수 있게 하려는 것: scripts/auth-validation.test.mjs)

// 비밀번호 길이: 8자 이상, 72바이트 이하.
// bcrypt는 비밀번호의 앞 72바이트만 사용하므로, 그보다 긴 입력은 뒷부분이 무시된다.
// 사용자가 모르게 뒷부분이 무시되는 일이 없도록 처음부터 받지 않는다.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

// 로그인 실패 문구는 "없는 이메일"과 "틀린 비밀번호"를 구분할 수 없도록 하나만 쓴다.
// 이메일 확인 전 계정도 같은 문구가 나오므로, 문구에 그 가능성을 함께 안내한다.
export const LOGIN_FAILED_MESSAGE =
  "이메일 또는 비밀번호가 올바르지 않습니다. 가입했다면 이메일 확인을 마쳤는지도 확인하세요.";
export const AUTH_UNAVAILABLE_MESSAGE =
  "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.";
export const AUTH_RATE_LIMITED_MESSAGE =
  "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";

// 이메일: 앞뒤 공백을 지우고 소문자로 통일한다. 형식이 아니면 null.
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const email = value.trim().toLowerCase();

  if (email.length === 0 || email.length > EMAIL_MAX_LENGTH) return null;

  return EMAIL_PATTERN.test(email) ? email : null;
}

// 가입용 비밀번호 검사. 문제가 있으면 사용자에게 보여 줄 문구를, 없으면 null.
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return "비밀번호를 입력하세요.";
  }

  if ([...value].length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  }

  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return `비밀번호가 너무 깁니다. (${PASSWORD_MAX_BYTES}바이트 이하, 한글은 한 글자가 3바이트입니다)`;
  }

  return null;
}

type AuthErrorLike = { name?: string; status?: number; code?: string } | null | undefined;

export type AuthFailureKind = "unavailable" | "rate_limited" | "other";

// Supabase Auth 오류를 화면용 종류로 나눈다.
//  - 인증 서버에 닿지 못했거나 5xx면 "unavailable"
//  - 429면 "rate_limited"
//  - 그 외(잘못된 자격증명, 이메일 미확인 등)는 모두 "other" → 같은 문구로 보여 준다.
export function classifyAuthError(error: AuthErrorLike): AuthFailureKind {
  if (!error) return "other";

  if (error.name === "AuthRetryableFetchError") return "unavailable";
  if (typeof error.status === "number" && error.status >= 500) return "unavailable";
  if (error.status === 429) return "rate_limited";
  if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "rate_limited";
  }

  return "other";
}

// 로그인 실패 → 화면 문구. 서버 장애·요청 과다가 아니면 항상 같은 문구다.
export function loginErrorMessage(error: AuthErrorLike): string {
  switch (classifyAuthError(error)) {
    case "unavailable":
      return AUTH_UNAVAILABLE_MESSAGE;
    case "rate_limited":
      return AUTH_RATE_LIMITED_MESSAGE;
    default:
      return LOGIN_FAILED_MESSAGE;
  }
}
