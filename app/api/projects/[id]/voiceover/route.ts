import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { uploadBuffer } from "@/lib/storage";
import { transcribeAudio } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cap kept generous since the Gemini Files API path tolerates large files.
const MAX_BYTES = 500 * 1024 * 1024; // 500MB

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large" }, { status: 413 });
  if (!file.type.startsWith("audio/")) return NextResponse.json({ error: "must be audio/*" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "mp3";
  const dest = `projects/${id}/voiceover/${Date.now()}.${ext}`;
  const up = await uploadBuffer(buf, dest, file.type || "application/octet-stream");

  // Transcribe with Gemini. If this fails we keep the uploaded audio and
  // return an error so the user can retry without re-uploading the file.
  let transcript: string;
  try {
    transcript = await transcribeAudio(buf, file.type, file.name);
  } catch (err) {
    const message = err instanceof Error ? err.message : "transcription failed";
    return NextResponse.json(
      { error: `transcription failed: ${message}`, voiceover_url: up.publicUrl },
      { status: 502 },
    );
  }

  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("projects")
    .update({ voiceover_url: up.publicUrl, transcript })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data, voiceover_url: up.publicUrl, transcript });
}
