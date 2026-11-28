// "Continue without login": a guest account with the FULL app, using the guest's OWN
// Flagsmith/GitHub/model keys. It never gets the server's .env.local keys. The guest and
// their saved projects are tied to this browser's cookie and deleted after a week.

import { createSession } from "@/lib/auth/session";
import { GUEST_TTL_MS, mongoStore } from "@/lib/connections-store";

// POST only, from our own pages, so another website cannot create guest accounts in bulk for a visitor.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  try {
    const guest = await mongoStore.createGuest(Date.now() + GUEST_TTL_MS);
    await createSession(guest.id, GUEST_TTL_MS);
  } catch (e) {
    console.error("guest sign-in failed:", e instanceof Error ? e.message : e);
    return Response.redirect(new URL("/login?error=failed", request.url), 303);
  }
  return Response.redirect(new URL("/", request.url), 303);
}
