import type { MatchJobData } from "@/lib/jobs/queue";
import { logJob, setMediaJob, setProjectStatus } from "@/lib/jobs/db";
import { getServerSupabase } from "@/lib/supabase/server";
import { matchClipsToSections, type ClipForMatch } from "@/lib/ai/gemini";

// Splits a transcript into ~sentence/paragraph sections. Cheap MVP heuristic.
export function splitTranscript(transcript: string): string[] {
  const cleaned = transcript.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  // Try paragraph splits first
  const paras = transcript.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 4) return paras;
  // Otherwise sentence-ish split
  const sents = cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).filter(Boolean);
  return sents.length ? sents : [cleaned];
}

export async function processMatchJob(data: MatchJobData): Promise<void> {
  const sb = getServerSupabase();
  const { projectId, mediaJobId } = data;

  await setMediaJob(mediaJobId, { status: "running", progress: 5 });
  await setProjectStatus(projectId, "matching");

  const { data: project } = await sb.from("projects").select("transcript").eq("id", projectId).single();
  const sections = splitTranscript(project?.transcript ?? "");

  const { data: clipRows } = await sb
    .from("video_clips")
    .select("id, start_time, end_time, labels, video_source_id, status")
    .eq("project_id", projectId)
    .eq("status", "ready");
  const clips = clipRows ?? [];

  if (clips.length === 0) {
    await setMediaJob(mediaJobId, { status: "failed", progress: 100, error: "no ready clips to match" });
    await setProjectStatus(projectId, "failed");
    throw new Error("no ready clips to match");
  }

  // Hydrate source titles for matching prompt
  const sourceIds = Array.from(new Set(clips.map((c) => c.video_source_id))).filter(Boolean);
  const { data: sources } = await sb.from("video_sources").select("id, title").in("id", sourceIds);
  const titleById = new Map<string, string | null>(
    (sources ?? []).map((s) => [s.id as string, (s.title as string | null) ?? null])
  );

  const clipsForMatch: ClipForMatch[] = clips.map((c) => ({
    id: c.id,
    source_title: titleById.get(c.video_source_id) ?? null,
    start_time: c.start_time,
    end_time: c.end_time,
    labels: Array.isArray(c.labels) ? c.labels as string[] : [],
  }));

  let matches: { section_index: number; clip_id: string | null }[] = [];
  try {
    matches = await matchClipsToSections(sections, clipsForMatch);
  } catch (e) {
    await logJob({ projectId, jobId: mediaJobId }, "match.gemini.failed", { err: (e as Error).message });
  }
  await setMediaJob(mediaJobId, { progress: 50 });

  // Fallback: round-robin clip assignment if Gemini gave us nothing useful
  if (matches.length < sections.length) {
    const need = sections.length - matches.length;
    const used = new Set(matches.map((m) => m.section_index));
    let cIdx = 0;
    for (let i = 0; i < sections.length && need > 0; i++) {
      if (used.has(i)) continue;
      const clip = clips[cIdx++ % clips.length];
      matches.push({ section_index: i, clip_id: clip?.id ?? null });
    }
  }

  // Wipe old draft for this project (so re-runs work)
  await sb.from("timeline_items").delete().eq("project_id", projectId);

  // Build timeline
  const items: Array<Record<string, unknown>> = [];
  let position = 0;
  // Intro item — use first clip if available, 5–6s
  const introClip = clips[0];
  items.push({
    project_id: projectId,
    clip_id: introClip?.id ?? null,
    type: "intro",
    position: position++,
    duration: 6,
    script_text: sections[0] ?? null,
    overlay_text: null,
    metadata: {},
    approved: false,
  });

  // Body — alternate footage / image placeholder roughly 60/40
  for (let i = 0; i < sections.length; i++) {
    const m = matches.find((mm) => mm.section_index === i);
    const clipId = m?.clip_id ?? null;
    const useImage = !clipId || (i % 5 === 4); // every 5th = image placeholder
    items.push({
      project_id: projectId,
      clip_id: useImage ? null : clipId,
      type: useImage ? "image" : "footage",
      position: position++,
      duration: 5,
      script_text: sections[i] ?? null,
      overlay_text: null,
      metadata: useImage ? { placeholder: true } : {},
      approved: false,
    });

    // Sprinkle in a split_2 every 6 sections, split_4 every 10 sections
    if (i > 0 && i % 6 === 0) {
      items.push({
        project_id: projectId, clip_id: null, type: "split_2",
        position: position++, duration: 4, script_text: null, overlay_text: null,
        metadata: { placeholder: true }, approved: false,
      });
    }
    if (i > 0 && i % 10 === 0) {
      items.push({
        project_id: projectId, clip_id: null, type: "split_4",
        position: position++, duration: 4, script_text: null, overlay_text: null,
        metadata: { placeholder: true }, approved: false,
      });
    }
  }

  // Lower-third overlays for the first few celebrity / year / place entities
  const { data: ents } = await sb.from("project_entities")
    .select("type, value").eq("project_id", projectId)
    .in("type", ["celebrity", "year", "place"]).limit(6);
  for (const e of ents ?? []) {
    items.push({
      project_id: projectId, clip_id: null, type: "lower_third",
      position: position++, duration: 3,
      script_text: null,
      overlay_text: `${e.value}`,
      metadata: { entity_type: e.type },
      approved: false,
    });
  }

  // Final transition
  items.push({
    project_id: projectId, clip_id: null, type: "transition",
    position: position++, duration: 1,
    script_text: null, overlay_text: null, metadata: {}, approved: false,
  });

  await setMediaJob(mediaJobId, { progress: 80 });
  const { error: insErr } = await sb.from("timeline_items").insert(items);
  if (insErr) throw new Error(`insert timeline_items: ${insErr.message}`);

  await setMediaJob(mediaJobId, { status: "completed", progress: 100, metadata: { items: items.length } });
  await setProjectStatus(projectId, "ready_for_review");
}
