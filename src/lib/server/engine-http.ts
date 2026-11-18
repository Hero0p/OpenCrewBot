// Turns the expected errors of the engine (PlanError) and the scheduler (WorkflowError)
// into a 400 with their message, for the API routes.
import { PlanError } from "./engine";
import { WorkflowError } from "./scheduler";
import { InputError } from "./errors";

/** Run an engine or scheduler call; a PlanError or WorkflowError becomes an InputError (HTTP 400) with the same message. */
export async function engineCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PlanError || error instanceof WorkflowError) throw new InputError(error.message);
    throw error;
  }
}
