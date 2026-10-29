// 공개 소개 페이지(과제 8 카드 1, 첫 화면 `/`) 확인 스크립트. 로그인 정보가 필요 없다. 읽기 요청만 보낸다.
//
// 사용법:  1) 터미널 A:  npm run dev   (또는 npm run build 후 npm start)
//          2) 터미널 B:  node scripts/verify-intro.mjs                       (기본 http://localhost:3000)
//                        node scripts/verify-intro.mjs https://<배포 주소>
//
// 본 것: 비로그인으로 `/` 가 로그인 화면으로 이동하지 않고 이 웹 서비스(Plan-Do-See Diary)의 소개 내용(히어로, Plan·Do·See 3단계,
//        공개/비공개 안내, 바닥글)을 보여 주는가, 그 HTML에 비공개 항목이 없는가,
//        비공개 영역(/private)과 계획 대시보드(/plans)는 여전히 로그인으로 이동하는가.
// 못 보는 것: 화면 모양과 링크를 눌렀을 때의 이동(브라우저에서 직접 확인한다. docs/public-intro.md)

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `   -> ${detail}`}`);
}

// HTML 에서 태그를 지우고 흔한 문자 참조를 풀어 "사람이 읽는 글자"만 남긴다.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

// 비로그인 응답·HTML에 있으면 안 되는 비공개 항목(lib/private/items.ts)의 표식
const PRIVATE_MARKERS = ["PDEMO-", "별빛 일지", "가상 메모", "가상 학습 목표", "가상 프로젝트"];

async function get(path) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const text = await res.text();
  return { status: res.status, text, res };
}

try {
  let r = await get("/");
  check("비로그인 / 가 200 (로그인으로 이동하지 않는다)", r.status === 200, `${r.status} ${r.res.headers.get("location") ?? ""}`);

  const text = visibleText(r.text);
  const mustHave = [
    // 머리글·히어로
    "Plan-Do-See Diary", "PLAN · DO · SEE",
    "계획하고, 실행하고,", "결과를 돌아보는 다이어리",
    "가입하고 시작하기", "이미 계정이 있어요",
    // Plan · Do · See 3단계
    "이렇게 씁니다",
    "1 · PLAN", "계획을 세웁니다",
    "2 · DO", "하나씩 실행합니다",
    "3 · SEE", "결과를 돌아봅니다",
    "계획을 고쳐도 수정 전 내용이 기록으로 남습니다.",
    "실행을 시작하면 할 일이 진행 중으로, 종료하면 완료로 바뀝니다.",
    "계획별 또는 전체 기록을 CSV 파일로 내려받습니다.",
    // 공개/비공개 안내
    "공개된 곳과 로그인해야 열리는 곳", "이 소개 페이지 (공개)", "계획과 비공개 영역 (로그인 필요)",
    "지금은 이메일과 비밀번호로 로그인합니다.",
    // 바닥글
    "© 2026",
  ];
  const missing = mustHave.filter((s) => !text.includes(s));
  check(`소개 내용 ${mustHave.length}개 문구가 모두 HTML에 있다`, missing.length === 0, `빠진 문구: ${missing.join(" | ")}`);
  check("공개 영역 표시가 있다", text.includes("공개 영역"), "");
  check("/ 의 HTML에 비공개 항목이 없다", PRIVATE_MARKERS.every((m) => !r.text.includes(m)), PRIVATE_MARKERS.filter((m) => r.text.includes(m)).join(", "));
  check("/ 에 로그인한 사용자 정보 자리(이메일 형태)가 없다", !/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text), (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) ?? [""])[0]);

  for (const path of ["/private", "/plans"]) {
    r = await get(path);
    const location = r.res.headers.get("location") ?? "";
    check(`비로그인 ${path} 은 로그인 화면으로 이동(307/308)`, [307, 308].includes(r.status) && location.endsWith("/login"), `${r.status} ${location}`);
    check(`그 응답 본문에 비공개 항목이 없다 (${path})`, PRIVATE_MARKERS.every((m) => !r.text.includes(m)), "");
  }

  r = await get("/api/private-items");
  check("비로그인 /api/private-items 는 401", r.status === 401, String(r.status));
  r = await get("/api/plans");
  check("비로그인 /api/plans 는 401", r.status === 401, String(r.status));
} catch (e) {
  failed++;
  console.log("ERROR ", e.message);
}

console.log(`\n${results.length - failed}/${results.length} 통과, 실패 ${failed}`);
process.exit(failed ? 1 : 0);
