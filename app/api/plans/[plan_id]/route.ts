import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type RouteContext = {
  params: Promise<{ plan_id: string }>;
};

export async function GET(
  request: Request,
  { params }: RouteContext
) {
  const supabase = getSupabaseAdmin();
  const { plan_id } = await params;

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

// ---------------------------------------------------------------------------
// PATCH 입력 검증
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIORITIES = ["low", "medium", "high"];
const TEXT_FIELDS = [
  "title",
  "description",
  "success_criteria",
  "next_plan_note",
] as const;
const DATE_FIELDS = ["start_date", "end_date", "target_date"] as const;

// PostgreSQL integer(int4)의 최댓값
const MAX_INT4 = 2147483647;

function hasField(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

// "YYYY-MM-DD" 형식이면서 실제로 존재하는 날짜인지 확인한다. (예: 2026-02-30은 거부)
function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// 수정 가능한 필드만 골라 검증한다. 목록에 없는 키는 무시한다.
function validatePlanUpdates(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const field of TEXT_FIELDS) {
    if (!hasField(body, field)) continue;

    const value = body[field];

    if (typeof value !== "string") {
      errors.push(`${field}는 문자열이어야 합니다.`);
    } else if (field === "title" && value.trim().length === 0) {
      errors.push("title은 비어 있을 수 없습니다.");
    } else {
      updates[field] = value;
    }
  }

  for (const field of DATE_FIELDS) {
    if (!hasField(body, field)) continue;

    const value = body[field];

    if (value === null || isValidDateString(value)) {
      updates[field] = value;
    } else {
      errors.push(`${field}는 YYYY-MM-DD 형식의 날짜이거나 null이어야 합니다.`);
    }
  }

  if (hasField(body, "priority")) {
    const value = body.priority;

    if (typeof value === "string" && PRIORITIES.includes(value)) {
      updates.priority = value;
    } else {
      errors.push("priority는 low, medium, high 중 하나여야 합니다.");
    }
  }

  if (hasField(body, "estimated_minutes")) {
    const value = body.estimated_minutes;

    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_INT4
    ) {
      updates.estimated_minutes = value;
    } else {
      errors.push("estimated_minutes는 0 이상의 정수여야 합니다.");
    }
  }

  // 두 날짜가 모두 들어온 경우의 순서 검사.
  // 한쪽만 들어온 경우는 DB의 CHECK 제약조건이 최종적으로 막는다.
  if (
    typeof updates.start_date === "string" &&
    typeof updates.end_date === "string" &&
    updates.start_date > updates.end_date
  ) {
    errors.push("start_date는 end_date보다 늦을 수 없습니다.");
  }

  return { updates, errors };
}

// 요청 값 문제로 DB가 거절한 경우의 SQLSTATE 코드 (400으로 응답)
//   23514: CHECK 위반 / 23502: NOT NULL 위반
//   22007, 22008: 날짜 형식·범위 오류 / 22003: 숫자 범위 초과 / 22P02: 잘못된 입력 형식
const CLIENT_ERROR_CODES = new Set([
  "23514",
  "23502",
  "22007",
  "22008",
  "22003",
  "22P02",
]);

type UpdatePlanResult = {
  revision_no: number;
  plan: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// PATCH: 수정 전 내용을 revision으로 보존한 뒤 계획을 갱신한다.
// 보존과 갱신은 DB 함수(update_plan_with_revision) 안에서 하나의 트랜잭션으로 처리된다.
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  const { plan_id } = await params;

  if (!UUID_PATTERN.test(plan_id)) {
    return NextResponse.json(
      { error: "plan_id가 올바른 형식이 아닙니다." },
      { status: 400 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "요청 본문이 올바른 JSON이 아닙니다." },
      { status: 400 }
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: "요청 본문은 JSON 객체여야 합니다." },
      { status: 400 }
    );
  }

  const { updates, errors } = validatePlanUpdates(
    body as Record<string, unknown>
  );

  if (errors.length > 0) {
    return NextResponse.json({ error: errors }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "수정할 항목이 없습니다." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("update_plan_with_revision", {
    p_plan_id: plan_id,
    p_updates: updates,
  });

  if (error) {
    // 함수 안에서 raise exception ... errcode 'P0002' 로 던진 "계획 없음"
    if (error.code === "P0002") {
      return NextResponse.json(
        { error: "계획을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (CLIENT_ERROR_CODES.has(error.code)) {
      return NextResponse.json(
        { error: "요청 값이 데이터 제약조건에 맞지 않습니다." },
        { status: 400 }
      );
    }

    // 그 외는 서버 오류. DB 내부 메시지는 응답에 노출하지 않고 서버 로그에만 남긴다.
    console.error("PATCH /api/plans/[plan_id] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }

  const result = data as UpdatePlanResult | null;

  if (!result) {
    console.error("PATCH /api/plans/[plan_id]: 함수가 빈 결과를 반환했습니다.");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: "계획이 수정되었습니다.",
    revision_no: result.revision_no,
    data: result.plan,
  });
}
