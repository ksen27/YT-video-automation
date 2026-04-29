import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { createMediaJob } from "@/lib/jobs/db";
import { enqueueRender } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("render_jobs")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ render_jobs: data ?? [] });
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const sb = getServerSupabase();

  // Require approved timeline
  const { data: items, error: itemsErr } = await sb
    .from("timeline_items").select("id, approved, clip_id").eq("project_id", id);
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  if (!items?.length) return NextResponse.json({ error: "timeline is empty" }, { status: 400 });
  const renderable = items.filter((it) => !!it.clip_id);
  if (renderable.length === 0) return NextResponse.json({ error: "no clips on timeline" }, { status: 400 });
  if (!renderable.every((it) => it.approved)) {
    return NextResponse.json({ error: "approve timeline before rendering" }, { status: 400 });
  }

  // Refuse if a render is already running
  const { data: open } = await sb
    .from("render_jobs").select("id, status").eq("project_id", id)
    .in("status", ["queued", "running"]).limit(1);
  if ((open ?? []).length > 0) {
    return NextResponse.json({ error: "render already in progress" }, { status: 409 });
  }

  const { data: rj, error: rjErr } = await sb
    .from("render_jobs")
    .insert({ project_id: id, status: "queued", progress: 0 })
    .select("*").single();
  if (rjErr) return NextResponse.json({ error: rjErr.message }, { status: 500 });

  const mediaJobId = await createMediaJob({
    projectId: id, type: "render", metadata: { renderJobId: rj.id },
  });
  await enqueueRender({ projectId: id, mediaJobId, renderJobId: rj.id });

  return NextResponse.json({ render_job: rj, media_job_id: mediaJobId }, { status: 202 });
}
