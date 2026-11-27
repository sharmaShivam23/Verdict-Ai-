# Verdict

An AI agent that runs A/B tests in Flagsmith, and a referee that decides whether the result can be trusted.

Built solo for [Toggle Wars](https://www.wemakedevs.org/hackathons/flagsmith), Track 02 (AI Agents and Feature Flags).

<!-- Demo video: paste the link here -->

## What it looks like

![The referee says SHIP: the verdict, a chart per version, and every check with its reason](docs/screenshots/dashboard-ship.png)

![A result that looks like a big win but is marked INVALID, because visitors were not split evenly](docs/screenshots/dashboard-invalid.png)

![A result at 96% that Flagsmith's own banner would roll out, but where the range of likely results still includes zero, so Verdict waits and says why](docs/screenshots/dashboard-flagsmith-says-go.png)

![The agent stops and asks before it changes anything](docs/screenshots/agent-approval.png)

![The page that writes the code to paste into your own website](docs/screenshots/integrate.png)

## The problem

Say you can't decide whether a button should say "Checkout" or "Buy now". Flagsmith can show half your visitors one wording and half the other, and count who clicks. That part works well.

What it can't tell you is when you're allowed to believe the numbers. People look at a test too early. A test that checks its result ten times and stops at the first good-looking number turns a 1% false-alarm rate into roughly 5% ([Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)). Sometimes the visitors were never split evenly in the first place, so the result means nothing. And once a winner ships, the code for the losing version usually stays in the repo forever.

## What Verdict does

You tell the agent what you want to test. It sets the experiment up in Flagsmith, and a referee reads the results and gives one of four answers:

| Verdict | What it means |
|---|---|
| **SHIP** | The winner is real. Every check passed. |
| **KEEP RUNNING** | Too early to tell, or the evidence is not strong enough yet. |
| **INCONCLUSIVE** | There is a signal, but something blocks shipping (a guardrail got worse, or the numbers don't add up). |
| **INVALID** | The test itself is broken. Don't trust these numbers. |

Every answer comes with a checklist showing what passed, what failed, and what is still uncertain. The decision is ordinary code. The language model never decides anything and can't override the referee. It talks to you and proposes actions.

After a winner ships, the agent opens a GitHub pull request that deletes the losing code. [Pull request #1](https://github.com/sharmaShivam23/Verdict-Ai-/pull/1) in this repo was made that way, by a real run, and it passed the repo's CI.

## How a full run goes

1. You ask the agent to set up a test. It proposes a flag, a metric and a hypothesis. **You approve each step.**
2. Visitors use the page. The page asks Flagsmith which version to show (that counts as one exposure) and reports the click (that counts as one conversion).
3. Flagsmith adds it all up. Verdict reads the results through the Admin API.
4. The referee runs its checks and gives a verdict.
5. If it says SHIP, you approve completing the experiment by typing `COMPLETE <id>`. The server checks the verdict again by itself and refuses if it isn't SHIP.
6. The agent opens a pull request that removes the losing code. The body includes the referee's verdict and checklist.
7. You review and merge.

## What the agent can and can't do

| Action | Rule |
|---|---|
| Read experiments, fetch results, search the demo code | Runs on its own |
| Create a flag, metric or experiment; start or pause; open a pull request | Stops and waits for your approval |
| Complete an experiment (can't be undone) | Needs a typed confirmation, **and** is refused unless the referee says SHIP for exactly that variation |
| Edit files | Only inside `app/demo/`, and only one code pattern (below) |
| Which version to keep after cleanup | Read from Flagsmith's own record of the rollout decision, not from the model |

These rules are code in [`lib/agent/policy.ts`](lib/agent/policy.ts) and [`lib/agent/tools.ts`](lib/agent/tools.ts), not instructions in a prompt, and they are covered by tests. The agent's API only accepts requests from localhost.

## What the referee checks

1. **Traffic split.** Did people land in each version in the proportions configured? I run my own chi-square test, because Flagsmith's own field for this (`srm_p_value`) stayed empty in every run I did.
2. **Quarantined identities.** People who saw more than one version are excluded by Flagsmith. Too many is a warning.
3. **Enough data.** At least 50 people and 5 conversions in every arm, the same threshold Flagsmith uses.
4. **Win probability at 95% or higher.**
5. **The number can be reproduced.** The referee recomputes Flagsmith's win probability from the raw counts with Flagsmith's own formula. If the two disagree, it refuses to ship.
6. **The 95% interval excludes zero.**
7. **Guardrail metrics** didn't get worse.

### Two things I found about Flagsmith's numbers

**Its "chance to win" is a normal approximation on the relative lift**, not the usual Bayesian calculation. Its interval is symmetric around the lift, which gave it away. Using `Φ(lift / se)` with a delta-method standard error, I reproduce Flagsmith's figure to within 0.001 on every real result I captured ([`lib/stats.ts`](lib/stats.ts), tests in [`lib/stats.test.ts`](lib/stats.test.ts)). That is what makes check 5 possible.

**Flagsmith's two signals can disagree.** Its rollout banner suggests going ahead at a 95% chance to win. But its 95% interval only clears zero at about 97.5%. In between, Flagsmith's docs describe the same result as both ready to roll out and inconclusive. Verdict waits and says exactly why. Replay scenario D shows a real one: 96.3% win probability, interval from -3.3% to +69.6%.

## Use it on your own site

Nothing here is tied to my account. Each person connects their own project:

1. **Connect** (sidebar): paste your Flagsmith API key, environment key and project id. Optionally add your GitHub repo, the folder the agent may edit, and a free Gemini key. A **Test connection** button really calls Flagsmith and GitHub and tells you what failed. Your details are saved encrypted in a cookie in your own browser. There are no accounts and no database, and someone else on the same site sees only their own experiments.
2. **Integrate a website** (sidebar): say what you want to test, for example a white and a yellow theme against your current black one. Verdict writes the code to paste into your site, either plain HTML (one script tag, no build step) or React. Then press **Start watching**. It follows Flagsmith's event counter, which only goes up when a real browser reports a visit or a click, so you get proof that your website is connected.
3. **Agent**: ask it to set the test up. After a winner ships, the cleanup pull request is opened in **your** repository, and it can only edit files in the folder you chose.

`public/shop-example.html` is a one-file shop that uses exactly that snippet, to show it working on a normal page.

If you deploy this for several people, set `VERDICT_SECRET` and keep your own keys out of the server's environment. A visitor on a public address can never use the server's keys: the live pages show nothing and the agent refuses until they connect their own project. The agent keeps its conversations in memory, so run it on one long-lived server, not on serverless functions.

## How Flagsmith is used

Experiments, metrics and results are the product here, not a side feature.

| What | Flagsmith call |
|---|---|
| Create a multivariate flag | `POST projects/{id}/features/`, then `PUT .../mv-options/{id}/` to set each variation key |
| Create a metric | `POST environments/{key}/experiment-metrics/` |
| Create, start, pause an experiment | `POST .../experiments/`, `.../start/`, `.../pause/` |
| Complete it and set what the flag serves | `POST .../experiments/{id}/complete/` |
| Read results | `POST .../results/refresh/`, then `GET .../results/` and `.../experiments/{id}/` |
| Show the right version, count the click | JavaScript SDK: `useExperiment`, `trackEvent`, `flushEvents` |

## Try it

You need Node 22.12 or newer (I used 24). The app itself runs on Node 20.9, but the test runner needs 22.12.

```bash
git clone https://github.com/sharmaShivam23/Verdict-Ai-.git
cd Verdict-Ai-
npm ci
npm run dev
```

Open <http://localhost:3000>. **This works with no keys at all.** The dashboard starts in Replay mode, with four saved scenarios:

- **A.** 83% win probability. KEEP RUNNING.
- **B.** 98% and every check passes. SHIP.
- **C.** Looks like a big win, but visitors were split 500 to 380 instead of evenly. INVALID.
- **D.** 96%, which clears Flagsmith's banner, but the interval still includes zero. KEEP RUNNING.

To use more, copy `.env.example` to `.env.local` and add keys:

| You want | You need |
|---|---|
| Replay dashboard | nothing |
| Live dashboard (your own experiments) | Flagsmith API key, environment key, project id |
| The agent page (`/agent`) | the above, plus a free [Gemini key](https://aistudio.google.com) |
| The demo page (`/demo`) | the Flagsmith environment key again, as `NEXT_PUBLIC_...` |
| Several people on one deployment | `VERDICT_SECRET`, a long random string, so saved connections stay valid |
| Cleanup pull requests | `GITHUB_TOKEN` and `GITHUB_REPO` (without them the agent shows the diff) |

Your Flagsmith account needs Experimentation, which is in beta. It was available on mine.

Pages: `/` experiments and verdicts, `/agent` the agent, `/integrate` code for your own website, `/connect` your keys, `/demo` a small store.

```bash
npm test          # unit tests
npm run typecheck
npm run lint
npm run build
```

## What is real and what is not

I'd rather say this plainly than have you find it.

- **The traffic in my demos is simulated.** Nobody else used this, so a script sends fake visitors (all named `sim-...`). The screens say SIMULATED TRAFFIC, and so does every pull request the agent opens. The numbers are real Flagsmith output for those visitors, but they say nothing about real users.
- **The website integration is real, and I tested it.** I ran the generated snippet the way a browser loads it against my Flagsmith project: the visitor was given a version, and Flagsmith's event counter rose by exactly two (one visit, one click). A one-file example shop (`public/shop-example.html`) also ran in a real browser and reported its visit. I have not yet had a stranger's real website use it.
- **Per-person connections are tested, not battle-tested.** The encryption, the session locking and the rule that strangers can't use the server's keys are covered by tests and by requests I made with a spoofed host. They have not been through a security review.
- **Replay scenarios A, B and D are real Flagsmith responses**, captured from live experiments and run through the same code as live data. **Scenario C is hand-built**, in Flagsmith's exact response shape. I couldn't get a real broken split to show up in the results, so it carries a red "CONSTRUCTED PAYLOAD" badge.
- **The cleanup only understands one pattern**: `pick(useExperiment("flag"), { control: "A", variant_a: "B" })`. It refuses anything else with a reason instead of guessing. It is a reference implementation, not a general refactoring tool, and a human still reviews the pull request. It also doesn't touch comments, so an old comment can be left behind.
- **The independent check covers two-version tests on a yes/no metric.** For anything else the dashboard says "Not audited" and why.
- **Flagsmith Experimentation is in beta.** Results lag by a minute or so and refresh at most every five minutes.
- Agent conversations live in memory and disappear on restart. That's fine for a demo and wrong for production.
- I built this alone during the hackathon, with an AI coding assistant. Everything described above is either covered by a test or was checked against live Flagsmith.

## Things I learned about Flagsmith Experimentation

If you're building on it, these cost me time:

- Creating a flag with variations drops each variation's `key`. A variation with no key records **no exposures**, with no error. Set the keys afterwards.
- `PATCH` on a variation returns HTTP 500. A full `PUT` works.
- An experiment must include **every** variation of the flag, or creation fails with "Must include all feature's variants".
- The default win-probability bar (95%) and the interval check disagree between 95% and 97.5%, as above.
- Rotating an Organisation API key invalidates the old one immediately, with a 401.

## Project layout

```
app/
  page.tsx            dashboard (live and replay)
  agent/              the chat page with approval cards
  demo/               the store page under test
  api/agent/          the agent's two endpoints (local only)
lib/
  referee.ts          the verdict and the checklist
  stats.ts            the math, including Flagsmith's formula
  replay.ts           the four replay scenarios
  flagsmith/          API client, response adapter, captured real responses
  agent/              loop, policy, tools, cleanup codemod, model adapters (Gemini, Claude)
  github/             opens the pull request
scripts/              traffic simulator, capture and setup helpers
```

## License

MIT. See [LICENSE](LICENSE).
