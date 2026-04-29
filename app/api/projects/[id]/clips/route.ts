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

  const { data: clips, error } = await sb
    .from("video_clips")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sourceIds = Array.from(new Set((clips ?? []).map((c) => c.video_source_id)));
  const { data: sources } = sourceIds.length
    ? await sb.from("video_sources").select("id, title, channel_title, youtube_url").in("id", sourceIds)
    : { data: [] as Array<{ id: string; title: string | null; channel_title: string | null; youtube_url: string | null }> };
  const byId = new Map((sources ?? []).map((s) => [s.id, s]));

  return NextResponse.json({
    clips: (clips ?? []).map((c) => ({ ...c, source: byId.get(c.video_source_id) ?? null })),
  });
}
