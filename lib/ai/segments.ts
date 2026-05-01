import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { getEnv } from "@/lib/env";

// Segment-aware analysis used by the "Analyze & Search" UX.
// We split a transcript into ~5-minute spoken chunks, then ask Gemini for a
// human-readable understanding of each segment plus search intents.

const WORDS_PER_MINUTE = 150;          // typical narration cadence
const TARGET_SEGMENT_MINUTES = 5;
const MIN_SEGMENT_WORDS = 250;          // don't split tiny scripts at all

function getModel() {
  const env = getEnv();
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
  const genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return genai.getGenerativeModel({ model: env.GEMINI_MODEL });
}

export interface RawSegment {
  index: number;
  text: string;
  wordCount: number;
  startSeconds: number;
  endSeconds: number;
}

export function estimateDurationSeconds(transcript: string): number {
  const words = countWords(transcript);
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function splitTranscriptIntoSegments(transcript: string): RawSegment[] {
  const cleaned = transcript.trim();
  if (!cleaned) return [];
  const totalWords = countWords(cleaned);
  if (totalWords < MIN_SEGMENT_WORDS) {
    return [{
      index: 0,
      text: cleaned,
      wordCount: totalWords,
      startSeconds: 0,
      endSeconds: Math.round((totalWords / WORDS_PER_MINUTE) * 60),
    }];
  }

  const targetWords = TARGET_SEGMENT_MINUTES * WORDS_PER_MINUTE;     // ~750
  const segmentCount = Math.max(1, Math.round(totalWords / targetWords));
  const wordsPerSegment = Math.ceil(totalWords / segmentCount);

  // Prefer sentence boundaries — split on terminal punctuation followed by
  // whitespace, but keep the punctuation attached to the preceding sentence.
  const sentences = cleaned.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [cleaned];

  const out: RawSegment[] = [];
  let buffer: string[] = [];
  let bufferWords = 0;
  let cursorWords = 0;

  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const w = countWords(s);
    buffer.push(s);
    bufferWords += w;
    if (bufferWords >= wordsPerSegment && out.length < segmentCount - 1) {
      out.push(buildSegment(out.length, buffer.join(" "), cursorWords, bufferWords));
      cursorWords += bufferWords;
      buffer = [];
      bufferWords = 0;
    }
  }
  if (buffer.length) {
    out.push(buildSegment(out.length, buffer.join(" "), cursorWords, bufferWords));
  }
  return out;
}

function buildSegment(index: number, text: string, priorWords: number, words: number): RawSegment {
  const startSeconds = Math.round((priorWords / WORDS_PER_MINUTE) * 60);
  const endSeconds = Math.round(((priorWords + words) / WORDS_PER_MINUTE) * 60);
  return { index, text, wordCount: words, startSeconds, endSeconds };
}

// ---------------------------------------------------------------------------
// Per-segment understanding
// ---------------------------------------------------------------------------

export const SegmentUnderstandingSchema = z.object({
  mainTopic: z.string().min(1),
  people: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  events: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  relatedKeywords: z.array(z.string()).default([]),
  searchIntents: z.array(z.object({
    label: z.string().min(1),       // human-friendly: "Searching for early life interviews"
    query: z.string().min(1),       // raw query passed to YouTube
  })).min(1).max(6),
});
export type SegmentUnderstanding = z.infer<typeof SegmentUnderstandingSchema>;

export async function analyzeSegment(segment: RawSegment): Promise<SegmentUnderstanding> {
  const model = getModel();
  const prompt = `You are helping a video editor understand one section of a celebrity-focused voiceover.
Return STRICT JSON ONLY in this shape:
{
  "mainTopic": "short phrase, e.g. 'Margot Robbie's early career'",
  "people": ["person names mentioned"],
  "places": ["cities, countries, venues"],
  "events": ["awards, premieres, news moments"],
  "topics": ["broader themes like 'method acting', 'family life'"],
  "relatedKeywords": ["3-8 short phrases a viewer would say to describe the visuals"],
  "searchIntents": [
    { "label": "human-friendly description of what we are searching for",
      "query": "concrete YouTube search query, no quotes, max 8 words" }
  ]
}

Rules:
- Use plain language in "label" — like "Looking for award show clips", not "youtube.com search 'Oscars'".
- Provide 2 to 4 searchIntents that together cover the visual story of THIS section.
- Skip the section's narration tone and writing style. Focus on what should appear on screen.
- Skip duplicates. Skip empty arrays — return [] if you have nothing.

SECTION (~${TARGET_SEGMENT_MINUTES} minutes, words ${segment.wordCount}):
"""${segment.text.slice(0, 8000)}"""`;

  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.3 },
  });
  const txt = res.response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(txt); } catch {
    return fallbackUnderstanding(segment);
  }
  const safe = SegmentUnderstandingSchema.safeParse(parsed);
  if (!safe.success) {
    console.error(JSON.stringify({
      msg: "analyzeSegment.schema_failed",
      raw: txt.slice(0, 400),
      issues: safe.error.flatten(),
    }));
    return fallbackUnderstanding(segment);
  }
  return safe.data;
}

function fallbackUnderstanding(segment: RawSegment): SegmentUnderstanding {
  const firstSentence = segment.text.split(/[.!?]/, 1)[0]?.slice(0, 80) ?? "Section";
  return {
    mainTopic: firstSentence || `Part ${segment.index + 1}`,
    people: [], places: [], events: [], topics: [],
    relatedKeywords: [],
    searchIntents: [{ label: "Looking for relevant background footage", query: firstSentence }],
  };
}
