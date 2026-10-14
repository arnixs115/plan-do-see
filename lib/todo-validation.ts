// todos 생성(POST)과 수정(PATCH)이 함께 쓰는 입력 검증.
// 목록에 없는 키는 무시한다.
//   - plan_id: 생성 시에는 URL 경로에서 받고, 수정으로는 바꿀 수 없다.
//   - deleted_at: 삭제(DELETE) API만 채운다.
// 상태(status)는 todo / in_progress / completed 중 어느 값으로든 바꿀 수 있다.
// (상태 전이 규칙은 정해진 바가 없어서 두지 않았다.)

import {
  checkDate,
  checkMinutes,
  checkPriority,
  checkText,
  checkTitle,
  createCollector,
  hasField,
  type Check,
} from "./validation-common";

const STATUSES = ["todo", "in_progress", "completed"];

function checkStatus(value: unknown): Check<string> {
  if (typeof value === "string" && STATUSES.includes(value)) {
    return { ok: true, value };
  }

  return {
    ok: false,
    error: "status는 todo, in_progress, completed 중 하나여야 합니다.",
  };
}

// 문자열 배열이고, 각 태그가 비어 있지 않으며 깨진 문자가 없어야 한다.
function checkTags(value: unknown): Check<string[]> {
  if (!Array.isArray(value)) {
    return { ok: false, error: "tags는 문자열 배열이어야 합니다." };
  }

  for (const tag of value) {
    if (typeof tag !== "string") {
      return { ok: false, error: "tags의 각 항목은 문자열이어야 합니다." };
    }

    if (tag.includes("�")) {
      return {
        ok: false,
        error: "tags에 깨진 문자(�)가 포함되어 있습니다. UTF-8로 보내주세요.",
      };
    }

    if (tag.trim().length === 0) {
      return { ok: false, error: "tags의 각 항목은 비어 있을 수 없습니다." };
    }
  }

  return { ok: true, value: value as string[] };
}

export type TodoInputMode = "create" | "update";

// create: title이 필수. 나머지는 생략하면 DB 기본값이 들어간다.
// update: 들어온 필드만 검증한다.
export function validateTodoInput(
  body: Record<string, unknown>,
  mode: TodoInputMode
) {
  const { values, errors, apply } = createCollector();

  if (mode === "create" && !hasField(body, "title")) {
    errors.push("title은 필수입니다.");
  }

  if (hasField(body, "title")) {
    apply("title", checkTitle(body.title));
  }

  if (hasField(body, "description")) {
    apply("description", checkText("description", body.description));
  }

  if (hasField(body, "due_date")) {
    apply("due_date", checkDate("due_date", body.due_date));
  }

  if (hasField(body, "priority")) {
    apply("priority", checkPriority(body.priority));
  }

  if (hasField(body, "tags")) {
    apply("tags", checkTags(body.tags));
  }

  if (hasField(body, "estimated_minutes")) {
    apply("estimated_minutes", checkMinutes(body.estimated_minutes));
  }

  if (hasField(body, "status")) {
    apply("status", checkStatus(body.status));
  }

  return { values, errors };
}
