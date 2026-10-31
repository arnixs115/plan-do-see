import { redirect } from "next/navigation";
import Link from "next/link";
import AppHeader from "@/app/app-header";
import { getCurrentUser } from "@/lib/auth/require-user";
import { listPasskeys } from "@/lib/passkeys/store";
import DeleteAccountForm from "./delete-account-form";
import PasskeySection from "./passkey-section";

export default async function AccountPage() {
  // 로그인하지 않았으면 이 화면을 보여 주지 않는다. (서버에서 확인)
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  // 패스키 목록은 로그인한 본인 것만 읽는다. 읽지 못해도(예: 마이그레이션 미적용) 계정 화면의 나머지는 그대로 보여 준다.
  let passkeys: Awaited<ReturnType<typeof listPasskeys>>["data"] = null;
  let passkeyLoadError: string | null = null;

  try {
    const result = await listPasskeys(user.id);
    passkeys = result.data;

    if (result.error || !result.data) {
      console.error("계정 화면: 패스키 목록 조회 실패:", result.error?.code ?? "알 수 없음");
      passkeyLoadError = "패스키 목록을 불러오지 못했습니다.";
    }
  } catch (error) {
    console.error("계정 화면: 패스키 목록 조회 오류:", error instanceof Error ? error.name : "알 수 없음");
    passkeyLoadError = "패스키 목록을 불러오지 못했습니다.";
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <AppHeader email={user.email} />

      <Link href="/" className="text-sm text-muted hover:underline">
        계획 목록으로
      </Link>

      <h1 className="mt-4 text-3xl font-bold tracking-tight">계정</h1>

      <PasskeySection initialPasskeys={passkeys ?? []} loadError={passkeyLoadError} />

      <section className="mt-8 rounded-md border border-danger p-5">
        <h2 className="text-lg font-semibold text-danger">계정 삭제</h2>
        <p className="mt-2 text-sm text-muted">
          계정과 함께 내 계획, 할 일, 실행 기록, 계획 수정 기록, 등록한 패스키가 모두 지워지고 <strong>되돌릴 수 없습니다.</strong>{" "}
          모든 사용자에게 보이는 예시 계획과 다른 사용자의 자료는 영향을 받지 않습니다.
        </p>

        <DeleteAccountForm email={user.email ?? ""} />
      </section>
    </main>
  );
}
