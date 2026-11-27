"use server";

import { getConnection } from "@/lib/connection-server";
import { envPath, flagsmithRequest, isFlagsmithConnected } from "@/lib/flagsmith/client";

export interface IntegrationStatus {
  connected: boolean;
  enabled: boolean;
  total: number;
  last: string | null;
  error?: string;
}

/**
 * Has Flagsmith received any events from the website? This is the real proof
 * that the pasted code is working: the warehouse counter only rises when a
 * browser actually reports an exposure or a click.
 */
export async function checkIntegration(): Promise<IntegrationStatus> {
  const conn = await getConnection();
  if (!isFlagsmithConnected(conn)) return { connected: false, enabled: false, total: 0, last: null };
  try {
    const w = await flagsmithRequest<{ total_events_received?: number | null; last_event_received_at?: string | null }[]>(
      envPath("warehouse-connections/", conn),
      {},
      conn,
    );
    const first = Array.isArray(w) ? w[0] : undefined;
    if (!first) return { connected: true, enabled: false, total: 0, last: null };
    return { connected: true, enabled: true, total: first.total_events_received ?? 0, last: first.last_event_received_at ?? null };
  } catch (e) {
    return { connected: true, enabled: false, total: 0, last: null, error: e instanceof Error ? e.message.slice(0, 160) : "Could not read Flagsmith." };
  }
}
