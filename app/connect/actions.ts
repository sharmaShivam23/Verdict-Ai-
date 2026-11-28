"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { normaliseCleanupPath, connectionFromStored, type StoredConnection } from "@/lib/connection";
import {
  activateConnection,
  createConnection,
  loadStored,
  mergeForEdit,
  mongoStore,
  removeConnection,
  updateConnection,
} from "@/lib/connections-store";
import { FlagsmithHttpError, flagsmithRequest, envPath } from "@/lib/flagsmith/client";
import { resolveGemini } from "@/lib/agent/providers";
import { githubFor, GitHubError } from "@/lib/github/client";

export interface CheckLine {
  id: string;
  label: string;
  state: "ok" | "no" | "skip";
  detail: string;
}

export interface ConnectState {
  saved?: boolean;
  checks?: CheckLine[];
  error?: string;
}

const text = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v.trim() : "";
};

type Parsed = { ok: true; value: StoredConnection; label: string; editId?: string } | { ok: false; error: string };

/** `editing` = the person is changing a saved connection, so blank secret fields mean "keep the saved one". */
function parse(f: FormData): Parsed {
  const editId = text(f, "id") || undefined;
  const flagsmithApiKey = text(f, "flagsmithApiKey");
  const environmentKey = text(f, "environmentKey");
  const projectId = text(f, "projectId");
  if ((!flagsmithApiKey && !editId) || !environmentKey || !projectId) {
    return { ok: false, error: "Flagsmith API key, environment key and project id are all required." };
  }
  if (!/^\d{1,12}$/.test(projectId)) return { ok: false, error: "The project id is the number in your Flagsmith URL, for example 55600." };
  const cleanupPath = normaliseCleanupPath(text(f, "cleanupPath"));
  if (!cleanupPath) return { ok: false, error: "The code folder must look like src/components (letters, digits, - _ . and /, no .. or hidden folders)." };
  const githubRepo = text(f, "githubRepo");
  if (githubRepo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(githubRepo)) return { ok: false, error: 'The repo must look like "owner/name".' };

  return {
    ok: true,
    editId,
    label: text(f, "label"),
    value: {
      flagsmithApiKey,
      authScheme: text(f, "authScheme") === "Token" ? "Token" : "Api-Key",
      environmentKey,
      projectId,
      githubToken: text(f, "githubToken") || undefined,
      githubRepo: githubRepo || undefined,
      cleanupPath,
      geminiApiKey: text(f, "geminiApiKey") || undefined,
      trafficIsReal: f.get("trafficIsReal") === "on",
    },
  };
}

/** Really calls Flagsmith and GitHub with what was entered. Nothing is saved. */
async function runChecks(s: StoredConnection): Promise<CheckLine[]> {
  const conn = connectionFromStored(s);
  const lines: CheckLine[] = [];

  try {
    const r = await flagsmithRequest<unknown>(envPath("experiments/", conn), {}, conn);
    const n = (Array.isArray(r) ? r : ((r as { results?: unknown[] })?.results ?? [])).length;
    lines.push({ id: "flagsmith", label: "Flagsmith API", state: "ok", detail: `Connected. Found ${n} experiment${n === 1 ? "" : "s"}.` });
  } catch (e) {
    const msg =
      e instanceof FlagsmithHttpError && (e.status === 401 || e.status === 403)
        ? "Flagsmith rejected the API key. Check the key and whether it is an Organisation key (Api-Key) or a personal token."
        : e instanceof FlagsmithHttpError && e.status === 404
          ? "Flagsmith could not find that environment key."
          : e instanceof Error
            ? e.message.slice(0, 160)
            : "Could not reach Flagsmith.";
    lines.push({ id: "flagsmith", label: "Flagsmith API", state: "no", detail: msg });
  }

  try {
    const wh = await flagsmithRequest<{ status?: string; total_events_received?: number | null }[]>(
      envPath("warehouse-connections/", conn),
      {},
      conn,
    );
    const w = Array.isArray(wh) ? wh[0] : undefined;
    lines.push(
      !w
        ? { id: "warehouse", label: "Event warehouse", state: "no", detail: "No warehouse is enabled. In Flagsmith: Environment Settings, then Warehouse." }
        : (w.total_events_received ?? 0) > 0
          ? { id: "warehouse", label: "Event warehouse", state: "ok", detail: `Receiving events (${w.total_events_received} so far). Your website is reaching Flagsmith.` }
          : { id: "warehouse", label: "Event warehouse", state: "skip", detail: "Enabled, but no events yet. This is normal until your website sends its first visitor." },
    );
  } catch {
    lines.push({ id: "warehouse", label: "Event warehouse", state: "skip", detail: "Could not read the warehouse status." });
  }

  if (s.githubToken && s.githubRepo) {
    try {
      const gh = githubFor(s);
      const files = await gh!.listFiles(s.cleanupPath);
      lines.push({
        id: "github",
        label: "GitHub repository",
        state: "ok",
        detail: `Can read ${s.githubRepo}. ${files.length} file${files.length === 1 ? "" : "s"} under ${s.cleanupPath}.`,
      });
    } catch (e) {
      lines.push({ id: "github", label: "GitHub repository", state: "no", detail: e instanceof GitHubError ? e.message.slice(0, 200) : "Could not reach GitHub." });
    }
  } else {
    lines.push({ id: "github", label: "GitHub repository", state: "skip", detail: "Not connected. The agent will show cleanup changes as a diff instead of opening a pull request." });
  }

  const sharedModel = !s.geminiApiKey && resolveGemini({}).shared;
  lines.push(
    s.geminiApiKey
      ? { id: "model", label: "Agent model", state: "ok", detail: "Your Gemini key is set." }
      : sharedModel
        ? { id: "model", label: "Agent model", state: "ok", detail: "No key of your own, so the agent uses this server's shared Gemini key. Add yours to avoid shared limits." }
        : { id: "model", label: "Agent model", state: "skip", detail: "No Gemini key. The Agent page needs one (free from Google AI Studio)." },
  );
  return lines;
}

/** For an edit, blank secret fields are filled from the saved connection (only if it is THIS user's). */
async function withSavedSecrets(userId: string, p: Extract<Parsed, { ok: true }>): Promise<StoredConnection | null> {
  if (!p.editId) return p.value;
  const existing = await loadStored(mongoStore, userId, p.editId);
  return existing ? mergeForEdit(existing, p.value) : null;
}

export async function testConnection(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const user = await requireUser();
  const p = parse(formData);
  if (!p.ok) return { error: p.error };
  const full = await withSavedSecrets(user.id, p);
  if (!full) return { error: "That connection no longer exists." };
  return { checks: await runChecks(full) };
}

export async function saveConnectionAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  const user = await requireUser();
  const p = parse(formData);
  if (!p.ok) return { error: p.error };
  const full = await withSavedSecrets(user.id, p);
  if (!full) return { error: "That connection no longer exists." };
  const checks = await runChecks(full);
  // Never save a connection Flagsmith itself rejects.
  if (checks.find((c) => c.id === "flagsmith")?.state === "no") {
    return { checks, error: "Not saved: Flagsmith rejected these details. Fix the first check and try again." };
  }
  try {
    if (p.editId) {
      const rec = await updateConnection(mongoStore, user.id, p.editId, p.label, full);
      if (!rec) return { checks, error: "That connection no longer exists." };
    } else {
      await createConnection(mongoStore, user.id, p.label, full);
    }
  } catch (e) {
    console.error("save connection failed:", e instanceof Error ? e.message : e);
    return { checks, error: "Could not save to the database. Check MONGODB_URI and that your IP is allowed in MongoDB Atlas." };
  }
  revalidatePath("/", "layout");
  return { saved: true, checks };
}

const idOf = (f: FormData) => text(f, "id");

export async function activateAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await activateConnection(mongoStore, user.id, idOf(formData));
  revalidatePath("/", "layout");
}

export async function deleteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await removeConnection(mongoStore, user.id, idOf(formData));
  revalidatePath("/", "layout");
  redirect("/connect");
}
