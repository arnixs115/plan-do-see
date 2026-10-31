// 패스키(WebAuthn) 서버 설정: RP ID(서비스 도메인), origin(주소), 화면에 보일 서비스 이름.
// 다른 파일을 import하지 않는 순수 함수만 둔다. (Node의 test runner로 바로 시험할 수 있게 하려는 것: scripts/passkey-validation.test.mjs)
//
//  * 값은 환경변수로 받는다. 요청의 Host 헤더에서 만들지 않는다. (요청이 보내 주는 값으로 "내 주소"를 정하면 검증의 의미가 없다)
//      WEBAUTHN_ORIGIN   : 브라우저 주소창의 origin. 예) https://plan-do-see-silk.vercel.app , 로컬은 http://localhost:3000
//      WEBAUTHN_RP_ID    : 도메인만. 스킴·포트·경로 없음. 예) plan-do-see-silk.vercel.app , 로컬은 localhost
//      WEBAUTHN_RP_NAME  : (선택) 패스키 창에 보일 이름
//  * RP ID는 패스키가 묶이는 도메인이다. 나중에 바꾸면 이미 등록한 패스키로 로그인할 수 없게 되므로 처음에 정확히 정한다.
//  * 개발 환경(NODE_ENV 가 production 이 아님)에서만 localhost:3000 기본값을 쓴다.
//    배포(production)에서 값이 없으면 기본값으로 조용히 동작하지 않고, 설정 오류로 처리한다.

export type WebAuthnConfig = { rpID: string; origin: string; rpName: string };

export type WebAuthnConfigResult =
  | { ok: true; config: WebAuthnConfig }
  | { ok: false; reason: string };

const DEV_ORIGIN = "http://localhost:3000";
const DEV_RP_ID = "localhost";
const DEFAULT_RP_NAME = "Plan-Do-See Diary";

const DOMAIN_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export function parseWebAuthnConfig(
  env: Record<string, string | undefined>,
  production: boolean
): WebAuthnConfigResult {
  const rawOrigin = env.WEBAUTHN_ORIGIN?.trim() || (production ? "" : DEV_ORIGIN);
  const rawRpId = env.WEBAUTHN_RP_ID?.trim().toLowerCase() || (production ? "" : DEV_RP_ID);
  const rpName = env.WEBAUTHN_RP_NAME?.trim() || DEFAULT_RP_NAME;

  if (!rawOrigin || !rawRpId) {
    return { ok: false, reason: "WEBAUTHN_ORIGIN 과 WEBAUTHN_RP_ID 환경변수가 설정되지 않았습니다." };
  }

  let url: URL;

  try {
    url = new URL(rawOrigin);
  } catch {
    return { ok: false, reason: "WEBAUTHN_ORIGIN 이 올바른 주소가 아닙니다." };
  }

  // 끝의 "/" 나 경로가 붙은 값은 브라우저가 보내는 origin 과 문자열이 달라서 항상 검증에 실패한다.
  if (url.origin !== rawOrigin) {
    return { ok: false, reason: "WEBAUTHN_ORIGIN 은 경로 없이 스킴+호스트(+포트)만 적어야 합니다. 예) https://example.com" };
  }

  const isLocalhost = url.hostname === "localhost";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    return { ok: false, reason: "WEBAUTHN_ORIGIN 은 https 여야 합니다. (http 는 localhost 만 허용)" };
  }

  if (IPV4_PATTERN.test(rawRpId) || !DOMAIN_PATTERN.test(rawRpId)) {
    return { ok: false, reason: "WEBAUTHN_RP_ID 는 스킴·포트·경로 없는 도메인이어야 합니다. 예) example.com" };
  }

  if (!(url.hostname === rawRpId || url.hostname.endsWith(`.${rawRpId}`))) {
    return { ok: false, reason: "WEBAUTHN_RP_ID 가 WEBAUTHN_ORIGIN 의 호스트와 같거나 그 상위 도메인이어야 합니다." };
  }

  return { ok: true, config: { rpID: rawRpId, origin: rawOrigin, rpName } };
}

export function getWebAuthnConfig(): WebAuthnConfigResult {
  return parseWebAuthnConfig(process.env, process.env.NODE_ENV === "production");
}
