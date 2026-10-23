import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/require-user";
import SignupForm from "./signup-form";

export default async function SignupPage() {
  if (await getCurrentUser()) {
    redirect("/");
  }

  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-16">
      <h1 className="text-3xl font-bold tracking-tight">가입하기</h1>
      <p className="mt-2 mb-8 text-muted">이메일로 가입하고, 확인 메일의 링크를 눌러 마칩니다.</p>

      <SignupForm />

      <p className="mt-6 text-sm text-muted">
        이미 계정이 있나요?{" "}
        <Link href="/login" className="font-medium text-foreground underline">
          로그인
        </Link>
      </p>
    </main>
  );
}
