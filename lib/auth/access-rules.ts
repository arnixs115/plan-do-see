// 자료 접근 규칙 (순수 함수: DB·네트워크를 쓰지 않아서 단위 시험이 가능하다)
//
// 모든 자료(할 일, 실행, 구간)의 소유자는 그것이 속한 계획(plans.user_id)이다.
//
//  * 내 계획              : 읽기·쓰기 모두 허용
//  * 예시 계획(is_example): 읽기는 누구나 허용. 쓰기는 admin만 허용, 그 밖에는 403
//  * 남의 계획            : 읽기·쓰기 모두 "없는 것"으로 취급해 404 (존재 여부를 알려 주지 않는다)
//  * 없는 계획            : 404 (남의 계획과 응답이 똑같아야 한다)

export type PlanOwnership = { user_id: string | null; is_example: boolean };
export type AccessMode = "read" | "write";
export type AccessDecision = "allow" | "not_found" | "example_read_only";

export function decideAccess(
  userId: string,
  plan: PlanOwnership | null,
  mode: AccessMode,
  isAdmin: boolean
): AccessDecision {
  if (!plan) return "not_found";

  if (plan.is_example) {
    if (mode === "read") return "allow";

    return isAdmin ? "allow" : "example_read_only";
  }

  return plan.user_id !== null && plan.user_id === userId ? "allow" : "not_found";
}
