import type { Metadata } from "next";
import Link from "next/link";
import { primaryButton, secondaryButton } from "./ui-classes";

// 공개 소개 페이지. 첫 화면이다. (과제 8 카드 1)
//  * 이 웹 서비스(Plan-Do-See Diary)가 무엇이고 무엇을 할 수 있는지 소개한다. 사람(만든 이)을 소개하는 페이지가 아니다.
//  * 로그인 없이 누구나 볼 수 있다. proxy.ts 의 공개 경로에 정확히 "/" 만 들어 있고, 이 파일은 로그인 확인도 DB 조회도 하지 않는다.
//  * 적힌 기능은 실제로 화면·API 에 있는 것만 쓴다. (README 의 API 표, app/plans/[plan_id]/* 화면 코드에서 확인)
//    아직 없는 기능(패스키 등)은 적지 않는다.
//  * 개인 정보·연락처·계정 식별 정보·비공개 항목은 넣지 않는다. 비공개 자료는 로그인해야 열리는 /private 에만 있다.
//  * 맨 위 파란 띠가 "공개 영역"을 알린다. 비공개 영역(/private)은 반전된 색 띠와 점선 테두리로 구분한다.

export const metadata: Metadata = {
  title: "Plan-Do-See Diary",
  description: "계획하고, 실행하고, 결과를 돌아보는 다이어리. 계획을 세우고, 할 일을 하나씩 실행하고, 걸린 시간으로 결과를 확인합니다.",
};

const container = "mx-auto w-full max-w-[1000px] px-4 sm:px-6";

const steps = [
  {
    key: "plan",
    label: "PLAN",
    title: "계획을 세웁니다",
    points: [
      "계획에 기간, 우선순위, 성공 기준, 예상 시간을 적습니다.",
      "계획 아래에 할 일을 만들고 마감일, 태그, 예상 시간을 정합니다.",
      "계획을 고쳐도 수정 전 내용이 기록으로 남습니다.",
    ],
  },
  {
    key: "do",
    label: "DO",
    title: "하나씩 실행합니다",
    points: [
      "할 일마다 실행을 시작하고, 일시정지하고, 재개하고, 종료합니다.",
      "작업 시간은 실행한 구간을 더한 값이며 일시정지한 시간은 빠집니다.",
      "실행을 시작하면 할 일이 진행 중으로, 종료하면 완료로 바뀝니다.",
    ],
  },
  {
    key: "see",
    label: "SEE",
    title: "결과를 돌아봅니다",
    points: [
      "계획의 예상 시간과 실제 작업 시간을 나란히 봅니다.",
      "할 일별 예상 시간과 실제 시간을 표로 비교합니다.",
      "계획별 또는 전체 기록을 CSV 파일로 내려받습니다.",
    ],
  },
] as const;

export default function IntroPage() {
  return (
    <>
      {/* 공개 영역 표시 */}
      <div className="bg-accent text-accent-ink">
        <div className={`${container} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-xs`}>
          <p className="m-0">
            <strong className="mr-2 font-mono tracking-[0.09em]">공개 영역</strong>
            로그인 없이 누구나 볼 수 있는 소개 페이지입니다.
          </p>
          <nav aria-label="사이트 이동" className="flex gap-4 font-semibold">
            <Link href="/login" className="underline underline-offset-[3px]">
              로그인
            </Link>
            <Link href="/private" className="underline underline-offset-[3px]">
              비공개 영역
            </Link>
          </nav>
        </div>
      </div>

      <header className="border-b border-line bg-background">
        <div className={`${container} flex h-16 items-center justify-between`}>
          <a className="text-lg font-bold tracking-tight no-underline" href="#top" aria-label="페이지 처음으로">
            Plan-Do-See Diary
          </a>
          <div className="flex items-center gap-2">
            <Link href="/login" className={secondaryButton}>
              로그인
            </Link>
            <Link href="/signup" className={`${primaryButton} text-sm`}>
              가입하기
            </Link>
          </div>
        </div>
      </header>

      {/* break-keep: 한국어를 글자 중간이 아니라 띄어쓰기에서 줄바꿈한다 */}
      <main id="top" className="flex-1 break-keep">
        <section className={`${container} pt-12 pb-10 sm:pt-16`} aria-labelledby="hero-title">
          <p className="m-0 font-mono text-xs font-bold tracking-[0.09em] text-accent">PLAN · DO · SEE</p>
          <h1 id="hero-title" className="mt-3 mb-4 max-w-[720px] text-[32px] leading-[1.2] font-bold tracking-tight sm:text-5xl">
            계획하고, 실행하고,
            <br className="hidden sm:block" />
            결과를 돌아보는 다이어리
          </h1>
          <p className="m-0 max-w-[620px] text-base leading-[1.7] text-muted sm:text-lg">
            계획을 세우고, 할 일을 하나씩 실행하고, 걸린 시간으로 결과를 확인합니다.
            계획이 실제로 얼마나 걸렸는지 눈으로 보면서 다음 계획을 세울 수 있습니다.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup" className={`${primaryButton} inline-block`}>
              가입하고 시작하기
            </Link>
            <Link href="/login" className={`${secondaryButton} inline-block py-2`}>
              이미 계정이 있어요
            </Link>
          </div>
        </section>

        <section className={`${container} pb-12`} aria-labelledby="steps-title">
          <h2 id="steps-title" className="mb-5 text-xl font-bold tracking-tight">
            이렇게 씁니다
          </h2>
          <ol className="m-0 grid list-none gap-4 p-0 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.key} className="rounded-md border border-line bg-surface p-5">
                <p className="m-0 font-mono text-xs font-bold tracking-[0.09em] text-accent">
                  {index + 1} · {step.label}
                </p>
                <h3 className="mt-2 mb-3 text-lg font-semibold">{step.title}</h3>
                <ul className="m-0 list-disc space-y-2 pl-5 text-sm leading-[1.65] text-muted">
                  {step.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        <section className={`${container} pb-14`} aria-labelledby="access-title">
          <div className="rounded-md border border-line bg-surface p-5 sm:p-6">
            <h2 id="access-title" className="mt-0 mb-3 text-xl font-bold tracking-tight">
              공개된 곳과 로그인해야 열리는 곳
            </h2>
            <div className="grid gap-5 text-sm leading-[1.65] text-muted md:grid-cols-2">
              <div>
                <h3 className="mt-0 mb-1.5 text-base font-semibold text-foreground">이 소개 페이지 (공개)</h3>
                <p className="m-0">
                  누구나 로그인 없이 볼 수 있습니다. 계획이나 기록 같은 자료는 여기에 나오지 않습니다.
                </p>
              </div>
              <div>
                <h3 className="mt-0 mb-1.5 text-base font-semibold text-foreground">계획과 비공개 영역 (로그인 필요)</h3>
                <p className="m-0">
                  이메일로 가입하고 확인 메일의 링크를 누른 뒤 로그인하면 열립니다. 서버가 요청마다 로그인을 확인하고,
                  로그인하지 않은 요청에는 자료를 주지 않습니다. 지금은 이메일과 비밀번호로 로그인합니다.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className={`${container} flex min-h-[72px] flex-wrap items-center justify-between gap-3 py-4`}>
          <p className="m-0 text-sm font-semibold">Plan-Do-See Diary</p>
          <small className="text-muted">© 2026</small>
        </div>
      </footer>
    </>
  );
}
