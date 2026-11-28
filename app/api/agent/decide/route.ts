import { connectionFingerprint } from "@/lib/connection";
import { requireUserId } from "@/lib/auth/guard";
import { getConnection } from "@/lib/connection-server";
import { rejectIfUnsafe } from "@/lib/agent/guard";
import { decide } from "@/lib/agent/loop";
import { modelFor } from "@/lib/agent/providers";
import { getSession, toPublic } from "@/lib/agent/sessions";
import { depsFor, makeExecutor } from "@/lib/agent/tools";

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ("response" in auth) return auth.response;
  const conn = await getConnection();
  const blocked = rejectIfUnsafe(request, conn);
  if (blocked) return blocked;

  let body: { sessionId?: unknown; toolUseId?: unknown; decision?: unknown; confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (
    typeof body.sessionId !== "string" ||
    typeof body.toolUseId !== "string" ||
    (body.decision !== "approve" && body.decision !== "deny")
  ) {
    return Response.json(
      { error: 'Need "sessionId", "toolUseId" and "decision" ("approve" or "deny").' },
      { status: 400 },
    );
  }

  const session = getSession(body.sessionId, connectionFingerprint(conn));
  if (!session) return Response.json({ error: "Unknown session." }, { status: 404 });

  const result = await decide(
    session,
    body.toolUseId,
    body.decision,
    typeof body.confirm === "string" ? body.confirm : undefined,
    { callModel: modelFor(conn), execute: makeExecutor(depsFor(conn)) },
  );
  return Response.json(toPublic(session, result));
}
