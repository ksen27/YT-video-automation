import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getEnv } from "@/lib/env";

// All FFmpeg invocations use spawn with an argument array — no shell strings.
// This is critical when input filenames are derived from external IDs/URLs.

export interface CutClipOptions {
  inputPath: string;
  outputPath: string;
  startSeconds: number;
  durationSeconds: number;
  signal?: AbortSignal;
}

export async function cutClip(opts: CutClipOptions): Promise<void> {
  const env = getEnv();
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });

  // -ss before -i is fastest (input-side seek). We re-encode to ensure clean
  // GOP boundaries and consistent codec across clips for the final render.
  const args = [
    "-y",
    "-ss", String(opts.startSeconds),
    "-i", opts.inputPath,
    "-t", String(opts.durationSeconds),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    opts.outputPath,
  ];
  await runFFmpeg(env.FFMPEG_PATH, args, opts.signal);
}

export interface ThumbnailOptions {
  inputPath: string;
  outputPath: string;
  atSeconds: number;
  signal?: AbortSignal;
}

export async function generateThumbnail(opts: ThumbnailOptions): Promise<void> {
  const env = getEnv();
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  const args = [
    "-y",
    "-ss", String(opts.atSeconds),
    "-i", opts.inputPath,
    "-frames:v", "1",
    "-vf", "scale=480:-2",
    "-q:v", "3",
    opts.outputPath,
  ];
  await runFFmpeg(env.FFMPEG_PATH, args, opts.signal);
}

export interface NormalizeOptions {
  inputPath: string;
  outputPath: string;
  width?: number;     // default 1280
  height?: number;    // default 720
  fps?: number;       // default 30
  signal?: AbortSignal;
}

export async function normalizeClip(opts: NormalizeOptions): Promise<void> {
  const env = getEnv();
  const w = opts.width ?? 1280;
  const h = opts.height ?? 720;
  const fps = opts.fps ?? 30;
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
  const args = [
    "-y",
    "-i", opts.inputPath,
    "-vf",
    `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:-1:-1:color=black,fps=${fps},setsar=1`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    opts.outputPath,
  ];
  await runFFmpeg(env.FFMPEG_PATH, args, opts.signal);
}

export interface ConcatOptions {
  inputPaths: string[]; // already-normalized clips, same codec/res/fps
  outputPath: string;
  voiceoverPath?: string;     // optional audio overlay
  voiceoverGain?: number;     // 0..1
  bgMusicPath?: string;       // optional background bed
  bgMusicGain?: number;       // 0..1, default 0.15
  signal?: AbortSignal;
}

export async function concatNormalizedClips(opts: ConcatOptions): Promise<void> {
  const env = getEnv();
  if (opts.inputPaths.length === 0) throw new Error("concat: no inputs");
  await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });

  const listPath = `${opts.outputPath}.concat.txt`;
  const listBody = opts.inputPaths
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await fs.writeFile(listPath, listBody, "utf8");

  // We re-encode during concat to dodge the strict-codec requirements of -c copy.
  const args: string[] = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
  ];

  let audioMap: string[] = [];
  if (opts.voiceoverPath) {
    args.push("-i", opts.voiceoverPath);
    if (opts.bgMusicPath) {
      args.push("-i", opts.bgMusicPath);
      // input 0 = video+audio, 1 = voiceover, 2 = bg
      args.push(
        "-filter_complex",
        `[1:a]volume=${opts.voiceoverGain ?? 1.0}[vo];` +
        `[2:a]volume=${opts.bgMusicGain ?? 0.15}[bg];` +
        `[vo][bg]amix=inputs=2:duration=longest:dropout_transition=0[aout]`
      );
      audioMap = ["-map", "0:v:0", "-map", "[aout]"];
    } else {
      audioMap = ["-map", "0:v:0", "-map", "1:a:0"];
    }
  } else if (opts.bgMusicPath) {
    args.push("-i", opts.bgMusicPath);
    args.push(
      "-filter_complex",
      `[0:a]volume=1.0[base];` +
      `[1:a]volume=${opts.bgMusicGain ?? 0.15}[bg];` +
      `[base][bg]amix=inputs=2:duration=shortest:dropout_transition=0[aout]`
    );
    audioMap = ["-map", "0:v:0", "-map", "[aout]"];
  } else {
    audioMap = ["-map", "0:v:0", "-map", "0:a?"];
  }

  args.push(
    ...audioMap,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "22",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    opts.outputPath,
  );

  try {
    await runFFmpeg(env.FFMPEG_PATH, args, opts.signal);
  } finally {
    try { await fs.unlink(listPath); } catch { /* ignore */ }
  }
}

function runFFmpeg(
  bin: string,
  args: string[],
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
    signal?.addEventListener("abort", () => child.kill("SIGKILL"));
  });
}
