"use server";

import { getConnection } from "@/lib/connection-server";
import { readEventCounter, type IntegrationStatus } from "@/lib/flagsmith/integration";

export type { IntegrationStatus };

/**
 * Has Flagsmith received any events from the website? This is the real proof
 * that the pasted code is working: the warehouse counter only rises when a
 * browser actually reports an exposure or a click.
 */
export async function checkIntegration(): Promise<IntegrationStatus> {
  return readEventCounter(await getConnection());
}
