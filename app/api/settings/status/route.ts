import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { isSupabaseConfigured, getServerSupabase } from "@/lib/supabase/server";
import { newRedisClient } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  const youtube = Boolean(env.YOUTUBE_API_KEY);
  const gemini  = Boolean(env.GEMINI_API_KEY);
  const supabase = isSupabaseConfigured();

  let storage = false;
  if (supabase) {
    try {
      const sb = getServerSupabase();
      const { data, error } = await sb.storage.getBucket(env.SUPABASE_STORAGE_BUCKET);
      storage = !error && !!data;
    } catch { storage = false; }
  }

  let redis = false;
  try {
    const c = newRedisClient();
    await c.ping();
    await c.quit();
    redis = true;
  } catch { redis = false; }

  let approved: Array<{ channel_id: string | null; channel_title: string | null }> = [];
  let blocked: Array<{ channel_id: string | null; channel_title: string | null }> = [];
  if (supabase) {
    try {
      const sb = getServerSupabase();
      const { data } = await sb.from("channel_rules").select("channel_id, channel_title, rule");
      for (const r of data ?? []) {
        if (r.rule === "approved") approved.push({ channel_id: r.channel_id, channel_title: r.channel_title });
        else if (r.rule === "blocked") blocked.push({ channel_id: r.channel_id, channel_title: r.channel_title });
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    youtube, gemini, supabase, storage, redis,
    bucket: env.SUPABASE_STORAGE_BUCKET,
    approved, blocked,
    limits: {
      max_videos: env.MAX_VIDEOS_PER_PROJECT,
      max_clips_per_video: env.MAX_CLIPS_PER_VIDEO,
      max_source_seconds: env.MAX_SOURCE_DURATION_SECONDS,
    },
  });
}
