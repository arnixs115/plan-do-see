import { NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { requireUser } from "@/lib/auth/require-user";
import { dbErrorResponse, errorResponse, isUuid, readJsonObject } from "@/lib/api-utils";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import { consumeRegistrationChallenge, insertPasskey } from "@/lib/passkeys/store";
import {
  allowedTransports,
  isRegistrationResponseShape,
  isUniqueViolation,
  originHeaderAllowed,
} from "@/lib/passkeys/validation";

// POST: 브라우저가 만든 패스키 등록 결과를 서버가 검증하고, 통과했을 때만 공개 키를 저장한다.
//
//  * 요청 본문: { "challenge_id": "<등록 시작 때 받은 값>", "response": <navigator.credentials.create 의 결과(JSON 형태)> }
//    이 결과에는 공개 키와 인증기의 서명만 있고 개인 키는 없다. (WebAuthn은 개인 키를 브라우저 밖으로 내보내지 않는다)
//  * 순서
//      1) 로그인 확인(requireUser) → 설정·Origin 확인 → 요청 모양 확인
//      2) 챌린지를 먼저 "소비"한다. 내 것이고, 안 쓰였고, 안 만료됐을 때만 값을 받는다. 이 시점부터 같은 챌린지는 다시 쓸 수 없다.
//         그래서 이어지는 검증이 실패해도 같은 요청을 다시 보내 성공시킬 수 없다. (다시 시도하려면 등록을 처음부터 시작한다)
//      3) verifyRegistrationResponse 로 챌린지·origin·RP ID·서명 형식·사용자 확인(UV)을 검증한다.
//      4) 통과한 경우에만 DB에 저장한다. 검증에 실패하면 저장하지 않는다.
//  * 패스키 소유자는 로그인한 사용자다. 표시 이름은 등록 시작 때 서버가 검사해서 챌린지에 묶어 둔 값을 쓴다. (이 요청의 이름은 받지 않는다)
//  * 같은 credential_id 는 DB의 고유 제약이 막는다. 409.
const CHALLENGE_GONE_MESSAGE = "등록 요청이 만료되었거나 이미 사용되었습니다. 처음부터 다시 시도하세요.";
const VERIFY_FAILED_MESSAGE = "패스키 등록 결과를 확인하지 못했습니다. 처음부터 다시 시도하세요.";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const configured = getWebAuthnConfig();

  if (!configured.ok) {
    console.error("POST /api/passkeys/register/verify: 패스키 설정 오류:", configured.reason);
    return errorResponse("패스키 설정이 되어 있지 않아 지금은 등록할 수 없습니다.", 503);
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

  if (typeof challengeId !== "string" || !isUuid(challengeId) || !isRegistrationResponseShape(parsed.body.response)) {
    return errorResponse("요청 형식이 올바르지 않습니다.", 400);
  }

  // 2) 챌린지 소비 (내 것·미사용·미만료만)
  const consumed = await consumeRegistrationChallenge(challengeId, auth.user.id);

  if (consumed.error) {
    return dbErrorResponse(consumed.error, "POST /api/passkeys/register/verify");
  }

  if (!consumed.data) {
    return errorResponse(CHALLENGE_GONE_MESSAGE, 400);
  }

  // 3) WebAuthn 등록 결과 검증
  let verification;

  try {
    verification = await verifyRegistrationResponse({
      response: parsed.body.response as RegistrationResponseJSON,
      expectedChallenge: consumed.data.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserPresence: true,
      requireUserVerification: true,
    });
  } catch (error) {
    // 서버 로그에는 원인을 남기되(챌린지는 이미 소비되어 다시 쓸 수 없는 값이다), 응답에는 이유를 자세히 알리지 않는다.
    console.error(
      "POST /api/passkeys/register/verify: 등록 결과 검증 실패:",
      error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "알 수 없는 오류"
    );

    return errorResponse(VERIFY_FAILED_MESSAGE, 400);
  }

  if (!verification.verified) {
    return errorResponse(VERIFY_FAILED_MESSAGE, 400);
  }

  // 4) 검증을 통과한 결과만 저장
  const { credential, credentialDeviceType, credentialBackedUp, aaguid } = verification.registrationInfo;

  const inserted = await insertPasskey({
    userId: auth.user.id,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: allowedTransports(credential.transports),
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    aaguid: aaguid || null,
    name: consumed.data.name,
  });

  if (isUniqueViolation(inserted.error)) {
    return errorResponse("이미 등록된 패스키입니다.", 409);
  }

  if (inserted.error || !inserted.data) {
    return dbErrorResponse(inserted.error ?? {}, "POST /api/passkeys/register/verify");
  }

  return NextResponse.json({ passkey: inserted.data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
