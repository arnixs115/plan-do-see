import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { listPrivateItems } from "@/lib/private/items";

// GET: 비공개 항목(가상 데이터) 목록.
//
//  * 맨 앞에서 requireUser() 로 로그인을 서버가 확인한다. 로그인하지 않았거나 세션이 없으면
//    비공개 항목을 읽기 전에 401, 인증 서버에 닿지 못하면 503 을 돌려준다. (다른 API와 같은 규칙)
//  * 응답에는 로그인한 사용자의 이메일·id 를 넣지 않는다.
//  * 응답은 저장·공유 캐시에 남지 않도록 no-store 로 보낸다.
//  * GET 만 내보낸다. 다른 메서드는 Next.js 가 405 로 거절한다. (이 경로로 항목을 만들거나 고치는 기능은 없다)
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    { items: listPrivateItems(auth.user) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
