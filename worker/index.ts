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

console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "worker.starting", concurrency }));

const workers: Worker[] = [];

function startWorker<T>(
  name: string,
  handler: (data: T) => Promise<void>,
  c: number
): Worker {
  const w = new Worker<T>(name, async (job) => {
    const t0 = Date.now();
    console.log(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job.id, msg: "job.start", data: job.data }));
    try {
      await handler(job.data);
      console.log(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job.id, msg: "job.done", ms: Date.now() - t0 }));
    } catch (e) {
      console.error(JSON.stringify({ ts: new Date().toISOString(), queue: name, jobId: job.id, msg: "job.failed", err: (e as Error).message, ms: Date.now() - t0 }));
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
workers.push(startWorker(QUEUE_NAMES.download, processDownloadJob, Math.max(1, Math.min(concurrency, 2))));
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
