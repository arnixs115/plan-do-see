import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/require-user";
import LoginForm from "./login-form";
import PasskeyLoginButton from "./passkey-login-button";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // 이미 로그인했다면 로그인 화면을 보여 주지 않는다.
  if (await getCurrentUser()) {
    redirect("/plans");
  }

  const params = await searchParams;
  const notice =
    params.confirm === "failed"
      ? "이메일 확인 링크를 처리하지 못했습니다. 다른 브라우저에서 열었더라도 확인 자체는 끝났을 수 있으니 먼저 로그인해 보세요. 로그인되지 않으면 같은 이메일로 다시 가입을 시도하면 확인 메일을 다시 받을 수 있습니다."
      : undefined;

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">Plan-Do-See Diary</h1>
      <p className="mt-2 mb-8 text-muted">로그인하고 내 계획을 이어서 보세요.</p>

      <LoginForm notice={notice} />

      <div className="my-6 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        또는
        <span className="h-px flex-1 bg-line" />
      </div>

      <PasskeyLoginButton />

      <p className="mt-6 text-sm text-muted">
        계정이 없나요?{" "}
        <Link href="/signup" className="font-medium text-foreground underline">
          가입하기
        </Link>
      </p>
    </main>
  );
}
