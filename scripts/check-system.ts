/* eslint-disable no-console */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

import { spawn } from "node:child_process";
import { getEnv } from "../lib/env";
import { newRedisClient } from "../lib/jobs/queue";

interface Check { name: string; ok: boolean; detail?: string; }

function which(bin: string, args: string[] = ["--version"]): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { out += c.toString(); });
    child.on("error", (err) => resolve({ ok: false, detail: err.message }));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, detail: out.split("\n")[0]?.trim().slice(0, 120) });
      } else {
        resolve({ ok: false, detail: `${bin} exited ${code}` });
      }
    });
  });
}

async function main() {
  const env = getEnv();
  const checks: Check[] = [];

  const ff = await which(env.FFMPEG_PATH, ["-version"]);
  checks.push({ name: "ffmpeg", ok: ff.ok, detail: ff.detail });
  const fp = await which(env.FFPROBE_PATH, ["-version"]);
  checks.push({ name: "ffprobe", ok: fp.ok, detail: fp.detail });
  const yt = await which(env.YTDLP_PATH);
  checks.push({ name: "yt-dlp", ok: yt.ok, detail: yt.detail });

  // Redis
  let redisOk = false; let redisDetail = "";
  try {
    const c = newRedisClient();
    redisDetail = (await c.ping()) || "";
    redisOk = redisDetail === "PONG";
    await c.quit();
  } catch (e) { redisDetail = (e as Error).message; }
  checks.push({ name: "redis", ok: redisOk, detail: redisDetail });

  checks.push({
    name: "Supabase env",
    ok: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
    detail: env.NEXT_PUBLIC_SUPABASE_URL ?? "(missing url)",
  });
  checks.push({
    name: "Gemini env",
    ok: Boolean(env.GEMINI_API_KEY),
  });
  checks.push({
    name: "YouTube env",
    ok: Boolean(env.YOUTUBE_API_KEY),
  });

  let exitCode = 0;
  for (const c of checks) {
    if (!c.ok) exitCode = 1;
    console.log(`${c.ok ? "✓" : "✗"}  ${c.name.padEnd(16)} ${c.detail ?? ""}`);
  }
  if (exitCode !== 0) {
    console.log("\nSome checks failed. See README.md for setup.");
  }
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(2); });
