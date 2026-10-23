import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/require-user";
import AppHeader from "./app-header";
import PlansBoard from "./plans-board";

export default async function Home() {
  // 로그인하지 않았으면 자료 화면 대신 로그인 화면으로 보낸다. (서버에서 확인)
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <AppHeader email={user.email} />

      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Plan-Do-See Diary
        </h1>
        <p className="mt-3 text-lg text-muted">
          계획을 세우고, 하나씩 실행하고, 걸린 시간으로 결과를 돌아봅니다.
        </p>
      </header>

      <PlansBoard />
    </main>
  );
}
