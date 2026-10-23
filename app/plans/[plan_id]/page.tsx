import Link from "next/link";
import { redirect } from "next/navigation";
import AppHeader from "@/app/app-header";
import { getCurrentUser } from "@/lib/auth/require-user";
import PlanDetail from "./plan-detail";

export default async function PlanPage({ params }: PageProps<"/plans/[plan_id]">) {
  // 로그인하지 않았으면 계획 화면을 보여 주지 않는다. (서버에서 확인)
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { plan_id } = await params;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <AppHeader email={user.email} />

      <Link href="/" className="text-sm text-muted hover:underline">
        계획 목록으로
      </Link>

      <PlanDetail planId={plan_id} />
    </main>
  );
}
