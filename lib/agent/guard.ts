// The agent endpoints can write to Flagsmith with an admin key, so they are
// local-only and CSRF-resistant by default.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(hostHeader: string | null): string {
  return (hostHeader ?? "").replace(/:\d+$/, "").toLowerCase();
}

/** Returns an error Response if the request must be rejected, else null. */
export function rejectIfUnsafe(req: Request): Response | null {
  const host = req.headers.get("host");

  // 1. Only reachable from localhost unless explicitly opened up.
  if (process.env.VERDICT_ALLOW_REMOTE !== "1" && !LOCAL_HOSTS.has(hostname(host))) {
    return Response.json(
      { error: "The agent API is local-only. Set VERDICT_ALLOW_REMOTE=1 and add real authentication before exposing it." },
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
