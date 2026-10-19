import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 서버 전용 Supabase 클라이언트.
// - 서버 전용 키(SUPABASE_SECRET_KEY)를 사용하므로 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다.
// - 'server-only' import 덕분에 클라이언트 컴포넌트에서 import하면 빌드 단계에서 오류가 난다.
// - 환경변수 검사는 import 시점이 아니라 첫 호출 시점에 한다.
//   (빌드 환경에 키가 없어도 빌드가 깨지지 않도록 하기 위함)

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) {
    return client;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다."
    );
  }

  client = createClient(url, secretKey, {
    // 서버에서 매 요청마다 쓰는 클라이언트이므로 세션을 저장하거나 갱신하지 않는다.
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}
