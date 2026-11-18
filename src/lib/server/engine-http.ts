// Turns the engine's PlanError into a 400 with its message, for the API routes.
import { PlanError } from "./engine";
import { InputError } from "./errors";

/** Run an engine call; a PlanError becomes an InputError (HTTP 400) with the same message. */
export async function engineCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PlanError) throw new InputError(error.message);
    throw error;
  }
}
