// plans 생성(POST)과 수정(PATCH)이 함께 쓰는 입력 검증.
// 목록에 없는 키는 무시한다. 공통 검사는 validation-common.ts에 있다.

import {
  checkDate,
  checkMinutes,
  checkPriority,
  checkText,
  checkTitle,
  createCollector,
  hasField,
} from "./validation-common";

const TEXT_FIELDS = [
  "title",
  "description",
  "success_criteria",
  "next_plan_note",
] as const;

const DATE_FIELDS = ["start_date", "end_date", "target_date"] as const;

export type PlanInputMode = "create" | "update";

// create: title이 필수. 나머지는 생략하면 DB 기본값이 들어간다.
// update: 들어온 필드만 검증한다.
export function validatePlanInput(
  body: Record<string, unknown>,
  mode: PlanInputMode
) {
  const { values, errors, apply } = createCollector();

  if (mode === "create" && !hasField(body, "title")) {
    errors.push("title은 필수입니다.");
  }

  for (const field of TEXT_FIELDS) {
    if (!hasField(body, field)) continue;

    apply(
      field,
      field === "title" ? checkTitle(body.title) : checkText(field, body[field])
    );
  }

  for (const field of DATE_FIELDS) {
    if (!hasField(body, field)) continue;

    apply(field, checkDate(field, body[field]));
  }

  if (hasField(body, "priority")) {
    apply("priority", checkPriority(body.priority));
  }

  if (hasField(body, "estimated_minutes")) {
    apply("estimated_minutes", checkMinutes(body.estimated_minutes));
  }

  // 두 날짜가 모두 들어온 경우의 순서 검사.
  // 한쪽만 들어온 경우는 DB의 CHECK 제약조건이 최종적으로 막는다.
  if (
    typeof values.start_date === "string" &&
    typeof values.end_date === "string" &&
    values.start_date > values.end_date
  ) {
    errors.push("start_date는 end_date보다 늦을 수 없습니다.");
  }

  return { values, errors };
}
