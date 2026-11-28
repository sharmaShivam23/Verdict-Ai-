import { describe, expect, it } from "vitest";
import { connectionFromStored, seal, sealingSecret, unseal, type StoredConnection } from "./connection";
import {
  activateConnection,
  activeStored,
  createConnection,
  GUEST_TTL_MS,
  loadStored,
  mergeForEdit,
  removeConnection,
  summarise,
  updateConnection,
  type ConnectionRecord,
  type Store,
  type UserRecord,
} from "./connections-store";

/** In-memory Store with the same ownership rules MongoDB enforces (every lookup is scoped by user). */
function memoryStore(): Store & { users: Map<string, UserRecord>; conns: Map<string, ConnectionRecord> } {
  const users = new Map<string, UserRecord>();
  const conns = new Map<string, ConnectionRecord>();
  return {
    users,
    conns,
    async upsertUserByGithub(p) {
      const found = [...users.values()].find((u) => u.githubId === p.githubId);
      if (found) {
        Object.assign(found, { login: p.login, name: p.name, avatarUrl: p.avatarUrl });
        return found;
      }
      const u: UserRecord = { id: `u${users.size + 1}`, ...p };
      users.set(u.id, u);
      return u;
    },
    async createGuest(expireAt) {
      const u: UserRecord = { id: `g${users.size + 1}`, githubId: 0, login: `guest-${users.size + 1}`, guest: true, expireAt };
      users.set(u.id, u);
      return u;
    },
    async getUser(id) {
      return users.get(id) ?? null;
    },
    async setActive(userId, connectionId) {
      const u = users.get(userId);
      if (u) u.activeConnectionId = connectionId;
    },
    async listConnections(userId) {
      return [...conns.values()].filter((c) => c.userId === userId);
    },
    async getConnection(userId, id) {
      const c = conns.get(id);
      return c && c.userId === userId ? c : null;
    },
    async insertConnection(r) {
      conns.set(r.id, r);
    },
    async replaceConnection(r) {
      const c = conns.get(r.id);
      if (!c || c.userId !== r.userId) return false;
      conns.set(r.id, r);
      return true;
    },
    async deleteConnection(userId, id) {
      const c = conns.get(id);
      if (!c || c.userId !== userId) return false;
      return conns.delete(id);
    },
  };
}

const stored = (over: Partial<StoredConnection> = {}): StoredConnection => ({
  flagsmithApiKey: "fs-secret-key-123",
  authScheme: "Api-Key",
  environmentKey: "ENVKEY12345678",
  projectId: "56853",
  githubToken: "github_pat_secret",
  githubRepo: "me/site",
  cleanupPath: "app/",
  geminiApiKey: "AIza-secret",
  trafficIsReal: false,
  ...over,
});

async function twoUsers() {
  const store = memoryStore();
  const alice = await store.upsertUserByGithub({ githubId: 1, login: "alice" });
  const bob = await store.upsertUserByGithub({ githubId: 2, login: "bob" });
  return { store, alice, bob };
}

describe("summarise", () => {
  it("never contains a secret, only a masked key and booleans", () => {
    const json = JSON.stringify(summarise(stored()));
    for (const secret of ["fs-secret-key-123", "github_pat_secret", "AIza-secret"]) expect(json).not.toContain(secret);
    expect(summarise(stored())).toMatchObject({ projectId: "56853", hasGithub: true, hasGemini: true });
  });
});

describe("saving connections", () => {
  it("stores the secrets sealed, never in plain text", async () => {
    const { store, alice } = await twoUsers();
    const rec = await createConnection(store, alice.id, "Site", stored());
    expect(rec.sealed).not.toContain("fs-secret-key-123");
    expect(unseal<StoredConnection>(rec.sealed, sealingSecret())?.flagsmithApiKey).toBe("fs-secret-key-123");
  });

  it("makes the first connection active and keeps the active one when adding more", async () => {
    const { store, alice } = await twoUsers();
    const first = await createConnection(store, alice.id, "One", stored());
    const second = await createConnection(store, alice.id, "Two", stored({ projectId: "1" }));
    expect(store.users.get(alice.id)?.activeConnectionId).toBe(first.id);
    expect(await activateConnection(store, alice.id, second.id)).toBe(true);
    expect(store.users.get(alice.id)?.activeConnectionId).toBe(second.id);
  });

  it("gives each user their own active connection", async () => {
    const { store, alice, bob } = await twoUsers();
    await createConnection(store, alice.id, "A", stored({ projectId: "111" }));
    await createConnection(store, bob.id, "B", stored({ projectId: "222" }));
    expect((await activeStored(store, alice.id))?.projectId).toBe("111");
    expect((await activeStored(store, bob.id))?.projectId).toBe("222");
  });
});

describe("guest accounts", () => {
  it("a guest gets the full feature set: projects are saved and become active", async () => {
    const store = memoryStore();
    const guest = await store.createGuest(Date.now() + GUEST_TTL_MS);
    const rec = await createConnection(store, guest.id, "Mine", stored());
    expect((await activeStored(store, guest.id))?.projectId).toBe("56853");
    expect(rec.userId).toBe(guest.id);
  });

  it("a guest's projects expire with the guest, a GitHub user's never do", async () => {
    const { store, alice } = await twoUsers();
    const exp = Date.now() + 1000;
    const guest = await store.createGuest(exp);
    expect((await createConnection(store, guest.id, "G", stored())).expireAt).toBe(exp);
    expect((await createConnection(store, alice.id, "A", stored())).expireAt).toBeUndefined();
  });

  it("a guest cannot see a GitHub user's projects, nor the reverse", async () => {
    const { store, alice } = await twoUsers();
    const guest = await store.createGuest(Date.now() + GUEST_TTL_MS);
    const mine = await createConnection(store, alice.id, "Alice's", stored());
    expect(await loadStored(store, guest.id, mine.id)).toBeNull();
    expect(await activeStored(store, guest.id)).toBeNull();
  });
});

describe("user isolation", () => {
  it("another user can neither read, edit, activate nor delete a connection", async () => {
    const { store, alice, bob } = await twoUsers();
    const rec = await createConnection(store, alice.id, "Alice's", stored());
    expect(await loadStored(store, bob.id, rec.id)).toBeNull();
    expect(await updateConnection(store, bob.id, rec.id, "hijack", stored({ projectId: "999" }))).toBeNull();
    expect(await activateConnection(store, bob.id, rec.id)).toBe(false);
    expect(await removeConnection(store, bob.id, rec.id)).toBe(false);
    expect((await loadStored(store, alice.id, rec.id))?.projectId).toBe("56853"); // untouched
  });
});

describe("editing", () => {
  it("blank secret fields keep the saved secrets; filled ones replace them", () => {
    const merged = mergeForEdit(stored(), stored({ flagsmithApiKey: "", githubToken: undefined, geminiApiKey: "AIza-new", projectId: "7" }));
    expect(merged).toMatchObject({ flagsmithApiKey: "fs-secret-key-123", githubToken: "github_pat_secret", geminiApiKey: "AIza-new", projectId: "7" });
  });

  it("an edit with blank secrets keeps them in the stored record", async () => {
    const { store, alice } = await twoUsers();
    const rec = await createConnection(store, alice.id, "Site", stored());
    const next = await updateConnection(store, alice.id, rec.id, "Renamed", stored({ flagsmithApiKey: "", githubToken: undefined, geminiApiKey: undefined, projectId: "42" }));
    expect(next?.label).toBe("Renamed");
    const after = await loadStored(store, alice.id, rec.id);
    expect(after).toMatchObject({ projectId: "42", flagsmithApiKey: "fs-secret-key-123", githubToken: "github_pat_secret" });
  });
});

describe("deleting", () => {
  it("moves the active connection to another one, or to none", async () => {
    const { store, alice } = await twoUsers();
    const a = await createConnection(store, alice.id, "A", stored());
    const b = await createConnection(store, alice.id, "B", stored({ projectId: "2" }));
    expect(await removeConnection(store, alice.id, a.id)).toBe(true);
    expect(store.users.get(alice.id)?.activeConnectionId).toBe(b.id);
    expect(await removeConnection(store, alice.id, b.id)).toBe(true);
    expect(store.users.get(alice.id)?.activeConnectionId).toBeUndefined();
    expect(await activeStored(store, alice.id)).toBeNull();
  });
});

describe("unreadable records", () => {
  it("a record sealed with another secret reads as nothing, never as someone else's data", async () => {
    const { store, alice } = await twoUsers();
    const rec = await createConnection(store, alice.id, "Site", stored());
    store.conns.set(rec.id, { ...rec, sealed: seal(stored(), "a-different-secret") });
    expect(await activeStored(store, alice.id)).toBeNull();
  });

  it("a loaded connection acts as a browser connection with the saved project", async () => {
    const { store, alice } = await twoUsers();
    await createConnection(store, alice.id, "Site", stored());
    const c = connectionFromStored((await activeStored(store, alice.id))!);
    expect(c).toMatchObject({ source: "browser", projectId: "56853" });
  });
});
