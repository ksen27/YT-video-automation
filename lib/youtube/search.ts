import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";

// YouTube Data API v3 wrapper.
// Quota: each search.list call is ~100 units; videos.list is 1.
// API key: enable "YouTube Data API v3" at https://console.cloud.google.com/apis

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

export interface YoutubeCandidate {
  videoId: string;
  url: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  durationSeconds: number;
  isLive: boolean;
  privacyStatus: string;
}

export interface SearchInput {
  query: string;
  maxResults?: number;
  relevanceLanguage?: string;
}

const SearchItemSchema = z.object({
  id: z.object({
    kind: z.string(),
    videoId: z.string().optional(),
  }),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional().default(""),
    channelId: z.string(),
    channelTitle: z.string(),
    liveBroadcastContent: z.string().optional(),
  }),
});

const VideoItemSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    description: z.string().optional().default(""),
    channelId: z.string(),
    channelTitle: z.string(),
    liveBroadcastContent: z.string().optional(),
  }),
  contentDetails: z.object({
    duration: z.string(),
  }),
  status: z.object({
    privacyStatus: z.string().optional(),
  }).optional(),
});

export async function searchYoutube(input: SearchInput): Promise<YoutubeCandidate[]> {
  const env = getEnv();
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not configured");

  const params = new URLSearchParams({
    part: "snippet",
    q: input.query,
    type: "video",
    maxResults: String(input.maxResults ?? 15),
    relevanceLanguage: input.relevanceLanguage ?? "en",
    safeSearch: "moderate",
    videoEmbeddable: "true",
    key: env.YOUTUBE_API_KEY,
  });

  const r = await fetch(`${SEARCH_URL}?${params}`);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`YouTube search failed: ${r.status} ${txt.slice(0, 300)}`);
  }
  const json = await r.json();
  const ids: string[] = [];
  for (const raw of json.items ?? []) {
    const safe = SearchItemSchema.safeParse(raw);
    if (!safe.success) continue;
    if (safe.data.id.kind !== "youtube#video" || !safe.data.id.videoId) continue;
    ids.push(safe.data.id.videoId);
  }
  if (!ids.length) return [];

  // Hydrate with full duration / privacy info
  const vparams = new URLSearchParams({
    part: "snippet,contentDetails,status",
    id: ids.join(","),
    key: env.YOUTUBE_API_KEY,
  });
  const vr = await fetch(`${VIDEOS_URL}?${vparams}`);
  if (!vr.ok) {
    const txt = await vr.text().catch(() => "");
    throw new Error(`YouTube videos.list failed: ${vr.status} ${txt.slice(0, 300)}`);
  }
  const vjson = await vr.json();
  const out: YoutubeCandidate[] = [];
  for (const raw of vjson.items ?? []) {
    const safe = VideoItemSchema.safeParse(raw);
    if (!safe.success) continue;
    out.push({
      videoId: safe.data.id,
      url: `https://www.youtube.com/watch?v=${safe.data.id}`,
      title: safe.data.snippet.title,
      description: safe.data.snippet.description ?? "",
      channelId: safe.data.snippet.channelId,
      channelTitle: safe.data.snippet.channelTitle,
      durationSeconds: parseISO8601Duration(safe.data.contentDetails.duration),
      isLive: safe.data.snippet.liveBroadcastContent === "live"
            || safe.data.snippet.liveBroadcastContent === "upcoming",
      privacyStatus: safe.data.status?.privacyStatus ?? "public",
    });
  }
  return out;
}

export function parseISO8601Duration(iso: string): number {
  // Examples: PT4M30S, PT1H, PT45S
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  const s = parseInt(m[3] ?? "0", 10);
  return h * 3600 + min * 60 + s;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankInput {
  candidate: YoutubeCandidate;
  mainCelebrity?: string;
  keywords: string[];
  approvedChannelIds: Set<string>;
  blockedChannelIds: Set<string>;
}

export interface RankedCandidate extends YoutubeCandidate {
  score: number;
  reasons: string[];
  rejected: boolean;
  rejectReason?: string;
}

const MIN_DURATION = 120;     // 2 minutes
const MAX_DURATION = 1500;    // 25 minutes

export function rankCandidate(input: RankInput): RankedCandidate {
  const c = input.candidate;
  const reasons: string[] = [];

  if (input.blockedChannelIds.has(c.channelId)) {
    return { ...c, score: 0, reasons: [], rejected: true, rejectReason: "blocked channel" };
  }
  if (c.isLive) return { ...c, score: 0, reasons: [], rejected: true, rejectReason: "live broadcast" };
  if (c.privacyStatus !== "public") {
    return { ...c, score: 0, reasons: [], rejected: true, rejectReason: `privacy=${c.privacyStatus}` };
  }
  if (c.durationSeconds < MIN_DURATION) {
    return { ...c, score: 0, reasons: [], rejected: true, rejectReason: "too short" };
  }
  if (c.durationSeconds > MAX_DURATION) {
    return { ...c, score: 0, reasons: [], rejected: true, rejectReason: "too long" };
  }

  let score = 0;
  const titleLower = c.title.toLowerCase();
  const descLower = c.description.toLowerCase();

  if (input.mainCelebrity && titleLower.includes(input.mainCelebrity.toLowerCase())) {
    score += 40;
    reasons.push("title contains main celebrity");
  }
  let kwHits = 0;
  for (const kw of input.keywords) {
    const kwLower = kw.toLowerCase();
    if (titleLower.includes(kwLower)) { kwHits += 2; reasons.push(`title:${kw}`); }
    else if (descLower.includes(kwLower)) { kwHits += 1; reasons.push(`desc:${kw}`); }
  }
  score += Math.min(kwHits * 5, 30);

  if (input.approvedChannelIds.has(c.channelId)) {
    score += 25;
    reasons.push("approved channel");
  }

  // Sweet spot: 4–15 minutes
  if (c.durationSeconds >= 240 && c.durationSeconds <= 900) {
    score += 10;
    reasons.push("sweet-spot duration");
  }

  // Penalize obvious junk
  for (const bad of ["#shorts", "compilation", "funniest moments", "tier list"]) {
    if (titleLower.includes(bad)) { score -= 10; reasons.push(`-junk:${bad}`); }
  }

  return { ...c, score, reasons, rejected: false };
}

export async function loadChannelRules(): Promise<{ approved: Set<string>; blocked: Set<string> }> {
  const sb = getServerSupabase();
  const { data, error } = await sb.from("channel_rules").select("channel_id, rule");
  if (error) throw new Error(`Channel rules: ${error.message}`);
  const approved = new Set<string>();
  const blocked = new Set<string>();
  for (const r of data ?? []) {
    if (!r.channel_id) continue;
    if (r.rule === "approved") approved.add(r.channel_id);
    else if (r.rule === "blocked") blocked.add(r.channel_id);
  }
  return { approved, blocked };
}
