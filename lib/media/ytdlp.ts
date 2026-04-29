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
  // Output template: <id>.<ext> — yt-dlp picks ext after merge.
  const outputTemplate = path.join(opts.outputDir, `${opts.videoId}.%(ext)s`);
  const args = [
    "-f", `bestvideo[height<=${maxH}]+bestaudio/best[height<=${maxH}]`,
    "--merge-output-format", "mp4",
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--no-part",
    "--restrict-filenames",
    "-o", outputTemplate,
    opts.url,
  ];

  await runYtDlp(env.YTDLP_PATH, args, opts.signal, opts.onLog);

  // After successful run, look for the produced file.
  const expected = path.join(opts.outputDir, `${opts.videoId}.mp4`);
  try { await fs.access(expected); return { outputPath: expected }; } catch { /* fall through */ }

  // Fallback: scan dir for any file starting with videoId
  const entries = await fs.readdir(opts.outputDir);
  const found = entries.find((f) => f.startsWith(opts.videoId));
  if (!found) throw new Error(`yt-dlp finished but no output file found for ${opts.videoId}`);
  return { outputPath: path.join(opts.outputDir, found) };
}

function runYtDlp(
  bin: string,
  args: string[],
  signal: AbortSignal | undefined,
  onLog?: (line: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", (chunk) => { onLog?.(chunk.toString()); });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      onLog?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(-2000)}`));
    });
    signal?.addEventListener("abort", () => child.kill("SIGKILL"));
  });
}
