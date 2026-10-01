import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();

  const {
    title,
    description,
    target_date,
    priority,
    success_criteria,
    estimated_minutes,
  } = body;

  const { data, error } = await supabase
    .from("plans")
    .insert({
      title,
      description,
      target_date,
      priority,
      success_criteria,
      estimated_minutes,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}