import { spawn } from "node:child_process";
import { getEnv } from "@/lib/env";

export interface ProbeResult {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  raw: unknown;
}

export async function probeFile(localPath: string): Promise<ProbeResult> {
  const env = getEnv();
  const args = [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    localPath,
  ];
  const out = await runFFprobe(env.FFPROBE_PATH, args);
  let parsed: any;
  try { parsed = JSON.parse(out); } catch (e) {
    throw new Error(`ffprobe returned invalid JSON: ${(e as Error).message}`);
  }
  const streams: any[] = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const dur = parseFloat(parsed.format?.duration ?? video?.duration ?? "0");
  return {
    durationSeconds: Number.isFinite(dur) ? dur : 0,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: Boolean(audio),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    raw: parsed,
  };
}

function runFFprobe(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}
