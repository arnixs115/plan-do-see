
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

type RouteContext = {
  params: Promise<{ plan_id: string }>;
};

export async function GET(
  request: Request,
  { params }: RouteContext
) {
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

export async function PATCH(
  request: Request,
  { params }: RouteContext
) {
  const { plan_id } = await params;
  const body = await request.json();

  // 1. 현재 계획 조회
  const { data: currentPlan, error: fetchError } =
    await supabase
      .from("plans")
      .select("*")
      .eq("id", plan_id)
      .single();

  if (fetchError) {
    return NextResponse.json(
      { error: "계획을 찾을 수 없습니다." },
      { status: 404 }
    );
  }

  // 2. 수정 가능한 필드만 추출
  const allowedFields = [
    "title",
    "description",
    "start_date",
    "target_date",
    "priority",
    "success_criteria",
    "estimated_minutes",
  ] as const;

  const updates: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "수정할 항목이 없습니다." },
      { status: 400 }
    );
  }

  // 3. 이전 revision 번호 조회
  const { data: revisions, error: revisionQueryError } =
    await supabase
      .from("plan_revisions")
      .select("revision_no")
      .eq("plan_id", plan_id)
      .order("revision_no", { ascending: false })
      .limit(1);

  if (revisionQueryError) {
    return NextResponse.json(
      { error: revisionQueryError.message },
      { status: 500 }
    );
  }

  const revisionNo =
    (revisions?.[0]?.revision_no ?? 0) + 1;

  // 4. 수정 전 계획을 revision 테이블에 저장
  const { error: saveRevisionError } = await supabase
    .from("plan_revisions")
    .insert({
      plan_id: currentPlan.id,
      title: currentPlan.title,
      description: currentPlan.description,
      start_date: currentPlan.start_date,
      target_date: currentPlan.target_date,
      priority: currentPlan.priority,
      success_criteria: currentPlan.success_criteria,
      estimated_minutes: currentPlan.estimated_minutes,
      revision_no: revisionNo,
    });

  if (saveRevisionError) {
    return NextResponse.json(
      { error: saveRevisionError.message },
      { status: 500 }
    );
  }

  // 5. 현재 계획 수정
  const { data: updatedPlan, error: updateError } =
    await supabase
      .from("plans")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan_id)
      .select()
      .single();

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: "계획이 수정되었습니다.",
    revision_no: revisionNo,
    data: updatedPlan,
  });
}
