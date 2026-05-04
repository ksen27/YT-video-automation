import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getEnv } from "@/lib/env";

// We always use spawn with an argument array (never shell strings) to prevent
// command injection from upstream values like YouTube IDs or URLs.

export interface YtDlpDownloadResult {
  outputPath: string;
}

export interface YtDlpRunOptions {
  url: string;
  outputDir: string;
  videoId: string;
  maxHeight?: number; // default 720
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

export async function downloadYoutubeVideo(opts: YtDlpRunOptions): Promise<YtDlpDownloadResult> {
  const env = getEnv();
  const maxH = opts.maxHeight ?? 720;
  await fs.mkdir(opts.outputDir, { recursive: true });
  // Output template: <id>.<ext> — yt-dlp picks ext after format selection.
  const outputTemplate = path.join(opts.outputDir, `${opts.videoId}.%(ext)s`);
  // Video-only: the final render uses the project's voiceover; source audio is
  // never used. Skipping audio dramatically reduces failure rate (no separate
  // audio fetch, no ffmpeg merge step) and shrinks the on-disk cache.
  const args = [
    "-f", `bestvideo[height<=${maxH}]/best[height<=${maxH}]/bestvideo/best`,
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--no-part",
    "--restrict-filenames",
    "--socket-timeout", "30",
    "--retries", "2",
    "--fragment-retries", "2",
    // YouTube now requires a JS runtime + remote signature solver to deobfuscate
    // download URLs; without these, formats list but downloads fail with a
    // misleading "video not available" error.
    "--js-runtimes", "node",
    "--remote-components", "ejs:github",
    "-o", outputTemplate,
    opts.url,
  ];

  await runYtDlp(env.YTDLP_PATH, args, env.YTDLP_TIMEOUT_SECONDS, opts.signal, opts.onLog);

  // After successful run, look for the produced file. With video-only formats
  // the extension can vary (mp4, webm, mkv) — scan the dir.
  const entries = await fs.readdir(opts.outputDir);
  const found = entries.find((f) => f.startsWith(opts.videoId));
  if (!found) throw new Error(`yt-dlp finished but no output file found for ${opts.videoId}`);
  return { outputPath: path.join(opts.outputDir, found) };
}

function runYtDlp(
  bin: string,
  args: string[],
  timeoutSeconds: number,
  signal: AbortSignal | undefined,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutSeconds * 1000);

    child.stdout.on("data", (chunk) => { onLog?.(chunk.toString()); });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      onLog?.(s);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`yt-dlp timed out after ${timeoutSeconds}s`));
      else if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-2000)}`));
    });
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      child.kill("SIGKILL");
    });
  });
}
