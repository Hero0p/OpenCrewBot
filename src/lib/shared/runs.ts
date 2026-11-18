// Rules about team runs that both the server (engine.ts) and the Tasks and runs panel need.
import type { Run, Task } from "./types";

/**
 * Can this task be run again? Any failed or cancelled task while the plan runs; after the plan
 * has failed, only its final write-up (every other task's result is still there to consolidate).
 * A cancelled plan stays cancelled: that was the person's decision.
 */
export function canRetry(run: Pick<Run, "status">, task: Pick<Task, "status" | "isFinal">): boolean {
  if (run.status === "running") return task.status === "failed" || task.status === "cancelled";
  return run.status === "failed" && task.isFinal && task.status === "failed";
}
