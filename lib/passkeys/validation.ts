// 패스키 등록 입력 검사. 다른 파일을 import하지 않는 순수 함수만 둔다.
// (Node의 test runner로 바로 시험할 수 있게 하려는 것: scripts/passkey-validation.test.mjs)

export const PASSKEY_NAME_MAX = 40;
// 한 계정에 등록할 수 있는 패스키 수. 챌린지·excludeCredentials 목록이 끝없이 커지는 것을 막는다.
export const MAX_PASSKEYS_PER_USER = 10;

// 브라우저에 알려 주는 등록 제한 시간(ms). DB의 챌린지 만료(5분)보다 짧게 둔다.
export const REGISTRATION_TIMEOUT_MS = 120_000;

// WebAuthn 에서 알려진 연결 방식. 클라이언트가 보낸 값은 이 목록에 있는 것만 저장한다.
const KNOWN_TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"];

type NameResult = { ok: true; name: string } | { ok: false; error: string };

// 패스키 이름은 사용자가 패스키를 구분하려는 "표시용" 글자다. 인증 증거가 아니다.
// 앞뒤 공백을 지우고 연속 공백·줄바꿈을 한 칸으로 줄인다. 제어 문자와 글자 방향을 뒤집는 문자는 받지 않는다.
export function normalizePasskeyName(value: unknown): NameResult {
  if (typeof value !== "string") return { ok: false, error: "패스키 이름을 입력하세요." };

  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();

  if (name.length === 0) return { ok: false, error: "패스키 이름을 입력하세요." };

  if ([...name].length > PASSKEY_NAME_MAX) {
    return { ok: false, error: `패스키 이름은 ${PASSKEY_NAME_MAX}자 이하로 입력하세요.` };
  }

  if (/[\p{Cc}\p{Cs}\p{Co}‪-‮⁦-⁩]/u.test(name)) {
    return { ok: false, error: "패스키 이름에 쓸 수 없는 문자가 들어 있습니다." };
  }

  return { ok: true, name };
}

export function allowedTransports(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((item): item is string => typeof item === "string" && KNOWN_TRANSPORTS.includes(item)))];
}

// 브라우저가 보낸 Origin 헤더가 우리 서비스 주소와 같은지 본다. (쿠키로 인증되는 POST 요청의 추가 방어)
//  - 헤더가 없으면 허용한다. 브라우저는 교차 출처 POST 에 항상 Origin 을 붙이므로, 없는 것은 스크립트·도구의 요청(Bearer 토큰)이다.
//  - 헤더가 있는데 다르면(null 포함) 거절한다.
export function originHeaderAllowed(header: string | null | undefined, expectedOrigin: string): boolean {
  if (header === null || header === undefined) return true;

  return header === expectedOrigin;
}

// 같은 credential_id 를 두 번 저장하려 할 때 DB(PostgreSQL)가 내는 오류 코드
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

function isNonEmptyString(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

// 브라우저가 보낸 등록 결과(RegistrationResponseJSON)의 최소한의 모양 검사.
// 암호학적 검증은 하지 않는다. 그것은 @simplewebauthn/server 의 verifyRegistrationResponse 가 한다.
export function isRegistrationResponseShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const v = value as Record<string, unknown>;
  const inner = v.response as Record<string, unknown> | null | undefined;

  return (
    isNonEmptyString(v.id, 1024) &&
    isNonEmptyString(v.rawId, 1024) &&
    v.type === "public-key" &&
    typeof inner === "object" &&
    inner !== null &&
    !Array.isArray(inner) &&
    isNonEmptyString(inner.clientDataJSON, 8192) &&
    isNonEmptyString(inner.attestationObject, 65536)
  );
}

// 브라우저가 보낸 로그인 결과(AuthenticationResponseJSON)의 최소한의 모양 검사.
// 암호학적 검증은 하지 않는다. 그것은 @simplewebauthn/server 의 verifyAuthenticationResponse 가 한다.
export function isAuthenticationResponseShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const v = value as Record<string, unknown>;
  const inner = v.response as Record<string, unknown> | null | undefined;

  return (
    isNonEmptyString(v.id, 1024) &&
    isNonEmptyString(v.rawId, 1024) &&
    v.type === "public-key" &&
    typeof inner === "object" &&
    inner !== null &&
    !Array.isArray(inner) &&
    isNonEmptyString(inner.clientDataJSON, 8192) &&
    isNonEmptyString(inner.authenticatorData, 4096) &&
    isNonEmptyString(inner.signature, 4096) &&
    (inner.userHandle === undefined || inner.userHandle === null || isNonEmptyString(inner.userHandle, 1024))
  );
}

// 인증기가 알려 준 userHandle(base64url)이 이 패스키 소유자의 계정 id 와 같은지 본다.
// 등록할 때 userHandle 을 계정 id(UUID 문자열)의 UTF-8 바이트로 만들었다. 값이 없으면(인증기가 안 보낸 경우) 비교할 수 없으므로 통과시킨다.
// 값이 있는데 다르면 거절한다. (브라우저가 보낸 값을 사용자 확인에 쓰는 것이 아니라, 서버가 저장해 둔 소유자와 어긋나지 않는지 확인하는 용도)
export function userHandleMatches(userHandleBase64url: string | null | undefined, expectedUserId: string): boolean {
  if (userHandleBase64url === null || userHandleBase64url === undefined || userHandleBase64url === "") return true;

  try {
    return Buffer.from(userHandleBase64url, "base64url").toString("utf8") === expectedUserId;
  } catch {
    return false;
  }
}
