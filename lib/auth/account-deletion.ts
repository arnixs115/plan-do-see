// 계정 삭제 확인 규칙 (순수 함수: DB·네트워크를 쓰지 않아서 단위 시험이 가능하다)
//
// 실수로 계정을 지우지 않도록, 삭제 요청 본문에 "내 계정의 이메일"을 다시 적게 한다.
// 이메일 비교는 대소문자와 앞뒤 공백을 무시한다. (가입 때도 소문자로 정규화한다)

export function confirmationMatches(input: unknown, accountEmail: string | null | undefined): boolean {
  if (typeof input !== "string" || !accountEmail) return false;

  return input.trim().toLowerCase() === accountEmail.trim().toLowerCase();
}
