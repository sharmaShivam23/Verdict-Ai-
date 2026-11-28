// Users and their saved connections. The rules (ownership, "blank secret keeps
// the old one", which connection is active) live here and are tested against an
// in-memory store; MongoDB is only the storage behind the `Store` interface.
//
// Secrets (Flagsmith key, GitHub token, model key) are sealed with AES-256-GCM
// before they are stored and are never sent back to the browser.

import { randomUUID } from "node:crypto";
import { seal, sealingSecret, unseal, type StoredConnection } from "./connection";
import { getDb } from "./db/mongo";

/** A guest keeps the full app for a week, tied to one browser. Their data is deleted when this passes. */
export const GUEST_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export interface UserRecord {
  id: string;
  /** 0 for a guest (no GitHub account). */
  githubId: number;
  login: string;
  /** Continued without signing in. Everything works with their own keys; data expires. */
  guest?: boolean;
  /** Guests only: epoch ms after which the account and its projects are deleted. */
  expireAt?: number;
  name?: string;
  avatarUrl?: string;
  activeConnectionId?: string;
}

/** What the UI may show about a saved connection. Never a secret. */
export interface ConnectionSummary {
  projectId: string;
  environmentKey: string;
  githubRepo?: string;
  cleanupPath: string;
  hasGithub: boolean;
  hasGemini: boolean;
  trafficIsReal: boolean;
  flagsmithKeyMask: string;
}

export interface ConnectionRecord {
  id: string;
  userId: string;
  label: string;
  sealed: string;
  summary: ConnectionSummary;
  updatedAt: number;
  /** Set for a guest's projects, so they are deleted with the guest. */
  expireAt?: number;
}

export interface GithubProfile {
  githubId: number;
  login: string;
  name?: string;
  avatarUrl?: string;
}

/** Storage. Every connection method is scoped by userId so one user can never touch another's data. */
export interface Store {
  upsertUserByGithub(p: GithubProfile): Promise<UserRecord>;
  createGuest(expireAt: number): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  setActive(userId: string, connectionId: string | undefined): Promise<void>;
  listConnections(userId: string): Promise<ConnectionRecord[]>;
  getConnection(userId: string, id: string): Promise<ConnectionRecord | null>;
  insertConnection(rec: ConnectionRecord): Promise<void>;
  replaceConnection(rec: ConnectionRecord): Promise<boolean>;
  deleteConnection(userId: string, id: string): Promise<boolean>;
}

const mask = (v: string) => (v.length > 6 ? `${v.slice(0, 4)}…${v.slice(-2)}` : "set");

export function summarise(s: StoredConnection): ConnectionSummary {
  return {
    projectId: s.projectId ?? "",
    environmentKey: s.environmentKey ?? "",
    githubRepo: s.githubRepo,
    cleanupPath: s.cleanupPath,
    hasGithub: Boolean(s.githubToken && s.githubRepo),
    hasGemini: Boolean(s.geminiApiKey),
    trafficIsReal: s.trafficIsReal,
    flagsmithKeyMask: s.flagsmithApiKey ? mask(s.flagsmithApiKey) : "",
  };
}

/** Fields that are secrets: left blank on an edit, they keep the saved value. */
const SECRET_FIELDS = ["flagsmithApiKey", "githubToken", "geminiApiKey"] as const;

/** Fill blank secret fields of an edit from what is already saved. */
export function mergeForEdit(existing: StoredConnection, incoming: StoredConnection): StoredConnection {
  const out: StoredConnection = { ...incoming };
  for (const f of SECRET_FIELDS) {
    if (!out[f]) out[f] = existing[f];
  }
  return out;
}

const unsealStored = (rec: ConnectionRecord) => unseal<StoredConnection>(rec.sealed, sealingSecret());

export async function createConnection(store: Store, userId: string, label: string, s: StoredConnection): Promise<ConnectionRecord> {
  const user = await store.getUser(userId);
  const rec: ConnectionRecord = {
    id: randomUUID(),
    userId,
    label: label.trim().slice(0, 60) || `Project ${s.projectId ?? ""}`.trim(),
    sealed: seal(s, sealingSecret()),
    summary: summarise(s),
    updatedAt: Date.now(),
    ...(user?.guest && user.expireAt ? { expireAt: user.expireAt } : {}),
  };
  await store.insertConnection(rec);
  if (!user?.activeConnectionId || !(await store.getConnection(userId, user.activeConnectionId))) {
    await store.setActive(userId, rec.id); // the first connection becomes the active one
  }
  return rec;
}

/** The stored (decrypted) connection for editing, or null when it is not this user's. */
export async function loadStored(store: Store, userId: string, id: string): Promise<StoredConnection | null> {
  const rec = await store.getConnection(userId, id);
  return rec ? (unsealStored(rec) ?? null) : null;
}

export async function updateConnection(
  store: Store,
  userId: string,
  id: string,
  label: string,
  incoming: StoredConnection,
): Promise<ConnectionRecord | null> {
  const rec = await store.getConnection(userId, id);
  if (!rec) return null;
  const existing = unsealStored(rec);
  const merged = existing ? mergeForEdit(existing, incoming) : incoming;
  const next: ConnectionRecord = {
    ...rec,
    label: label.trim().slice(0, 60) || rec.label,
    sealed: seal(merged, sealingSecret()),
    summary: summarise(merged),
    updatedAt: Date.now(),
  };
  return (await store.replaceConnection(next)) ? next : null;
}

export async function removeConnection(store: Store, userId: string, id: string): Promise<boolean> {
  const ok = await store.deleteConnection(userId, id);
  if (!ok) return false;
  const user = await store.getUser(userId);
  if (user?.activeConnectionId === id) {
    const rest = await store.listConnections(userId);
    await store.setActive(userId, rest[0]?.id);
  }
  return true;
}

export async function activateConnection(store: Store, userId: string, id: string): Promise<boolean> {
  if (!(await store.getConnection(userId, id))) return false;
  await store.setActive(userId, id);
  return true;
}

/** The connection this user's requests act on, decrypted. Null when none is active or it cannot be read. */
export async function activeStored(store: Store, userId: string): Promise<StoredConnection | null> {
  const user = await store.getUser(userId);
  if (!user?.activeConnectionId) return null;
  const rec = await store.getConnection(userId, user.activeConnectionId);
  return rec ? (unsealStored(rec) ?? null) : null;
}

// ---------- MongoDB implementation ----------

interface UserDoc {
  _id: string;
  /** Absent for guests: a sparse unique index then only covers real GitHub accounts. */
  githubId?: number;
  login: string;
  guest?: boolean;
  /** Guests only. MongoDB's TTL index deletes the document after this date. */
  expireAt?: Date;
  name?: string;
  avatarUrl?: string;
  activeConnectionId?: string;
  createdAt: number;
}
interface ConnectionDoc {
  _id: string;
  userId: string;
  label: string;
  sealed: string;
  summary: ConnectionSummary;
  updatedAt: number;
  expireAt?: Date;
}

const toUser = (d: UserDoc): UserRecord => ({
  id: d._id,
  githubId: d.githubId ?? 0,
  login: d.login,
  name: d.name,
  avatarUrl: d.avatarUrl,
  activeConnectionId: d.activeConnectionId,
  ...(d.guest ? { guest: true, expireAt: d.expireAt?.getTime() } : {}),
});
const toConn = (d: ConnectionDoc): ConnectionRecord => ({
  id: d._id,
  userId: d.userId,
  label: d.label,
  sealed: d.sealed,
  summary: d.summary,
  updatedAt: d.updatedAt,
  ...(d.expireAt ? { expireAt: d.expireAt.getTime() } : {}),
});

let indexed: Promise<void> | undefined;

async function collections() {
  const db = await getDb();
  const users = db.collection<UserDoc>("users");
  const connections = db.collection<ConnectionDoc>("connections");
  indexed ??= Promise.all([
    // An earlier version made githubId_1 unique but not sparse, which would reject a second guest.
    users.dropIndex("githubId_1").catch(() => undefined),
    // Guests have no githubId field, so this sparse unique index only covers real GitHub accounts.
    users.createIndex({ githubId: 1 }, { unique: true, sparse: true, name: "githubId_sparse_unique" }),
    connections.createIndex({ userId: 1, updatedAt: -1 }),
    // Guests and their projects delete themselves when expireAt passes.
    users.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
    connections.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
  ]).then(() => undefined);
  try {
    await indexed;
  } catch (e) {
    indexed = undefined;
    throw e;
  }
  return { users, connections };
}

export const mongoStore: Store = {
  async upsertUserByGithub(p) {
    const { users } = await collections();
    const doc = await users.findOneAndUpdate(
      { githubId: p.githubId },
      {
        $set: { login: p.login, name: p.name, avatarUrl: p.avatarUrl },
        $setOnInsert: { _id: randomUUID(), createdAt: Date.now() },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!doc) throw new Error("Could not save the user.");
    return toUser(doc);
  },
  async createGuest(expireAt) {
    const { users } = await collections();
    const id = randomUUID();
    await users.insertOne({ _id: id, login: `guest-${id.slice(0, 6)}`, guest: true, expireAt: new Date(expireAt), createdAt: Date.now() });
    return { id, githubId: 0, login: `guest-${id.slice(0, 6)}`, guest: true, expireAt };
  },
  async getUser(id) {
    const { users } = await collections();
    const d = await users.findOne({ _id: id });
    return d ? toUser(d) : null;
  },
  async setActive(userId, connectionId) {
    const { users } = await collections();
    await users.updateOne(
      { _id: userId },
      connectionId ? { $set: { activeConnectionId: connectionId } } : { $unset: { activeConnectionId: "" } },
    );
  },
  async listConnections(userId) {
    const { connections } = await collections();
    return (await connections.find({ userId }).sort({ updatedAt: -1 }).toArray()).map(toConn);
  },
  async getConnection(userId, id) {
    const { connections } = await collections();
    const d = await connections.findOne({ _id: id, userId });
    return d ? toConn(d) : null;
  },
  async insertConnection(r) {
    const { connections } = await collections();
    await connections.insertOne({
      _id: r.id,
      userId: r.userId,
      label: r.label,
      sealed: r.sealed,
      summary: r.summary,
      updatedAt: r.updatedAt,
      ...(r.expireAt ? { expireAt: new Date(r.expireAt) } : {}),
    });
  },
  async replaceConnection(r) {
    const { connections } = await collections();
    const res = await connections.updateOne(
      { _id: r.id, userId: r.userId },
      { $set: { label: r.label, sealed: r.sealed, summary: r.summary, updatedAt: r.updatedAt } },
    );
    return res.matchedCount === 1;
  },
  async deleteConnection(userId, id) {
    const { connections } = await collections();
    return (await connections.deleteOne({ _id: id, userId })).deletedCount === 1;
  },
};
