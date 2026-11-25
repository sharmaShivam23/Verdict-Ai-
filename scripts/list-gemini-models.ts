// Lists the Gemini models your API key can call with generateContent, so you
// can pick GEMINI_MODEL without guessing. Read-only.
// Usage: npx tsx --env-file=.env.local scripts/list-gemini-models.ts

import { GoogleGenAI } from "@google/genai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env.local");
  const ai = new GoogleGenAI({ apiKey });

  const pager = await ai.models.list();
  const rows: string[] = [];
  for await (const m of pager) {
    if (m.supportedActions?.includes("generateContent")) {
      rows.push(`${(m.name ?? "").replace(/^models\//, "")}\t${m.displayName ?? ""}`);
    }
  }
  console.log(rows.length ? rows.sort().join("\n") : "No generateContent models found for this key.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
