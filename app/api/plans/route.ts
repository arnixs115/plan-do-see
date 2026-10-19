import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  dbErrorResponse,
  errorResponse,
  readJsonObject,
} from "@/lib/api-utils";
import { validatePlanInput } from "@/lib/plan-validation";

export async function GET() {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return dbErrorResponse(error, "GET /api/plans");
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const parsed = await readJsonObject(request);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { values, errors } = validatePlanInput(parsed.body, "create");

  if (errors.length > 0) {
    return errorResponse(errors, 400);
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("plans")
    .insert(values)
    .select()
    .single();

  if (error) {
    return dbErrorResponse(error, "POST /api/plans");
  }

  return NextResponse.json(data, { status: 201 });
}
