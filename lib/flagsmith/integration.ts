// "Is the website reaching Flagsmith?" The warehouse event counter only rises when
// a real browser reports an exposure or a click. Shared by the Integrate page and
// the agent's check_integration tool.

import type { Connection } from "../connection";
import { envPath, flagsmithRequest, isFlagsmithConnected } from "./client";

export interface IntegrationStatus {
  connected: boolean;
  enabled: boolean;
  total: number;
  last: string | null;
  error?: string;
}

type Get = <T>(path: string) => Promise<T>;

/** `get` is injectable so the agent can reuse its own request function and tests need no network. */
export async function readEventCounter(conn: Connection, get?: Get): Promise<IntegrationStatus> {
  if (!isFlagsmithConnected(conn)) return { connected: false, enabled: false, total: 0, last: null };
  try {
    const path = envPath("warehouse-connections/", conn);
    const w = await (get ?? ((p: string) => flagsmithRequest(p, {}, conn)))<
      { total_events_received?: number | null; last_event_received_at?: string | null }[]
    >(path);
    const first = Array.isArray(w) ? w[0] : undefined;
    if (!first) return { connected: true, enabled: false, total: 0, last: null };
    return { connected: true, enabled: true, total: first.total_events_received ?? 0, last: first.last_event_received_at ?? null };
  } catch (e) {
    return { connected: true, enabled: false, total: 0, last: null, error: e instanceof Error ? e.message.slice(0, 160) : "Could not read Flagsmith." };
  }
}
