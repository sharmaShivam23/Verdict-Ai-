// API routes that act on someone's Flagsmith project need a signed-in user.

import { getSessionUserId } from "./session";

/** The signed-in user's id, or a ready-made 401 Response. */
export async function requireUserId(): Promise<{ userId: string } | { response: Response }> {
  const userId = await getSessionUserId();
  if (!userId) {
    return { response: Response.json({ error: "Sign in with GitHub first.", signIn: "/login" }, { status: 401 }) };
  }
  return { userId };
}
