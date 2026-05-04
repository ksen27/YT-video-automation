import { getServerSupabase } from "@/lib/supabase/server";
import { createMediaJob } from "@/lib/jobs/db";
import { enqueueMatch } from "@/lib/jobs/queue";

// Enqueue the match step once the project's download/clip queue has fully
// drained. "Drained" means: no video_source is still in flight (downloading,
// queued, or downloaded-but-not-yet-clipped) and no download/clip media_jobs
// remain queued or running. Failed sources/jobs are intentionally ignored —
// the pipeline should advance with whatever succeeded.
//
// Lives in a shared module (not just clipProcessor) so the download processor
// can call it after a terminal failure when no fallback could be promoted.
// Without that call, a project where the last in-flight download fails would
// never enqueue match → timeline stays empty → UI is stuck on "Processing".
export async function maybeEnqueueMatch(projectId: string): Promise<void> {
  const sb = getServerSupabase();

  const { data: sources } = await sb.from("video_sources")
    .select("id, status").eq("project_id", projectId);
  const stillBusy = (sources ?? []).some(
    (s) => s.status === "downloading" || s.status === "queued" || s.status === "downloaded",
  );
  if (stillBusy) return;

  const { data: openJobs } = await sb.from("media_jobs")
    .select("id, type, status").eq("project_id", projectId)
    .in("status", ["queued", "running"])
    .in("type", ["download", "clip"]);
  if ((openJobs ?? []).length > 0) return;

  // Don't double-enqueue if a match job already exists in any non-failed state.
  const { data: matchJobs } = await sb.from("media_jobs")
    .select("id, status").eq("project_id", projectId).eq("type", "match");
  if ((matchJobs ?? []).some(
    (j) => j.status === "queued" || j.status === "running" || j.status === "completed",
  )) return;

  // Need at least one ready clip to align — otherwise match would just fail.
  const { count: clipCount } = await sb
    .from("video_clips")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "ready");
  if (!clipCount || clipCount === 0) return;

  const id = await createMediaJob({ projectId, type: "match" });
  await enqueueMatch({ projectId, mediaJobId: id });
}
