import { NextResponse } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { dbErrorResponse, errorResponse, isUuid, readJsonObject } from "@/lib/api-utils";
import { issueSessionForUser } from "@/lib/auth/passkey-session";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import { consumeLoginChallenge, findCredentialById, recordPasskeyAuthentication } from "@/lib/passkeys/store";
import { isAuthenticationResponseShape, originHeaderAllowed, userHandleMatches } from "@/lib/passkeys/validation";

// POST: 브라우저가 만든 패스키 로그인 결과를 서버가 검증하고, 통과했을 때만 로그인 세션을 발급한다.
//
//  * 요청 본문: { "challenge_id": "<로그인 시작 때 받은 값>", "response": <navigator.credentials.get 의 결과(JSON 형태)> }
//    사용자 id·이메일·"인증 성공 여부" 같은 값은 받지 않는다. 브라우저가 보낸 어떤 값도 "누구인지"를 정하지 못한다.
//  * 순서
//      1) 설정·Origin 확인 → 요청 모양 확인
//      2) 챌린지를 먼저 "소비"한다. 안 쓰였고 안 만료됐을 때만 값을 받는다. 이 시점부터 같은 챌린지는 다시 쓸 수 없다.
//         그래서 이어지는 검증이 실패해도 같은 요청을 다시 보내 성공시킬 수 없다. (다시 시도하려면 로그인을 처음부터 시작한다)
//      3) 응답의 credential ID 로 저장된 패스키를 찾는다. 없으면 거절. 사용자는 여기서 저장된 패스키의 소유자로 정해진다.
//      4) verifyAuthenticationResponse: 챌린지·origin·RP ID·사용자 확인(UV)·저장된 공개 키로 서명 검증
//      5) 카운터 기록(올라가지 않았으면 거절) → 6) 세션 발급(issueSessionForUser)
//  * 3)~5) 어느 단계에서 실패해도 응답은 같은 문구의 401 이다. (어떤 패스키가 등록되어 있는지 알아내는 데 쓰이지 않게)
//    실패 이유는 서버 로그에만 남긴다. 로그에는 챌린지·서명·토큰 원문을 쓰지 않는다.
const CHALLENGE_GONE_MESSAGE = "로그인 요청이 만료되었거나 이미 사용되었습니다. 처음부터 다시 시도하세요.";
const LOGIN_FAILED_MESSAGE = "패스키로 로그인하지 못했습니다. 등록된 패스키인지 확인하고 처음부터 다시 시도하세요.";

function fail(challengeId: string, reason: string) {
  console.warn(`[passkey-login] verify.failed id=${challengeId} reason=${reason}`);

  return errorResponse(LOGIN_FAILED_MESSAGE, 401);
}

export async function POST(request: Request) {
  const configured = getWebAuthnConfig();

  if (!configured.ok) {
    console.error("POST /api/passkeys/login/verify: 패스키 설정 오류:", configured.reason);
    return errorResponse("패스키 설정이 되어 있지 않아 지금은 로그인할 수 없습니다.", 503);
  }

  const { rpID, origin } = configured.config;

  if (!originHeaderAllowed(request.headers.get("origin"), origin)) {
    return errorResponse("허용되지 않은 요청 주소입니다.", 403);
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const challengeId = parsed.body.challenge_id;

  if (typeof challengeId !== "string" || !isUuid(challengeId) || !isAuthenticationResponseShape(parsed.body.response)) {
    return errorResponse("요청 형식이 올바르지 않습니다.", 400);
  }

  const response = parsed.body.response as AuthenticationResponseJSON;

  // 2) 챌린지 소비
  const consumed = await consumeLoginChallenge(challengeId);

  if (consumed.error) {
    return dbErrorResponse(consumed.error, "POST /api/passkeys/login/verify");
  }

  if (!consumed.data) {
    console.warn(`[passkey-login] challenge.rejected id=${challengeId} reason=unavailable`);
    return errorResponse(CHALLENGE_GONE_MESSAGE, 400);
  }

  console.info(`[passkey-login] challenge.consumed id=${challengeId}`);

  // 3) 저장된 패스키 찾기
  const stored = await findCredentialById(response.id);

  if (stored.error) {
    return dbErrorResponse(stored.error, "POST /api/passkeys/login/verify");
  }

  if (!stored.data) {
    return fail(challengeId, "unknown_credential");
  }

  // 인증기가 알려 준 userHandle 이 있으면, 저장된 소유자와 어긋나지 않는지 확인한다.
  if (!userHandleMatches(response.response.userHandle, stored.data.user_id)) {
    return fail(challengeId, "user_handle_mismatch");
  }

  // 4) 서명 검증
  let verification;

  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: consumed.data.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.data.credential_id,
        publicKey: isoBase64URL.toBuffer(stored.data.public_key),
        counter: Number(stored.data.counter),
        transports: stored.data.transports as never,
      },
    });
  } catch (error) {
    console.warn(
      `[passkey-login] verify.failed id=${challengeId} reason=library_error detail=${
        error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : "unknown"
      }`
    );

    return errorResponse(LOGIN_FAILED_MESSAGE, 401);
  }

  if (!verification.verified) {
    return fail(challengeId, "not_verified");
  }

  // 5) 카운터 기록 (올라가지 않았으면 거절)
  const recorded = await recordPasskeyAuthentication(
    stored.data.credential_id,
    verification.authenticationInfo.newCounter
  );

  if (recorded.error) {
    return dbErrorResponse(recorded.error, "POST /api/passkeys/login/verify");
  }

  if (!recorded.data || recorded.data.user_id !== stored.data.user_id) {
    return fail(challengeId, "counter_rejected");
  }

  console.info(`[passkey-login] verify.succeeded id=${challengeId}`);

  // 6) 세션 발급. 사용자는 저장된 패스키의 소유자다.
  const issued = await issueSessionForUser(stored.data.user_id);

  if (!issued.ok) {
    console.error(`[passkey-login] session.failed id=${challengeId} reason=${issued.reason}`);
    return errorResponse("로그인 세션을 만들지 못했습니다. 잠시 후 다시 시도하세요.", 503);
  }

  console.info(`[passkey-login] session.issued id=${challengeId}`);

  // 응답 본문에는 세션 값을 넣지 않는다. 세션은 httpOnly 쿠키로만 전달된다.
  return NextResponse.json({ ok: true, redirect_to: "/plans" }, { headers: { "Cache-Control": "no-store" } });
}
