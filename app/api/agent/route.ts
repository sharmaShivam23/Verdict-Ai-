import { rejectIfUnsafe } from "@/lib/agent/guard";
import { sendUserMessage } from "@/lib/agent/loop";
import { callModel } from "@/lib/agent/providers";
import { getOrCreateSession, toPublic } from "@/lib/agent/sessions";
import { executeTool } from "@/lib/agent/tools";

const MAX_MESSAGE_CHARS = 4000;

export async function POST(request: Request) {
  const blocked = rejectIfUnsafe(request);
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

  const session = getOrCreateSession(typeof body.sessionId === "string" ? body.sessionId : undefined);
  const result = await sendUserMessage(session, message, { callModel, execute: executeTool });
  return Response.json(toPublic(session, result));
}
