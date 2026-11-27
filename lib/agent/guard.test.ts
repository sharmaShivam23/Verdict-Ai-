import { afterEach, describe, expect, it } from "vitest";
import {
  connectionFromEnv,
  connectionFromStored,
  emptyConnection,
  isLocalHost,
  mayUseServerKeys,
  type StoredConnection,
} from "../connection";
import { rejectIfUnsafe } from "./guard";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const own: StoredConnection = { flagsmithApiKey: "k", authScheme: "Api-Key", environmentKey: "e", projectId: "1", cleanupPath: "src/", trafficIsReal: false };

const req = (host: string, opts: { type?: string; origin?: string } = {}) =>
  new Request(`http://${host}/api/agent`, {
    method: "POST",
    headers: { host, "content-type": opts.type ?? "application/json", ...(opts.origin ? { origin: opts.origin } : {}) },
    body: "{}",
  });

describe("who may use the server's own keys", () => {
  it("recognises local hosts only", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3110", "[::1]:3000", "LOCALHOST"]) expect(isLocalHost(h), h).toBe(true);
    for (const h of ["evil.example", "verdict.vercel.app", "localhost.evil.com", "127.0.0.1.evil.com", null, ""]) expect(isLocalHost(h), String(h)).toBe(false);
  });

  it("a stranger on a public host gets NO server keys; the owner on localhost does", () => {
    expect(mayUseServerKeys("localhost:3000", env({}))).toBe(true);
    expect(mayUseServerKeys("verdict.example.com", env({}))).toBe(false);
    expect(mayUseServerKeys("verdict.example.com", env({ VERDICT_ALLOW_REMOTE: "1" }))).toBe(true); // explicit single-owner opt-in
  });

  it("an empty connection has no keys at all", () => {
    const c = emptyConnection();
    expect(c.flagsmithApiKey).toBeUndefined();
    expect(c.githubToken).toBeUndefined();
    expect(c.geminiApiKey).toBeUndefined();
  });
});

describe("agent request guard", () => {
  const saved = process.env.VERDICT_ALLOW_REMOTE;
  afterEach(() => {
    if (saved === undefined) delete process.env.VERDICT_ALLOW_REMOTE;
    else process.env.VERDICT_ALLOW_REMOTE = saved;
  });
  const server = connectionFromEnv(env({ FLAGSMITH_API_KEY: "serverkey" }));
  const mine = connectionFromStored(own);

  it("allows localhost with the server's keys", () => {
    expect(rejectIfUnsafe(req("localhost:3000"), server)).toBeNull();
  });

  it("REFUSES a remote visitor who has not connected their own project", async () => {
    delete process.env.VERDICT_ALLOW_REMOTE;
    const r = rejectIfUnsafe(req("verdict.example.com"), emptyConnection());
    expect(r?.status).toBe(403);
    expect((await r!.json()).error).toMatch(/Connect your own/);
    // ...and a remote visitor cannot borrow the server's keys by hitting the API directly
    expect(rejectIfUnsafe(req("verdict.example.com"), server)?.status).toBe(403);
  });

  it("allows a remote visitor who connected their OWN project", () => {
    delete process.env.VERDICT_ALLOW_REMOTE;
    expect(rejectIfUnsafe(req("verdict.example.com"), mine)).toBeNull();
  });

  it("still enforces same-origin JSON for everyone", () => {
    expect(rejectIfUnsafe(req("localhost:3000", { type: "text/plain" }), server)?.status).toBe(415);
    expect(rejectIfUnsafe(req("localhost:3000", { origin: "http://evil.example" }), server)?.status).toBe(403);
    expect(rejectIfUnsafe(req("localhost:3000", { origin: "http://localhost:3000" }), server)).toBeNull();
    expect(rejectIfUnsafe(req("verdict.example.com", { origin: "https://other.site" }), mine)?.status).toBe(403);
  });
});
