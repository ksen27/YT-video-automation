import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const sb = getServerSupabase();
  const [{ data: media }, { data: render }, { data: project }] = await Promise.all([
    sb.from("media_jobs").select("*").eq("project_id", id).order("created_at", { ascending: true }),
    sb.from("render_jobs").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    sb.from("projects").select("status").eq("id", id).single(),
  ]);
  return NextResponse.json({
    project_status: project?.status ?? null,
    media_jobs: media ?? [],
    render_jobs: render ?? [],
  });
}
