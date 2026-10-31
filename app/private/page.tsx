import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/app/app-header";
import { getCurrentUser } from "@/lib/auth/require-user";
import { listPrivateItems } from "@/lib/private/items";

export const metadata: Metadata = {
  title: "비공개 영역 | Plan-Do-See Diary",
  // 로그인해야 보이는 화면이므로 검색 결과에 올리지 않는다.
  robots: { index: false, follow: false },
};

// 비공개 영역. (과제 8 카드 1)
//  * 서버에서 로그인을 확인한다. 로그인하지 않았으면 항목을 읽기 전에 /login 으로 보낸다.
//    그래서 비로그인 응답의 HTML에는 비공개 항목이 들어가지 않는다.
//  * proxy.ts 도 같은 이동을 하지만 "빠른 안내"일 뿐이다. 실제 확인은 이 파일의 getCurrentUser() 가 한다.
//  * 계정 식별 정보(이메일)는 이 화면에 보이지 않게 AppHeader 에 null 을 넘긴다.
//  * 화면의 항목은 모두 가상 데이터다.
export default async function PrivatePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const items = listPrivateItems(user);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <AppHeader email={null} />

      <Link href="/plans" className="text-sm text-muted hover:underline">
        계획 목록으로
      </Link>

      {/* 공개 영역과 구분되는 띠: 반전된 색 + 굵은 점선 테두리 */}
      <section
        aria-labelledby="private-title"
        className="mt-4 rounded-md border-2 border-dashed border-foreground"
      >
        <div className="rounded-t-sm bg-foreground px-5 py-4 text-background">
          <p className="text-xs font-semibold tracking-widest">비공개 영역</p>
          <h1 id="private-title" className="mt-1 text-2xl font-bold tracking-tight">
            로그인한 사람에게만 보이는 곳
          </h1>
          <p className="mt-2 text-sm">
            이 화면의 항목은 모두 <strong>가상 데이터</strong>입니다. 실제 메모나 개인정보가 아닙니다.
          </p>
        </div>

        <ul className="space-y-3 p-5">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-line bg-surface p-4">
              <p className="text-xs font-semibold text-muted">{item.kind}</p>
              <h2 className="mt-1 text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm text-muted">{item.body}</p>
            </li>
          ))}
        </ul>

        <p className="border-t border-dashed border-foreground px-5 py-3 text-xs text-muted">
          지금은 이메일·비밀번호로 로그인한 계정이면 누구나 이 화면을 볼 수 있습니다.
          &ldquo;나만 들어가기&rdquo;(패스키)는 아직 구현하지 않았습니다.
        </p>
      </section>
    </main>
  );
}
