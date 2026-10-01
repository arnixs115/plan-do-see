import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ plan_id: string }> }
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