import path from "node:path";
import { promises as fs } from "node:fs";
import type { RenderJobData } from "@/lib/jobs/queue";
import { logJob, setMediaJob, setProjectStatus } from "@/lib/jobs/db";
import { getServerSupabase } from "@/lib/supabase/server";
import { ensureTmp, safeUnlink, uploadFile } from "@/lib/storage";
import { concatNormalizedClips, normalizeClip } from "@/lib/media/ffmpeg";

export async function processRenderJob(data: RenderJobData): Promise<void> {
  const sb = getServerSupabase();
  const { projectId, mediaJobId, renderJobId } = data;

  await setMediaJob(mediaJobId, { status: "running", progress: 5 });
  await sb.from("render_jobs").update({ status: "running", progress: 5 }).eq("id", renderJobId);
  await setProjectStatus(projectId, "rendering");

  // Pull approved timeline items (only ones with clips — placeholders are skipped
  // for MVP rendering; their script_text/overlay_text would be added in v2)
  const { data: items, error: itemsErr } = await sb
    .from("timeline_items")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  if (itemsErr) throw new Error(`load timeline: ${itemsErr.message}`);
  const renderable = (items ?? []).filter((it) => !!it.clip_id);
  if (renderable.length === 0) {
    await setMediaJob(mediaJobId, { status: "failed", error: "no renderable timeline items" });
    await sb.from("render_jobs").update({ status: "failed", error: "no renderable timeline items" }).eq("id", renderJobId);
    await setProjectStatus(projectId, "failed");
    throw new Error("no renderable timeline items");
  }

  const clipIds = renderable.map((it) => it.clip_id as string);
  const { data: clipRows } = await sb.from("video_clips").select("id, clip_url").in("id", clipIds);
  const clipUrlById = new Map<string, string | null>(
    (clipRows ?? []).map((c) => [c.id as string, (c.clip_url as string | null) ?? null])
  );

  const tmp = await ensureTmp(`render/${projectId}`);
  const downloaded: string[] = [];
  const normalized: string[] = [];

  try {
    // 1) Download each clip from public URL to local tmp
    for (let i = 0; i < renderable.length; i++) {
      const it = renderable[i];
      const url = clipUrlById.get(it.clip_id as string);
      if (!url) throw new Error(`clip ${it.clip_id} has no clip_url`);
      const local = path.join(tmp, `in_${String(i).padStart(3, "0")}.mp4`);
      await downloadHttp(url, local);
      downloaded.push(local);
      await setMediaJob(mediaJobId, { progress: 5 + Math.floor(((i + 1) / renderable.length) * 30) });
      await sb.from("render_jobs").update({ progress: 5 + Math.floor(((i + 1) / renderable.length) * 30) }).eq("id", renderJobId);
    }

    // 2) Normalize each clip (same res / fps / codec)
    for (let i = 0; i < downloaded.length; i++) {
      const out = path.join(tmp, `norm_${String(i).padStart(3, "0")}.mp4`);
      try {
        await normalizeClip({ inputPath: downloaded[i], outputPath: out, width: 1280, height: 720, fps: 30 });
        normalized.push(out);
      } catch (e) {
        await logJob({ projectId, jobId: mediaJobId },
          "render.normalize.failed", { idx: i, err: (e as Error).message });
        // Skip the bad one — continue rendering the rest
      }
      await setMediaJob(mediaJobId, { progress: 35 + Math.floor(((i + 1) / downloaded.length) * 30) });
      await sb.from("render_jobs").update({ progress: 35 + Math.floor(((i + 1) / downloaded.length) * 30) }).eq("id", renderJobId);
    }

    if (normalized.length === 0) throw new Error("all clips failed normalization");

    // 3) Optional voiceover from project
    const { data: project } = await sb.from("projects").select("voiceover_url, title").eq("id", projectId).single();
    let voiceoverLocal: string | undefined;
    if (project?.voiceover_url) {
      voiceoverLocal = path.join(tmp, "voiceover.audio");
      try { await downloadHttp(project.voiceover_url, voiceoverLocal); }
      catch { voiceoverLocal = undefined; }
    }

    // 4) Concat
    const finalLocal = path.join(tmp, `final_${projectId}.mp4`);
    await concatNormalizedClips({
      inputPaths: normalized,
      outputPath: finalLocal,
      voiceoverPath: voiceoverLocal,
      voiceoverGain: 1.0,
    });
    await setMediaJob(mediaJobId, { progress: 85 });
    await sb.from("render_jobs").update({ progress: 85 }).eq("id", renderJobId);

    // 5) Upload final
    const dest = `projects/${projectId}/final/${Date.now()}.mp4`;
    const up = await uploadFile(finalLocal, dest, "video/mp4");

    await sb.from("render_jobs").update({
      status: "completed", progress: 100, output_url: up.publicUrl,
    }).eq("id", renderJobId);
    await setMediaJob(mediaJobId, { status: "completed", progress: 100, metadata: { outputUrl: up.publicUrl } });
    await setProjectStatus(projectId, "completed");
  } catch (e) {
    const msg = (e as Error).message;
    await sb.from("render_jobs").update({ status: "failed", error: msg }).eq("id", renderJobId);
    await setMediaJob(mediaJobId, { status: "failed", error: msg });
    await setProjectStatus(projectId, "failed");
    throw e;
  } finally {
    // Best-effort cleanup
    for (const f of [...downloaded, ...normalized]) await safeUnlink(f);
    try {
      const entries = await fs.readdir(tmp);
      for (const f of entries) await safeUnlink(path.join(tmp, f));
    } catch { /* ignore */ }
  }
}

async function downloadHttp(url: string, destPath: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
}
