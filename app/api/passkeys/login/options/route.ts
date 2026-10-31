import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { dbErrorResponse, errorResponse } from "@/lib/api-utils";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import { createLoginChallenge } from "@/lib/passkeys/store";
import { REGISTRATION_TIMEOUT_MS, originHeaderAllowed } from "@/lib/passkeys/validation";

// POST: 패스키 로그인을 시작한다. 서버가 새 챌린지를 만들어 DB에 저장하고, 브라우저가 쓸 인증 옵션을 돌려준다.
//
//  * 로그인 전이므로 인증이 필요 없는 경로다. 대신 요청에서 계정을 받지 않는다. (아이디·이메일·사용자 id 입력 없음)
//    allowCredentials 를 비워 두어, 브라우저가 이 사이트의 패스키 중에서 사용자가 고르게 한다. (discoverable credential)
//    누구로 로그인되는지는 뒤의 verify 에서 서버가 저장된 공개 키로 서명을 검증한 결과로만 정해진다.
//  * 챌린지는 요청마다 새로 만들고 DB에 저장한다. 만료 5분. 응답의 challenge_id 로 가리킨다. 서버 메모리에 의존하지 않는다.
//  * userVerification 은 required (지문·PIN 등 사용자 확인을 요구).
export async function POST(request: Request) {
  const configured = getWebAuthnConfig();

  if (!configured.ok) {
    console.error("POST /api/passkeys/login/options: 패스키 설정 오류:", configured.reason);
    return errorResponse("패스키 설정이 되어 있지 않아 지금은 로그인할 수 없습니다.", 503);
  }

  if (!originHeaderAllowed(request.headers.get("origin"), configured.config.origin)) {
    return errorResponse("허용되지 않은 요청 주소입니다.", 403);
  }

  const options = await generateAuthenticationOptions({
    rpID: configured.config.rpID,
    userVerification: "required",
    timeout: REGISTRATION_TIMEOUT_MS,
  });

  const created = await createLoginChallenge(options.challenge);

  if (created.error || !created.data) {
    return dbErrorResponse(created.error ?? {}, "POST /api/passkeys/login/options");
  }

  console.info(`[passkey-login] challenge.issued id=${created.data.challenge_id}`);

  return NextResponse.json(
    { challenge_id: created.data.challenge_id, expires_at: created.data.expires_at, options },
    { headers: { "Cache-Control": "no-store" } }
  );
}
