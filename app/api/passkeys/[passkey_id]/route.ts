import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { dbErrorResponse, errorResponse, isUuid } from "@/lib/api-utils";
import { getWebAuthnConfig } from "@/lib/passkeys/config";
import { deletePasskey } from "@/lib/passkeys/store";
import { originHeaderAllowed } from "@/lib/passkeys/validation";

type RouteContext = {
  params: Promise<{ passkey_id: string }>;
};

// DELETE: 내 패스키 하나를 서버에서 지운다. (삭제 뒤 그 패스키는 로그인에 쓸 수 없다)
//
//  * 맨 앞에서 requireUser() 로 로그인을 확인한다. 로그인하지 않았으면 DB에 닿기 전에 401.
//  * 지울 대상은 "로그인한 사용자의 패스키 중 이 id" 로만 정해진다. (DB 함수 delete_passkey 가 소유자 조건을 건다)
//    요청에서 사용자 id 를 받지 않는다. 남의 패스키와 없는 패스키는 똑같이 404 라서 존재 여부를 알아낼 수 없다.
//  * passkey_id 는 목록에서 보이는 행 id 이다. credential ID(로그인에 쓰는 값)가 아니다.
//  * 마지막 패스키는 ?confirm_last=1 을 붙였을 때만 지운다. 아니면 409(code: last_passkey).
//    이 계정은 비밀번호로도 로그인할 수 있어서 0개가 되어도 계정에 들어올 수 있지만, 실수로 지우지 않도록 서버가 한 번 더 확인한다.
//  * 지우는 것은 서버에 등록된 credential 이다. 사용자의 기기나 패스키 관리자에 저장된 패스키 자체는 지워지지 않는다.
//  * 이미 발급된 로그인 세션은 이 요청으로 끊기지 않는다. (세션은 패스키가 아니라 Supabase Auth 가 관리한다)
export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const configured = getWebAuthnConfig();

  if (configured.ok && !originHeaderAllowed(request.headers.get("origin"), configured.config.origin)) {
    return errorResponse("허용되지 않은 요청 주소입니다.", 403);
  }

  const { passkey_id } = await params;

  if (!isUuid(passkey_id)) {
    return errorResponse("passkey_id가 올바른 형식이 아닙니다.", 400);
  }

  const allowLast = new URL(request.url).searchParams.get("confirm_last") === "1";
  const result = await deletePasskey(auth.user.id, passkey_id, allowLast);

  if (result.error || !result.data) {
    return dbErrorResponse(result.error ?? {}, "DELETE /api/passkeys/[passkey_id]");
  }

  const headers = { "Cache-Control": "no-store" };

  if (result.data.outcome === "not_found") {
    return NextResponse.json({ error: "패스키를 찾을 수 없습니다." }, { status: 404, headers });
  }

  if (result.data.outcome === "last_passkey") {
    return NextResponse.json(
      { error: "마지막 패스키입니다. 지우면 패스키로 로그인할 수 없게 됩니다.", code: "last_passkey" },
      { status: 409, headers }
    );
  }

  console.info(`[passkey] deleted remaining=${result.data.remaining}`);

  return NextResponse.json({ deleted: true, remaining: result.data.remaining }, { headers });
}
