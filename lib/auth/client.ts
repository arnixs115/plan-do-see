import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthConfig } from "./config";
import { hardenCookieOptions } from "./cookie-options";

// 로그인 세션을 다루는 서버용 Supabase 클라이언트. (쿠키에 세션을 저장·갱신한다)
//  - 요청마다 새로 만든다. (라이브러리 안내: 요청 사이에 공유하지 않는다)
//  - 자료(plans, todos ...)를 읽고 쓰는 클라이언트(lib/supabase-server.ts)와는 다른 것이다.
//  - Server Component 안에서는 쿠키를 쓸 수 없어 setAll이 오류를 낼 수 있는데, 그 경우 무시한다.
//    세션 갱신은 proxy.ts 가 맡는다.
export async function createAuthClient(): Promise<SupabaseClient> {
  const { url, publishableKey } = getAuthConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, hardenCookieOptions(options))
          );
        } catch {
          // Server Component에서 호출된 경우: 쿠키를 쓸 수 없다. proxy.ts 가 갱신한다.
        }
      },
    },
  });
}
