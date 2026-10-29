import "server-only";
import type { AuthUser } from "@/lib/auth/require-user";

// 비공개 영역에 보여 줄 "가상" 항목. (과제 8 카드 1)
//
//  * 아래 내용은 전부 만들어 낸 가상 데이터다. 실제 사람·계정·연락처·일정과 관계가 없다.
//  * `server-only` 라서 클라이언트 컴포넌트가 import하면 빌드가 실패한다. 즉 브라우저로 보내는 코드 묶음에 들어갈 수 없다.
//  * 항목은 `listPrivateItems(user)` 로만 꺼낸다. 로그인 확인을 마친 사용자 객체(AuthUser)를 받아야 하므로,
//    "확인 없이 호출"하는 코드가 타입 수준에서 눈에 띈다. (확인 자체는 호출하는 쪽의 requireUser / getCurrentUser 가 한다)
//  * 이번 카드에서는 모든 로그인 사용자에게 같은 가상 항목을 보여 준다. 소유자별 저장은 하지 않는다.
//    (가상 데이터라서 DB 표를 만들지 않았다. 실제 비공개 자료를 넣게 되면 소유자 열과 소유권 검사가 먼저 필요하다.)
//  * 각 항목의 id 는 `PDEMO-` 로 시작한다. 시험 스크립트가 "비로그인 응답·HTML에 이 값이 없는가"를 볼 때 쓴다.

export type PrivateItemKind = "개인 메모" | "학습 목표" | "비공개 프로젝트 계획";

export type PrivateItem = {
  id: string;
  kind: PrivateItemKind;
  title: string;
  body: string;
};

const ITEMS: readonly PrivateItem[] = [
  {
    id: "PDEMO-001",
    kind: "개인 메모",
    title: "가상 메모: 주말에 정리할 것",
    body: "가상의 메모입니다. 책상 서랍 정리하기, 읽다 만 가상의 책 3장까지 읽기.",
  },
  {
    id: "PDEMO-002",
    kind: "학습 목표",
    title: "가상 학습 목표: 인증 흐름 이해하기",
    body: "가상의 목표입니다. 세션이 쿠키에 저장되는 방식을 그림으로 그려 설명할 수 있게 되기.",
  },
  {
    id: "PDEMO-003",
    kind: "비공개 프로젝트 계획",
    title: "가상 프로젝트: 별빛 일지",
    body: "가상의 프로젝트입니다. 밤하늘 관측 기록을 정리하는 작은 앱을 구상하는 중이며, 아직 어디에도 공개하지 않은 설정입니다.",
  },
  {
    id: "PDEMO-004",
    kind: "개인 메모",
    title: "가상 메모: 다음 주 점검 목록",
    body: "가상의 메모입니다. 가상의 점검표 두 개 훑어보기, 가상의 일정 하나 옮기기.",
  },
];

// 로그인한 사용자에게 보여 줄 비공개 항목. 호출하기 전에 로그인 확인을 반드시 끝낸다.
export function listPrivateItems(user: AuthUser): PrivateItem[] {
  // user 를 쓰지 않는 것처럼 보여도, 인자로 요구하는 것 자체가 "확인을 거친 뒤에만 호출"하라는 표시다.
  void user;

  return ITEMS.map((item) => ({ ...item }));
}
