import { connectionFingerprint } from "@/lib/connection";
import { getConnection } from "@/lib/connection-server";
import { rejectIfUnsafe } from "@/lib/agent/guard";
import { sendUserMessage } from "@/lib/agent/loop";
import { modelFor } from "@/lib/agent/providers";
import { getOrCreateSession, toPublic } from "@/lib/agent/sessions";
import { depsFor, makeExecutor } from "@/lib/agent/tools";

const MAX_MESSAGE_CHARS = 4000;

export async function POST(request: Request) {
  const conn = await getConnection();
  const blocked = rejectIfUnsafe(request, conn);
  if (blocked) return blocked;

  let body: { sessionId?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { error: `"message" must be 1-${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 },
    );
  }

  // Act with the caller's own connection (their saved keys, or .env.local when local).
  const session = getOrCreateSession(
    typeof body.sessionId === "string" ? body.sessionId : undefined,
    connectionFingerprint(conn),
  );
  const result = await sendUserMessage(session, message, {
    callModel: modelFor(conn),
    execute: makeExecutor(depsFor(conn)),
  });
  return Response.json(toPublic(session, result));
}
