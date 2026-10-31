import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { requireUser } from "@/lib/auth/require-user";
import { dbErrorResponse, errorResponse, readJsonObject } from "@/lib/api-utils";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import { createRegistrationChallenge, listCredentialRefs } from "@/lib/passkeys/store";
import {
  MAX_PASSKEYS_PER_USER,
  REGISTRATION_TIMEOUT_MS,
  normalizePasskeyName,
  originHeaderAllowed,
} from "@/lib/passkeys/validation";

// POST: 패스키 등록을 시작한다. 서버가 새 챌린지를 만들어 DB에 저장하고, 브라우저가 쓸 등록 옵션을 돌려준다.
//
//  * 요청 본문: { "name": "<패스키 표시 이름>" }
//  * 등록 대상 사용자는 항상 로그인한 사용자다. 요청에서 사용자 id 나 이메일을 받지 않는다.
//    (임의의 사용자 id 를 넣어서 다른 사람 계정에 패스키를 등록하는 일이 없도록)
//  * 챌린지는 요청마다 새로 만든다. DB에는 사용자·표시 이름·만료 시각(5분)과 함께 저장되고, 응답의 challenge_id 로 가리킨다.
//  * 이미 등록한 패스키는 excludeCredentials 로 알려서, 같은 인증기에 같은 계정의 패스키를 또 만들지 못하게 한다.
//  * 발급 응답에는 개인 키 관련 값이 없다. (개인 키는 브라우저가 패스키 제공자 안에서 만든다)
//  * residentKey·userVerification 을 required 로 요구한다. 다음 카드의 "아이디 입력 없이 패스키로 로그인"에 필요하다.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const configured = getWebAuthnConfig();

  if (!configured.ok) {
    console.error("POST /api/passkeys/register/options: 패스키 설정 오류:", configured.reason);
    return errorResponse("패스키 설정이 되어 있지 않아 지금은 등록할 수 없습니다.", 503);
  }

  const { rpID, origin, rpName } = configured.config;

  if (!originHeaderAllowed(request.headers.get("origin"), origin)) {
    return errorResponse("허용되지 않은 요청 주소입니다.", 403);
  }

  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const named = normalizePasskeyName(parsed.body.name);

  if (!named.ok) {
    return errorResponse(named.error, 400);
  }

  const existing = await listCredentialRefs(auth.user.id);

  if (existing.error || !existing.data) {
    return dbErrorResponse(existing.error ?? {}, "POST /api/passkeys/register/options");
  }

  if (existing.data.length >= MAX_PASSKEYS_PER_USER) {
    return errorResponse(`패스키는 한 계정에 최대 ${MAX_PASSKEYS_PER_USER}개까지 등록할 수 있습니다.`, 409);
  }

  const accountLabel = auth.user.email ?? "내 계정";

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    // 패스키 선택 창에 보이는 계정 이름. 사용자 핸들(userID)은 이메일이 아니라 변하지 않는 계정 id 를 쓴다.
    userName: accountLabel,
    userDisplayName: accountLabel,
    userID: new TextEncoder().encode(auth.user.id),
    attestationType: "none",
    timeout: REGISTRATION_TIMEOUT_MS,
    excludeCredentials: existing.data.map((credential) => ({
      id: credential.credential_id,
      transports: credential.transports,
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });

  const created = await createRegistrationChallenge(auth.user.id, options.challenge, named.name);

  if (created.error || !created.data) {
    return dbErrorResponse(created.error ?? {}, "POST /api/passkeys/register/options");
  }

  return NextResponse.json(
    { challenge_id: created.data.challenge_id, expires_at: created.data.expires_at, options },
    { headers: { "Cache-Control": "no-store" } }
  );
}
