/**
 * Resident EvalJob worker (docs/PLAN.md 架构评审调整 #1): drains the queue
 * with processAll(), then polls for new PENDING jobs. Run with:
 *
 *   pnpm eval:worker
 *
 * The serverless alternative is POST /api/internal/eval-worker.
 */

import "./load-env";

import { processAll } from "~/server/eval/worker";

const IDLE_INTERVAL_MS = Number(process.env.EVAL_WORKER_INTERVAL_MS ?? 2_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`[eval-worker] started, idle poll every ${IDLE_INTERVAL_MS}ms`);
  for (;;) {
    try {
      const stats = await processAll();
      if (stats.processed > 0) {
        console.log(
          `[eval-worker] processed=${stats.processed} done=${stats.done} retried=${stats.retried} failed=${stats.failed}`,
        );
        continue; // drain without sleeping while work remains
      }
    } catch (error) {
      console.error("[eval-worker] tick failed", error);
    }
    await sleep(IDLE_INTERVAL_MS);
  }
}

void main();
