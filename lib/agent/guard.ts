// The agent endpoints can write to a Flagsmith project with an admin key, so:
//  - a request from this machine may use the server's keys or its own saved ones;
//  - a remote request may ONLY act with the caller's own saved connection, never the server's;
//  - every request must be same-origin JSON (CSRF resistant).

import { isLocalHost, type Connection } from "../connection";

/** Returns an error Response if the request must be rejected, else null. */
export function rejectIfUnsafe(req: Request, conn: Connection): Response | null {
  const host = req.headers.get("host");

  // 1. Remote callers must bring their own keys. (VERDICT_ALLOW_REMOTE=1 opens the server's keys to everyone: single-owner use only.)
  const remote = !isLocalHost(host);
  if (remote && process.env.VERDICT_ALLOW_REMOTE !== "1" && conn.source !== "browser") {
    return Response.json(
      { error: "Connect your own Flagsmith project first (Connect page). This server's keys are not available to remote visitors." },
      { status: 403 },
    );
  }

  // 2. CSRF: a JSON content type cannot be sent cross-site without a CORS
  //    preflight, and a cross-site Origin is refused outright.
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== host) {
        return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Bad Origin header." }, { status: 403 });
    }
  }
  return null;
}
