import path from "node:path";
import { promises as fs } from "node:fs";
import type { DownloadJobData } from "@/lib/jobs/queue";
import { createMediaJob, logJob, setMediaJob } from "@/lib/jobs/db";
import { enqueueClip } from "@/lib/jobs/queue";
import { getServerSupabase } from "@/lib/supabase/server";
import { downloadYoutubeVideo } from "@/lib/media/ytdlp";
import { probeFile } from "@/lib/media/probe";
import { ensureTmp, safeUnlink } from "@/lib/storage";
import { getEnv } from "@/lib/env";
import { safeFilename } from "@/lib/utils";

export async function processDownloadJob(data: DownloadJobData): Promise<void> {
  const env = getEnv();
  const sb = getServerSupabase();
  const { projectId, mediaJobId, youtubeVideoId, youtubeUrl } = data;

  await setMediaJob(mediaJobId, { status: "running", progress: 5 });

  // 1) Reuse-cached: if we have a video_source for this YouTube ID already with
  //    clipped clips, just enqueue match (or skip — clips are already linked
  //    to a different project; for MVP, fork by re-clipping for new project).
  const safeId = safeFilename(youtubeVideoId);
  const { data: existing } = await sb
    .from("video_sources")
    .select("*")
    .eq("youtube_video_id", safeId)
    .maybeSingle();

  if (existing && existing.status === "clipped" && existing.local_path) {
    // Already have file locally — re-clip cheaply by cutting again from cache.
    await logJob({ projectId, jobId: mediaJobId, sourceId: existing.id }, "download.cache.hit");
    // Make sure source is associated with this project (one source row per video).
    if (existing.project_id !== projectId) {
      await sb.from("video_sources").update({ project_id: projectId }).eq("id", existing.id);
    }
    const childId = await createMediaJob({ projectId, type: "clip", metadata: { videoSourceId: existing.id, cached: true } });
    await enqueueClip({ projectId, mediaJobId: childId, videoSourceId: existing.id });
    await setMediaJob(mediaJobId, { status: "completed", progress: 100, metadata: { cached: true } });
    return;
  }

  // 2) Upsert a video_source row (status=downloading)
  const { data: vs, error: vsErr } = await sb.from("video_sources").upsert(
    {
      project_id: projectId,
      youtube_video_id: safeId,
      youtube_url: youtubeUrl,
      status: "downloading",
      error: null,
    },
    { onConflict: "youtube_video_id" }
  ).select("*").single();
  if (vsErr || !vs) throw new Error(`upsert video_source: ${vsErr?.message}`);

  await setMediaJob(mediaJobId, { progress: 15, metadata: { videoSourceId: vs.id } });

  // 3) Download with yt-dlp
  const tmp = await ensureTmp(`source/${safeId}`);
  try {
    const result = await downloadYoutubeVideo({
      url: youtubeUrl, outputDir: tmp, videoId: safeId, maxHeight: 720,
      onLog: () => { /* keep stdout clean — high-volume */ },
    });

    await setMediaJob(mediaJobId, { progress: 60 });

    // 4) Probe
    const probe = await probeFile(result.outputPath);
    if (probe.durationSeconds > env.MAX_SOURCE_DURATION_SECONDS) {
      await safeUnlink(result.outputPath);
      await sb.from("video_sources").update({
        status: "failed",
        error: `duration ${Math.round(probe.durationSeconds)}s > max ${env.MAX_SOURCE_DURATION_SECONDS}s`,
      }).eq("id", vs.id);
      await setMediaJob(mediaJobId, { status: "failed", progress: 100, error: "source too long" });
      return; // do not throw — we want other downloads to continue
    }

    // 5) Mark video_source ready for clipping
    const { error: updErr } = await sb.from("video_sources").update({
      status: "downloaded",
      local_path: path.resolve(result.outputPath),
      duration_seconds: Math.round(probe.durationSeconds),
      title: vs.title,
      metadata: {
        ...(vs.metadata as Record<string, unknown> ?? {}),
        probe: { width: probe.width, height: probe.height, hasAudio: probe.hasAudio,
                 videoCodec: probe.videoCodec, audioCodec: probe.audioCodec },
      },
    }).eq("id", vs.id);
    if (updErr) throw new Error(`update video_source: ${updErr.message}`);

    // 6) Update youtube_search_results status to "downloaded"
    await sb.from("youtube_search_results")
      .update({ status: "downloaded" })
      .eq("project_id", projectId)
      .eq("youtube_video_id", safeId);

    await setMediaJob(mediaJobId, { progress: 90 });

    // 7) Enqueue clip job
    const clipJobId = await createMediaJob({
      projectId, type: "clip", metadata: { videoSourceId: vs.id },
    });
    await enqueueClip({ projectId, mediaJobId: clipJobId, videoSourceId: vs.id });

    await setMediaJob(mediaJobId, { status: "completed", progress: 100 });
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from("video_sources").update({ status: "failed", error: msg }).eq("id", vs.id);
    await setMediaJob(mediaJobId, { status: "failed", error: msg });
    // Try to clean partial files
    try {
      const files = await fs.readdir(tmp);
      for (const f of files) await safeUnlink(path.join(tmp, f));
    } catch { /* ignore */ }
    // Don't rethrow — we don't want a single failed video to block siblings
    // beyond BullMQ's own retry semantics. We've recorded the error.
  }
}
