// Mastra passes a request context to processors, tools and dynamic instructions.
// The AgentController puts its session details there under "controller", and
// runtime.ts creates every session with `scope` set to the conversation id
// ("dm:<botId>", "room:<roomId>" or "task:<taskId>"). This reads it back, so code
// that runs inside a turn knows which conversation it belongs to.

/** Anything with a `get(key)` method, like Mastra's RequestContext. */
interface ContextLike {
  get(key: string): unknown;
}

/**
 * @param requestContext - the context Mastra passed in (may be missing)
 * @returns the conversation id of the turn, or undefined when it isn't known
 */
export function conversationIdOf(requestContext: ContextLike | undefined): string | undefined {
  const controller = requestContext?.get("controller");
  if (typeof controller !== "object" || controller === null || !("scope" in controller)) return undefined;
  return typeof controller.scope === "string" ? controller.scope : undefined;
}
