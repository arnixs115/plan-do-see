import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { dbErrorResponse, errorResponse } from "@/lib/api-utils";
import { decideAccess, type AccessMode, type PlanOwnership } from "./access-rules";
import type { AuthUser } from "./require-user";

// 소유권 확인. id로 부르는 모든 API가 `requireUser()` 바로 뒤에서 호출한다.
//
// 이 프로젝트의 서버는 비밀 키로 DB에 접근하므로 RLS가 적용되지 않는다.
// 그래서 "이 사용자가 이 자료의 주인인가"는 이 파일이 막는 유일한 검사다. (db/README.md, docs/auth.md 참고)
//
//  * 할 일은 todos.plan_id, 실행은 executions.todo_id → todos.plan_id 로 계획을 찾아 계획의 소유자를 본다.
//  * 남의 자료와 없는 자료는 같은 404 응답(같은 문구)이다.
//  * 예시 계획에 쓰려 하면 admin이 아닌 한 403이다.
//  * 소프트 삭제된 할 일도 여기서는 계획을 찾는 데만 쓰고, "삭제됨 → 404" 처리는 각 라우트가 그대로 한다.

type Denied = { ok: false; response: NextResponse };
type Allowed = { ok: true; plan: PlanOwnership & { id: string } };
export type AccessResult = Allowed | Denied;

const EXAMPLE_READ_ONLY_MESSAGE = "예시 자료는 읽기만 할 수 있습니다.";

async function isAdmin(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return { admin: !!data, error };
}

async function check(
  supabase: SupabaseClient,
  user: AuthUser,
  planId: string | null,
  mode: AccessMode,
  label: string,
  notFoundMessage: string
): Promise<AccessResult> {
  const notFound: Denied = { ok: false, response: errorResponse(notFoundMessage, 404) };

  if (!planId) return notFound;

  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, user_id, is_example")
    .eq("id", planId)
    .maybeSingle();

  if (error) return { ok: false, response: dbErrorResponse(error, label) };

  // admin 여부는 "예시 계획에 쓰기"일 때만 필요하다.
  let admin = false;

  if (plan?.is_example && mode === "write") {
    const result = await isAdmin(supabase, user.id);

    if (result.error) return { ok: false, response: dbErrorResponse(result.error, label) };

    admin = result.admin;
  }

  switch (decideAccess(user.id, plan, mode, admin)) {
    case "allow":
      return { ok: true, plan: plan as Allowed["plan"] };
    case "example_read_only":
      return { ok: false, response: errorResponse(EXAMPLE_READ_ONLY_MESSAGE, 403) };
    default:
      return notFound;
  }
}

export function authorizePlan(
  supabase: SupabaseClient,
  user: AuthUser,
  planId: string,
  mode: AccessMode,
  label: string
) {
  return check(supabase, user, planId, mode, label, "계획을 찾을 수 없습니다.");
}

export async function authorizeTodo(
  supabase: SupabaseClient,
  user: AuthUser,
  todoId: string,
  mode: AccessMode,
  label: string
) {
  const { data, error } = await supabase.from("todos").select("plan_id").eq("id", todoId).maybeSingle();

  if (error) return { ok: false as const, response: dbErrorResponse(error, label) };

  return check(supabase, user, data?.plan_id ?? null, mode, label, "할 일을 찾을 수 없습니다.");
}

export async function authorizeExecution(
  supabase: SupabaseClient,
  user: AuthUser,
  executionId: string,
  mode: AccessMode,
  label: string
) {
  const { data: execution, error } = await supabase
    .from("executions")
    .select("todo_id")
    .eq("id", executionId)
    .maybeSingle();

  if (error) return { ok: false as const, response: dbErrorResponse(error, label) };

  if (!execution) return check(supabase, user, null, mode, label, "실행을 찾을 수 없습니다.");

  const { data: todo, error: todoError } = await supabase
    .from("todos")
    .select("plan_id")
    .eq("id", execution.todo_id)
    .maybeSingle();

  if (todoError) return { ok: false as const, response: dbErrorResponse(todoError, label) };

  return check(supabase, user, todo?.plan_id ?? null, mode, label, "실행을 찾을 수 없습니다.");
}
