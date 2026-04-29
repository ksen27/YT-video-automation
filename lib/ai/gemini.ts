import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { getEnv } from "@/lib/env";

// Gemini wrapper used by the search and match processors.
// API key: https://aistudio.google.com/app/apikey  (env GEMINI_API_KEY)

function getModel() {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return genai.getGenerativeModel({ model: env.GEMINI_MODEL });
}

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

export const ExtractedEntitySchema = z.object({
  type: z.enum([
    "celebrity", "related_person", "movie", "tv_show",
    "song", "company", "place", "event", "year", "age",
  ]),
  // Gemini sometimes returns numbers for year/age despite the prompt asking for strings.
  value: z.union([z.string(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1)),
  confidence: z.number().min(0).max(1).default(0.8),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ExtractedEntity = z.infer<typeof ExtractedEntitySchema>;

const EntityListSchema = z.object({ entities: z.array(ExtractedEntitySchema) });

export async function extractEntities(transcript: string): Promise<ExtractedEntity[]> {
  if (!transcript.trim()) return [];
  const model = getModel();
  const prompt = `You are extracting structured entities from a celebrity-focused video script.
Return strict JSON ONLY in the form:
{ "entities": [ { "type": "...", "value": "...", "confidence": 0.0-1.0, "metadata": {} } ] }

Allowed types: celebrity, related_person, movie, tv_show, song, company, place, event, year, age.
- "celebrity" = the main subject(s).
- "related_person" = co-stars, family, friends, rivals.
- Years should be 4-digit strings like "1998".
- Ages should be plain numbers like "32".
- Skip duplicates. Skip generic words.
- Confidence reflects how certain you are.

SCRIPT:
"""${transcript.slice(0, 12000)}"""`;

  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });
  const txt = res.response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(txt);
  } catch {
    console.error(JSON.stringify({ msg: "extractEntities.parse_failed", raw: txt.slice(0, 500) }));
    return [];
  }
  const safe = EntityListSchema.safeParse(parsed);
  if (!safe.success) {
    console.error(JSON.stringify({
      msg: "extractEntities.schema_failed",
      raw: txt.slice(0, 500),
      issues: safe.error.flatten(),
    }));
    return [];
  }
  if (safe.data.entities.length === 0) {
    console.warn(JSON.stringify({ msg: "extractEntities.empty", raw: txt.slice(0, 500) }));
  }
  // Dedup by lowercased "type:value".
  const seen = new Set<string>();
  return safe.data.entities.filter((e) => {
    const k = `${e.type}:${e.value.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Query generation
// ---------------------------------------------------------------------------

export function buildSearchQueries(entities: ExtractedEntity[]): string[] {
  const celebs = entities.filter((e) => e.type === "celebrity").map((e) => e.value);
  const people = entities.filter((e) => e.type === "related_person").map((e) => e.value);
  const movies = entities.filter((e) => e.type === "movie").map((e) => e.value);
  const shows  = entities.filter((e) => e.type === "tv_show").map((e) => e.value);
  const events = entities.filter((e) => e.type === "event").map((e) => e.value);
  const places = entities.filter((e) => e.type === "place").map((e) => e.value);

  const queries = new Set<string>();
  const main = celebs[0];
  if (main) {
    queries.add(`${main} interview`);
    queries.add(`${main} red carpet`);
    queries.add(`${main} behind the scenes`);
  }
  for (const c of celebs) queries.add(`${c} interview`);
  for (const c of celebs) for (const m of movies) queries.add(`${c} ${m}`);
  for (const c of celebs) for (const s of shows)  queries.add(`${c} ${s}`);
  for (const c of celebs) for (const p of people) queries.add(`${c} ${p}`);
  for (const c of celebs) for (const e of events) queries.add(`${c} ${e}`);
  for (const c of celebs) for (const p of places) queries.add(`${c} ${p}`);
  if (queries.size === 0 && entities.length) queries.add(entities[0].value);
  return Array.from(queries).slice(0, 12);
}

// ---------------------------------------------------------------------------
// Clip → transcript section matching
// ---------------------------------------------------------------------------

export interface ClipForMatch {
  id: string;
  source_title: string | null;
  start_time: number;
  end_time: number;
  labels?: string[];
}
export interface SectionMatch {
  section_index: number;
  clip_id: string | null;
  reason?: string;
}

const MatchListSchema = z.object({
  matches: z.array(z.object({
    section_index: z.number().int().min(0),
    clip_id: z.string().nullable(),
    reason: z.string().optional(),
  })),
});

export async function matchClipsToSections(
  sections: string[],
  clips: ClipForMatch[]
): Promise<SectionMatch[]> {
  if (clips.length === 0 || sections.length === 0) return [];
  const model = getModel();
  const prompt = `You are picking the best B-roll clip for each section of a celebrity video script.
For each section (indexed from 0), choose ONE clip_id from the list whose source title hints at relevance, or null if no clip fits.
Return STRICT JSON in the form:
{ "matches": [ { "section_index": 0, "clip_id": "abc-...", "reason": "..." } ] }

SECTIONS:
${sections.map((s, i) => `[${i}] ${s.slice(0, 240)}`).join("\n")}

CLIPS (id — source_title — labels):
${clips.map((c) => `${c.id} — ${c.source_title ?? "?"} — ${(c.labels ?? []).join(",")}`).join("\n")}`;

  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
  });
  const txt = res.response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(txt); } catch { return []; }
  const safe = MatchListSchema.safeParse(parsed);
  if (!safe.success) return [];
  return safe.data.matches;
}
