import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { dbErrorResponse, isUuid } from "@/lib/api-utils";
import { getPrivateItem } from "@/lib/private/items";

type RouteContext = {
  params: Promise<{ item_id: string }>;
};

// GET: 내 비공개 항목 하나. (과제 8 카드 5)
//
//  * 맨 앞에서 requireUser() 로 로그인을 확인한다. 로그인하지 않았으면 DB에 닿기 전에 401.
//  * 항목은 "로그인한 사용자의 항목 중 이 id" 로만 찾는다. (getPrivateItem 이 id 와 user_id 를 함께 건다)
//    남의 항목·없는 항목·형식이 틀린 id 는 모두 똑같은 404 라서, 다른 계정의 항목이 있는지조차 알아낼 수 없다.
//  * 사용자 id 는 세션에서만 얻는다. ?user_id= 같은 값을 붙여도 읽지 않는다.
export async function GET(request: Request, { params }: RouteContext) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  const { item_id } = await params;
  const headers = { "Cache-Control": "no-store" };
  const notFound = () => NextResponse.json({ error: "항목을 찾을 수 없습니다." }, { status: 404, headers });

  if (!isUuid(item_id)) return notFound();

  const result = await getPrivateItem(auth.user, item_id);

  if (result.error) {
    return dbErrorResponse(result.error, "GET /api/private-items/[item_id]");
  }

  if (!result.data) return notFound();

  return NextResponse.json({ item: result.data }, { headers });
}
