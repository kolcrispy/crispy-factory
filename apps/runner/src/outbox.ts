import { flushOutbox, HIGH_WATER, httpSend, localFs, stateDir, type Send } from "@factory/core/outbox";
import { config } from "./config";

export const outboxClient: { send: Send } = {
  send: (events, timeoutMs) => httpSend(config.ingestUrl, config.secret)(events, timeoutMs),
};

/** Failed delivery leaves durable reports in place and must not stop runner reconciliation. */
export async function flushLocalOutbox() {
  try {
    const result = await flushOutbox(localFs, stateDir(), outboxClient.send, { budgetMs: 30_000 });
    const summary = { delivered: result.delivered, left: result.left, rejected: result.rejected, stuck: result.stuck, error: result.error };
    if (result.error || result.left > HIGH_WATER) console.error(JSON.stringify({ event: "outbox:backlog", ...summary }));
    return summary;
  } catch (error) {
    console.error(JSON.stringify({ event: "outbox:failed", error: error instanceof Error ? error.message : String(error) }));
    return undefined;
  }
}
