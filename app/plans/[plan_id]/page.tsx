import Link from "next/link";
import PlanDetail from "./plan-detail";

export default async function PlanPage({ params }: PageProps<"/plans/[plan_id]">) {
  const { plan_id } = await params;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/" className="text-sm text-muted hover:underline">
        계획 목록으로
      </Link>

      <PlanDetail planId={plan_id} />
    </main>
  );
}
