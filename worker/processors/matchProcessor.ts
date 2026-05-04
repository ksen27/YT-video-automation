import type { MatchJobData } from "@/lib/jobs/queue";
import { logJob, setMediaJob, setProjectStatus } from "@/lib/jobs/db";
import { getServerSupabase } from "@/lib/supabase/server";
import { matchClipsToSections, type ClipForMatch } from "@/lib/ai/gemini";
import {
  buildBlockSequence,
  planTimeline,
  pickDuration,
  sumDurations,
  type PlannedBlock,
} from "@/lib/ai/timeline-plan";
import { estimateDurationSeconds } from "@/lib/ai/segments";

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

  const { data: project } = await sb
    .from("projects")
    .select("transcript, voiceover_duration_seconds")
    .eq("id", projectId)
    .single();
  const transcript = project?.transcript ?? "";
  const sections = splitTranscript(transcript);

  // Voiceover duration drives the whole plan. Prefer the probed audio length;
  // fall back to a word-count estimate if the audio wasn't probed.
  const voiceoverSeconds =
    Number(project?.voiceover_duration_seconds) ||
    estimateDurationSeconds(transcript) ||
    0;

  if (voiceoverSeconds <= 0) {
    await setMediaJob(mediaJobId, {
      status: "failed",
      progress: 100,
      error: "voiceover duration unknown — re-upload the voiceover or paste a transcript",
    });
    await setProjectStatus(projectId, "failed");
    throw new Error("voiceover duration unknown");
  }

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
  await setMediaJob(mediaJobId, { progress: 40 });

  // Build a plan + block sequence sized to the voiceover.
  const plan = planTimeline(voiceoverSeconds);
  const blocks = buildBlockSequence(plan);

  await logJob({ projectId, jobId: mediaJobId }, "match.plan", {
    voiceoverSeconds,
    avgBlockSeconds: plan.avgBlockSeconds,
    totalBlocks: plan.totalBlocks,
    footageBlocks: plan.footageBlocks,
    imageBlocks: plan.imageBlocks,
    bucket: plan.bucket,
    plannedDurationSum: Math.round(sumDurations(blocks) * 10) / 10,
  });

  // ---- Clip assignment (each clip used at most once) ---------------------
  // Order Gemini's matches by section index so earlier sections (where the
  // first clip choice tends to be the strongest) get priority.
  const matchOrder = [...matches]
    .filter((m) => !!m.clip_id)
    .sort((a, b) => a.section_index - b.section_index)
    .map((m) => m.clip_id as string);

  // Followed by any clips Gemini didn't reference — keeps us from running
  // out when the model returns fewer matches than blocks.
  const unmatchedClipIds = clips
    .map((c) => c.id as string)
    .filter((id) => !matchOrder.includes(id));

  const clipQueue: string[] = [...new Set([...matchOrder, ...unmatchedClipIds])];
  const usedClipIds = new Set<string>();

  // If there are far fewer clips than footage slots, downgrade the surplus
  // footage blocks to image blocks (with longer durations) — per spec, prefer
  // more image blocks over duplicating clips.
  const footageBlockIdxs: number[] = blocks
    .map((b, i) => (b.type === "footage" || b.type === "intro" ? i : -1))
    .filter((i) => i >= 0);
  const surplus = footageBlockIdxs.length - clipQueue.length;
  if (surplus > 0) {
    // Convert the LAST `surplus` footage blocks into image blocks. We leave
    // the intro alone so the video still opens with motion when possible.
    const convertibles = footageBlockIdxs.filter((i) => blocks[i].type !== "intro");
    const toConvert = convertibles.slice(-surplus);
    for (const idx of toConvert) {
      const newDur = pickDuration("image");
      blocks[idx] = { type: "image", duration: newDur };
    }
  }

  // Wipe old draft for this project (so re-runs work).
  await sb.from("timeline_items").delete().eq("project_id", projectId);

  // ---- Build timeline_items rows ----------------------------------------
  const items: Array<Record<string, unknown>> = [];
  let position = 0;
  let sectionCursor = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block: PlannedBlock = blocks[i];

    if (block.type === "intro") {
      const introClipId = clipQueue.shift();
      if (introClipId) usedClipIds.add(introClipId);
      items.push({
        project_id: projectId,
        clip_id: introClipId ?? null,
        type: "intro",
        position: position++,
        duration: block.duration,
        script_text: sections[0] ?? null,
        overlay_text: null,
        metadata: { planned: true },
        approved: false,
      });
      continue;
    }

    if (block.type === "footage") {
      // Pull the next unused clip from the queue.
      let clipId: string | null = null;
      while (clipQueue.length) {
        const candidate = clipQueue.shift()!;
        if (!usedClipIds.has(candidate)) {
          clipId = candidate;
          usedClipIds.add(candidate);
          break;
        }
      }
      if (!clipId) {
        // Ran out — degrade to an image placeholder rather than duplicating.
        items.push({
          project_id: projectId,
          clip_id: null,
          type: "image",
          position: position++,
          duration: pickDuration("image"),
          script_text: sections[sectionCursor] ?? null,
          overlay_text: null,
          metadata: { placeholder: true, planned: true, downgraded_from: "footage" },
          approved: false,
        });
      } else {
        items.push({
          project_id: projectId,
          clip_id: clipId,
          type: "footage",
          position: position++,
          duration: block.duration,
          script_text: sections[sectionCursor] ?? null,
          overlay_text: null,
          metadata: { planned: true },
          approved: false,
        });
      }
      sectionCursor = Math.min(sections.length - 1, sectionCursor + 1);
      continue;
    }

    // Image / split blocks — placeholders, no clip.
    items.push({
      project_id: projectId,
      clip_id: null,
      type: block.type,
      position: position++,
      duration: block.duration,
      script_text: sections[sectionCursor] ?? null,
      overlay_text: null,
      metadata: { placeholder: true, planned: true },
      approved: false,
    });
    sectionCursor = Math.min(sections.length - 1, sectionCursor + 1);
  }

  // Lower-third overlays for the first few celebrity / year / place entities.
  // These don't consume timeline duration in the renderer (they're overlays),
  // so we keep them outside the planned-block sum.
  const { data: ents } = await sb.from("project_entities")
    .select("type, value").eq("project_id", projectId)
    .in("type", ["celebrity", "year", "place"]).limit(6);
  for (const e of ents ?? []) {
    items.push({
      project_id: projectId, clip_id: null, type: "lower_third",
      position: position++, duration: 3,
      script_text: null,
      overlay_text: `${e.value}`,
      metadata: { entity_type: e.type, overlay: true },
      approved: false,
    });
  }

  await setMediaJob(mediaJobId, { progress: 80 });
  const { error: insErr } = await sb.from("timeline_items").insert(items);
  if (insErr) throw new Error(`insert timeline_items: ${insErr.message}`);

  const plannedSum = Math.round(sumDurations(blocks) * 10) / 10;
  await setMediaJob(mediaJobId, {
    status: "completed",
    progress: 100,
    metadata: {
      items: items.length,
      voiceoverSeconds,
      avgBlockSeconds: plan.avgBlockSeconds,
      totalBlocks: plan.totalBlocks,
      footageBlocks: plan.footageBlocks,
      imageBlocks: plan.imageBlocks,
      bucket: plan.bucket,
      plannedDurationSum: plannedSum,
      uniqueClipsUsed: usedClipIds.size,
    },
  });
  await setProjectStatus(projectId, "ready_for_review");
}
