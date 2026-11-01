import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { AuthUser } from "@/lib/auth/require-user";

// 비공개 항목(가상 데이터)을 읽는 곳. (과제 8 카드 1 → 카드 5에서 계정별 저장으로 바꿈)
//
//  * 항목은 private_items 표에 있고, 각 행은 소유자(user_id)를 가진다. 내용은 전부 가상이다.
//  * 서버 전용 키(service_role)로 읽으므로 RLS 가 적용되지 않는다. 그래서 이 파일의 모든 조회가
//    `.eq("user_id", user.id)` 를 직접 건다. 소유자 조건 없이 읽는 함수는 이 파일에 없다.
//  * user 는 requireUser() / getCurrentUser() 가 세션에서 확인한 값(AuthUser)만 받는다.
//    요청의 쿼리·본문·헤더에서 받은 사용자 id 는 이 파일에 도달하지 않는다.
//  * `server-only` 라서 클라이언트 컴포넌트가 import하면 빌드가 실패한다.
//  * 읽기 전용이다. 이 경로로 항목을 만들거나 고치거나 지우는 기능은 없다. (처음 한 번 계정 몫의 가상 항목을 채우는 것만 한다)

export type PrivateItemKind = "개인 메모" | "학습 목표" | "비공개 프로젝트 계획";

export type PrivateItem = {
  id: string; // 행 id(uuid). 상세 조회 주소에 쓴다
  code: string; // 화면 표시용 코드 (PDEMO-<계정 태그>-<칸>)
  kind: PrivateItemKind;
  title: string;
  body: string;
};

type DbError = { code?: string; message?: string } | null;

const COLUMNS = "id, code, kind, title, body";

// 내 항목 전부. 항목이 아직 없는 계정이면 가상 항목 3개를 먼저 채운다. (여러 번·동시에 불러도 같은 결과)
export async function listPrivateItems(user: AuthUser): Promise<{ data: PrivateItem[] | null; error: DbError }> {
  const db = getSupabaseAdmin();

  const ensured = await db.rpc("ensure_private_items", { p_user_id: user.id });
  if (ensured.error) return { data: null, error: ensured.error };

  const { data, error } = await db
    .from("private_items")
    .select(COLUMNS)
    .eq("user_id", user.id)
    .order("slot", { ascending: true });

  return { data: (data as PrivateItem[] | null) ?? null, error };
}

// 내 항목 하나. 남의 항목과 없는 항목은 똑같이 null (호출하는 쪽이 404 로 답한다).
export async function getPrivateItem(
  user: AuthUser,
  itemId: string
): Promise<{ data: PrivateItem | null; error: DbError }> {
  const { data, error } = await getSupabaseAdmin()
    .from("private_items")
    .select(COLUMNS)
    .eq("id", itemId)
    .eq("user_id", user.id)
    .maybeSingle();

  return { data: (data as PrivateItem | null) ?? null, error };
}
