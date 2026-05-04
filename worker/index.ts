/* eslint-disable no-console */
// Standalone BullMQ worker process. Run with `pnpm worker` (or `npm run worker`).
// Uses tsx for TS execution. Loads env from .env files via dotenv if present.

// Load env from .env.local first (Next.js convention), then fall back to .env.
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv();

import { Worker } from "bullmq";
import { QUEUE_NAMES, getRedisConnection } from "@/lib/jobs/queue";
import { getEnv } from "@/lib/env";

import { processSearchJob }   from "./processors/searchProcessor";
import { processDownloadJob } from "./processors/downloadProcessor";
import { processClipJob }     from "./processors/clipProcessor";
import { processMatchJob }    from "./processors/matchProcessor";
import { processRenderJob }   from "./processors/renderProcessor";

const env = getEnv();
const concurrency = env.WORKER_CONCURRENCY;
const downloadConcurrency = env.DOWNLOAD_CONCURRENCY;

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  msg: "worker.starting",
  concurrency,
  downloadConcurrency,
}));

const workers: Worker[] = [];

export interface JobAttemptInfo {
  attemptsMade: number;     // 1-indexed for the current run
  attemptsAllowed: number;  // total attempts BullMQ will make
}

function startWorker<T>(
  name: string,
  handler: (data: T, attempt: JobAttemptInfo) => Promise<void>,
  c: number
): Worker {
  const w = new Worker<T>(name, async (job) => {
    const t0 = Date.now();
    const attempt: JobAttemptInfo = {
      attemptsMade: (job.attemptsMade ?? 0) + 1,
      attemptsAllowed: job.opts?.attempts ?? 1,
    };
    console.log(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job.id, msg: "job.start", attempt, data: job.data }));
    try {
      await handler(job.data, attempt);
      console.log(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job.id, msg: "job.done", ms: Date.now() - t0 }));
    } catch (e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job.id, msg: "job.failed", attempt, err: (e as Error).message, ms: Date.now() - t0 }));
      throw e;
    }
  }, {
    connection: getRedisConnection(),
    concurrency: c,
  });

  w.on("error", (err) => console.error(JSON.stringify({ ts: new Date().toISOString(), queue: name, msg: "worker.error", err: err.message })));
  w.on("failed", (job, err) => console.error(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job?.id, msg: "job.failed.event", err: err.message })));
  return w;
}

workers.push(startWorker(QUEUE_NAMES.search,   processSearchJob,   1));
workers.push(startWorker(QUEUE_NAMES.download, processDownloadJob, downloadConcurrency));
workers.push(startWorker(QUEUE_NAMES.clip,     processClipJob,     concurrency));
workers.push(startWorker(QUEUE_NAMES.match,    processMatchJob,    1));
workers.push(startWorker(QUEUE_NAMES.render,   processRenderJob,   1));

async function shutdown(signal: string) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "worker.shutdown", signal }));
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on("SIGINT",  () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
