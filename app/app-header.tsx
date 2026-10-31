import Link from "next/link";
import { logout } from "@/app/auth/actions";
import { secondaryButton } from "@/app/ui-classes";

// 로그인한 상태에서 모든 화면 위에 보이는 줄: 누구로 로그인했는지 + 로그아웃
export default function AppHeader({ email }: { email: string | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-end gap-3 text-sm">
      {email && <span className="text-muted break-all">{email}</span>}
      <Link href="/" className={secondaryButton}>
        소개 페이지
      </Link>
      <Link href="/private" className={secondaryButton}>
        비공개 영역
      </Link>
      <Link href="/account" className={secondaryButton}>
        계정
      </Link>
      <form action={logout}>
        <button type="submit" className={secondaryButton}>
          로그아웃
        </button>
      </form>
    </div>
  );
}
