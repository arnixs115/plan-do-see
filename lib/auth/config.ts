// 인증용 Supabase 설정 읽기.
//  - NEXT_PUBLIC_SUPABASE_URL           : 프로젝트 URL (공개되어도 되는 값)
//  - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 브라우저용 공개 키. 공개되도록 만들어진 키이며, 이 프로젝트의
//                                          테이블에는 권한이 없어서 이 키만으로는 자료를 읽을 수 없다.
// proxy.ts 에서도 읽어야 해서 server-only 를 붙이지 않았다. (proxy 번들에서는 server-only 가 오류를 낸다)
// 비밀 키(SUPABASE_SECRET_KEY)는 여기서 쓰지 않는다. 그 키는 lib/supabase-server.ts 에서만 쓴다.

export function getAuthConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 환경변수가 설정되지 않았습니다."
    );
  }

  return { url, publishableKey };
}
