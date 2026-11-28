import { describe, expect, it } from "vitest";
import { resolveGemini } from "./index";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("resolveGemini", () => {
  it("uses the person's own key and model when they saved one", () => {
    expect(resolveGemini({ geminiApiKey: "mine", geminiModel: "m1" }, env({ GEMINI_API_KEY: "server" }))).toEqual({ apiKey: "mine", model: "m1", shared: false });
  });

  it("falls back to the server's key (and model) when they have none", () => {
    expect(resolveGemini({}, env({ GEMINI_API_KEY: "server", GEMINI_MODEL: "m2" }))).toEqual({ apiKey: "server", model: "m2", shared: true });
  });

  it("has no key when neither exists", () => {
    expect(resolveGemini({}, env({}))).toEqual({ shared: false });
    expect(resolveGemini({}, env({ GEMINI_API_KEY: "  " }))).toEqual({ shared: false });
  });

  it("the owner can switch sharing off", () => {
    expect(resolveGemini({}, env({ GEMINI_API_KEY: "server", VERDICT_DISABLE_SHARED_MODEL: "1" }))).toEqual({ shared: false });
  });
});
