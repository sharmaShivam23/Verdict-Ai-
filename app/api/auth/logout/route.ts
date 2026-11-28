import { clearSession } from "@/lib/auth/session";

// POST only, so a link or an image on another site cannot sign someone out.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  await clearSession();
  return Response.redirect(new URL("/", request.url), 303);
}
