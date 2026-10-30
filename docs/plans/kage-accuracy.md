# Kage accuracy and reliability plan

Goal: make Kage (the local, keyless decision engine in `lib/kage/`) more accurate and its confidence honest, without adding a network call, a key, or an LLM. Kage must keep speaking Jev's `systemOne` contract (`choice` / `score` / `noul`).

Written 2026-10-30 from a read-only study of Kage. Findings and probe results are in the "Why" section at the end.

## Ground rules (re-read at every session start)

- Tune only against the `dev` split. Report `holdout`, never tune on it. Never read `blind` case by case: look at its totals only.
- The old blind split was read on 2026-10-30 while studying the misses. It is no longer blind. Task 0.1 moves it to `holdout`.
- Do not change any question or criteria text in `lib/triage/jev.ts`, `lib/jev/ask/plan.ts`, `lib/jev/ask/rank.ts`, `lib/jev/ask/catalog.ts` or `lib/rules/`. Jev reads the same text. All Kage changes stay inside `lib/kage/` or in the code that reads Kage's answer.
- Kage stays pure, synchronous and deterministic. No network and no randomness.
- The rules engine (`lib/rules/run.ts`) also asks Kage. Trash rules act at 0.85. **No change may add a trash false positive** in `lib/rules/fixtures.test.ts`.
- Label honestly: an answer Kage gave says `source: "kage"`.
- Run tests with `bun run test`, never plain `bun test`. Run the eval with `bun run eval:kage`.
- No `src/` directory. Add packages with bun if they fit.
- Every user-visible change gets a plain-English line under `## [Unreleased]` in `CHANGELOG.md`.
- At each ⛔ checkpoint: write the gate entry in the progress log, stop, and give a continuation prompt for a new session.

## Where to work

The `main` working tree has unrelated uncommitted work (attachments, compose, drafts). Do not mix with it. Once that work is committed, create a worktree on a new branch `feat/kage-accuracy` from `main`.

## Phase 0: Make the eval worth trusting

The blind split has 20 asks, 10 emails and 3 rank cases. One case moves a score by 5 to 33 points. Fix this before tuning anything.

- **0.1 Retire the read blind cases.** Relabel every current `split: "blind"` case in `test/fixtures/kage/*.ts` as `holdout`, with a comment saying it was read on 2026-10-30.
- **0.2 Write a fresh blind batch.** Use a separate agent that is **not allowed to read** `lib/kage/`, the old fixtures, or this plan's "Why" section. Give it only the intent list and criteria from `lib/jev/ask/catalog.ts`, the triage categories and rubric from `lib/triage/jev.ts`, and the fixture types. Target: 60 asks, 40 emails, 15 rank cases. Ask it for realistic, varied phrasing: short and long, casual and formal, typos, questions that name a person, human emails without keywords, and modifier plus noun questions ("unread receipts"). Then it hands back the file. The tuning agent never opens it.
- **0.3 Grow `dev`.** Add about 30 asks, 20 emails and 8 rank cases to `dev`. Aim them at the failure shapes in the "Why" section. This is the material to tune against.
- **0.4 Better report** in `lib/dev/kage-eval.ts` and the `/dev/kage` board:
  - a Wilson 95% interval next to every rate;
  - an agreement table for each kind: both right, only Kage right, only the heuristic right, both wrong;
  - calibration: expected calibration error (ECE, 10 bins) for intent and category confidence;
  - blind shows totals only by default, in both the CLI and the board. Case rows sit behind an explicit flag.
- **0.5 Regression gate.** Add a test that runs the eval on `dev` and `holdout` and fails if a metric drops below a committed baseline (`test/fixtures/kage/baseline.json`) by more than a set margin. Never gate on blind. Keep `lib/rules/fixtures.test.ts` as a second, hard gate.
- **0.6 Baseline.** Run the eval and write the numbers into the progress log.

⛔ **Checkpoint A:** the user reviews the new fixtures, the report, and the baseline.

## Phase 1: Honest confidence

Today one weak matching word can give 0.88 confidence.

- **1.1 Coverage.** In `decideChoice`, measure how much of the state's content weight the winning label explains (matched feature weight divided by total feature weight). With low coverage, pull the distribution toward the no-evidence shape, so one matched word out of three can no longer reach 0.88. Probabilities must still add up to 1.
- **1.2 Fit, don't guess.** Add `scripts/kage-fit.ts`: a grid search over `TEMPERATURE` and the new coverage strength. It minimises Brier score on `dev` and prints `holdout`. Commit the chosen values with a comment saying where they came from.
- **1.3 Tests** in `lib/kage/engine.test.ts`: a one-word partial match gives confidence below 0.6, and a question fully explained by one label stays high.
- **1.4 Check callers.** The 0.5 and 0.6 thresholds in `planAsk`, `jevTriage` and the rules engine now mean something different. Re-check them against the eval and the rules gate. Do not loosen trash.

Target: blind intent Brier clearly below the heuristic's, and ECE at or below 0.10 on holdout.

⛔ **Checkpoint B**

## Phase 2: Use the heuristic as a second opinion

`planAsk` and `jevTriage` already compute the heuristic answer, then ignore it when Kage answers. On the old held-out cases, Kage alone was right 11 times, the heuristic alone 5 times, and both were wrong only once.

- **2.1 One small helper,** `lib/kage/arbitrate.ts`. It takes Kage's label and confidence plus the heuristic's label and confidence. If they agree, keep the label with the higher confidence. If they disagree and Kage's confidence is below a threshold, use the heuristic. Otherwise keep Kage. Fit the threshold on `dev`.
- **2.2 Wire it in** only when `source === "kage"`: Ask intent in `lib/jev/ask/plan.ts`, and triage category and needsReply in `lib/triage/jev.ts`. Leave Jev answers alone.
- **2.3 Check** the agreement table: "only the heuristic right" should shrink, and "only Kage right" must not.

Decision for the user at this checkpoint: when the heuristic wins inside the Kage path, should the source still read "Kage" (it is the keyless engine as a whole), or should it read "rules"?

⛔ **Checkpoint C**

## Phase 3: Better features

- **3.1 Email shape, `lib/kage/shape.ts`.** When the state has a `from` field, add synthetic concepts:
  - `#sender_bulk`: the address part before `@` looks like a machine (noreply, no-reply, notifications, alerts, news, newsletter, marketing, deals, billing, receipts, orders, support, info, hello, team);
  - `#sender_person`: a person-like address part (`first.last`, a short name) or a personal domain (gmail, outlook, hotmail, icloud, yahoo, proton);
  - `#reply_thread`: the subject starts with `Re:`;
  - `#asks_me`: a `?` together with "you" or "your", outside of bulk mail;
  - `#when`: weekdays, times like `2pm`, and dates.

  These come from the state only. On the label side, link them through a small criteria-only word map (for example "person-to-person" and "direct" mean `#sender_person`), so words inside an email can't fake them. A spammer using a personal-looking address is honest evidence; the hostile fixtures must still pass.
- **3.2 Operator and subject concepts.** Mark `#newness`, `#unread`, `#counting`, `#top_people` and the `#time_*` concepts as operators. When a subject concept (`#money`, `#newsletter`, `#security`, `#meeting`, `#files`, `#social`, `#promo`, `#shipping`) is also in the question, scale the operators down. "unread receipts" should be about receipts. Unread-only is already its own question.
- **3.3 Label keys.** Give the label key (for example `updates`) a small weight next to the criteria text, so "updated slides" stops matching `updates`. This also takes away one way a hostile email can steer the answer.
- **3.4 Stemmer.** Replace the hand-made stemmer with Snowball (Porter2) English, from a small package, plus an exception list (`news` must not become `new`, `late` must not equal `lately`). Kage runs only on the server, so bundle size is not a concern.
- **3.5 Lexicon audit,** `scripts/kage-lexicon-audit.ts`. List every stem used by more than one concept, and every concept term that is also a stopword. Fix the ones it flags. Known so far: `account`, `free`, `down`, `code`, `call`, `save`, `connect`.

⛔ **Checkpoint D**

## Phase 4: Urgency as a scale

Kage has worse urgency error than the heuristic on every split (blind MAE 0.232 vs 0.200). It treats the four rubric levels as separate labels and matches their wording, and "can wait a week" shares words with "this week".

- **4.1** In `decideScore`, treat the levels as an ordered scale. Build "at least level k" evidence, add it up across levels, and map it through fitted cut points (a cumulative logit). Shape features can cap it: bulk senders rarely go above level 1.
- **4.2** Fit the cut points on `dev`.

Target: urgency MAE below the heuristic on holdout.

⛔ **Checkpoint E**

## Phase 5: Reliability

- **5.1 Shorter wait for interactive asks.** Today a Jev outage can stall an Ask for about 16 seconds (8 s timeout plus 1 retry) before Kage answers. Give interactive paths (Ask) a deadline of about 3 seconds before falling back to Kage. Background triage keeps the longer timeout. Do not build a "show Kage, then swap in Jev" upgrade; it is not worth the extra moving parts yet.
- **5.2 Visible fallback.** When Jev fails and Kage answers, log the reason class once per process (auth, rate limit, timeout, network) and keep a counter. Show it on `/dev/kage` and in `JevStatus`. The 403 server key went unnoticed for days.
- **5.3 Cache compiled criteria.** Cache the features of criteria text by string (small LRU), so bulk triage stops re-tokenizing the same labels.
- **5.4** Make sure the Phase 0 gate runs in `bun run test`.
- **5.5** Add the changelog line, update the Kage memory note with the new blind numbers, and fill in the final gate entry.

⛔ **Checkpoint F (done)**

## Not in this plan

- **Learned weights.** Once the TypeSafe key works again, run Jev over a public corpus (Enron) plus made-up questions to get silver labels. Then fit Kage's weights offline and ship them as JSON. Kage stays local and keyless. This needs a working key, so it waits.
- Embeddings, an LLM adapter, and languages other than English.

## Why (findings from 2026-10-30)

Do not show this section to the agent writing the fresh blind batch.

Old blind numbers (before this plan): intent 17/20 (heuristic 13/20), intent Brier 0.141 (heuristic 0.145, Kage on dev 0.059, so it was overfit), category 8/10, needsReply 9/10 (heuristic 10/10), urgency MAE 0.232 (heuristic 0.200).

Probe results:

| Input | Kage answer | Cause |
|---|---|---|
| "which threads am I late on" | `unread_summary` 0.88 | `late` and `lately` stem the same, which hits `#time_recent` in the unread_summary criteria. One weak word gave 0.88. |
| "unread receipts" | `unread_summary` 0.78 | The modifier beat the noun. |
| "which newsletters pile up the most" | `top_contacts` 0.65 | "the most" hit `#top_people`. |
| "did I get the signed NDA back" | `security` 0.49 | `signed` became `sign`, which matched "sign-ins". |
| "Are we still on for Thursday?" (human sender) | `other` 0.68 | No lexicon words, so the "none" label's head start won. |
| "FYI: updated slides" | `updates` 0.73 | The label key `updates` matched "updated". |

Other stem collision: `news` became `new`, so `news@` senders hit `#newness`.

## Progress log

| Date | Task | Result |
|---|---|---|
| 2026-10-30 | Plan written | Study only, no code changed |
| 2026-10-30 | 0.1 | 20 asks, 10 emails, 3 searches moved from blind to holdout, each with a comment (this row said 21 asks until the review on 2026-10-30 counted 20) |
| 2026-10-30 | 0.2 | Fresh blind batch in `test/fixtures/kage/blind/` (60 asks, 40 emails, 15 searches), written by a separate agent that never saw `lib/kage/`. That agent later audited its own indexes and labels: no bugs. The tuning side has not read the cases. |
| 2026-10-30 | 0.3 | Added to dev: 31 asks, 21 emails, 8 searches, aimed at the failure shapes in "Why" |
| 2026-10-30 | 0.4 | `lib/dev/kage-stats.ts` (Wilson interval, ECE, agreement). Report schema 2: `intentEce`, `categoryEce`, `agreement`, `blindHidden`. CLI prints intervals, agreement and a baseline check; `--reveal-blind`, `--write-baseline`. Board shows interval bands, both ECE rows, a "Kage vs keywords" card, and seals the blind case list. |
| 2026-10-30 | 0.5 | `test/fixtures/kage/baseline.json` pinned; gate in `lib/dev/kage-eval.test.ts` (rate drop > max(1 case, 3 pts) or error rise > 0.02 fails; blind never gated). Runs in `bun run test`. |
| 2026-10-30 | 0.6 | Baseline below. `bun run test` on the eval, Kage and rules fixtures: 33 pass. `bun run typecheck` and eslint on touched files: clean. |
| 2026-10-30 | ⛔ A | **Waiting for user review.** Nothing committed; all work is uncommitted in the worktree. |
| 2026-10-30 | ⛔ A passed | User reviewed Phase 0 and started Phase 1. |
| 2026-10-30 | 1.1 | `decideChoice` now scores every choice first, then pulls the winner towards an even spread by `coverage^strength` (`KageTuning` in `lib/kage/engine.ts`, passed to `decide` as an optional second argument). An even spread, not the no-evidence shape: the first try spread towards "none", which then won and cost dev intent 86% → 61%. Even spreading can't change the answer. Coverage = the winner's matched weight over the state's weight, where a word a rival label claims always counts against it, a word only a sibling question's answer (or a rubric / yes-no's wording) explains is left out, and a word nothing claims counts by the fitted `unknown`. Siblings count by their chosen label, not all labels: the sender question's 60 contacts (`receipts@stripe.com`, "Lenny's Newsletter") would otherwise excuse "invoices" and "newsletters". Also new: `none`, the share a winning "none of these" keeps. It wins on a head start with no evidence, yet said 0.68; on dev that was wrong 5 of 5 times for emails and 2 of 4 for asks. `lib/kage/text.ts` gained `conceptsOf(stem)`. |
| 2026-10-30 | 1.2 | `scripts/kage-fit.ts`: grid of 1008 settings over temperature, coverage strength, `unknown`, span and `none`; Brier on dev (intent and category averaged). It never imports blind. Thrown out: a trash false positive, any new rules false positive or lost true positive, or a worse dev intent Brier than before. Left free, the grid drove temperature to its floor (0.5) and the dev winner got worse on holdout (Brier 0.076 → 0.084) and lost 6 rules hits. So the winner is the warmest setting within one standard error of the best dev Brier (0.125 ± 0.021). With the pull on, that is `{T 2, coverage 0.5, unknown 0, none 0.25}`: dev 0.159 → 0.138, but holdout intent ECE 0.071 → 0.129, which fails the Phase 0 gate (and the ≤ 0.10 target). **Committed with the pull off: `{T 2, coverage 0, none 0.5}`**, dev 0.159 → 0.142 (category 0.178 → 0.146), holdout 0.076 → 0.075. The pull is built and tested, one setting away. Selection rule order, for the record: lowest Brier first, then "smoothest" (which treated the pull as complexity; it is shrinkage, so that was wrong), then warmest. Holdout was printed for each; the gate, not holdout, made the final cut. |
| 2026-10-30 | 1.3 | 5 tests in `lib/kage/engine.test.ts` ("honest confidence"): a head-start "none" is under 0.5; a fully explained question stays above 0.8 with or without the pull; with the pull on, one matched word among unexplained ones drops under 0.6 without changing the answer (probabilities still sum to 1); a rival-claimed word counts even when `unknown` is 0; a word a sibling question explains isn't held against the winner. |
| 2026-10-30 | 1.4 | Callers checked. Ask's "unsure" at 0.5 (`lib/jev/ask/answer.ts:57`) only adds "Not quite? Try one of these" chips; the answer still shows. Shipped setting: same chips as before for non-"other" intents ("other" already counted as unsure). With the pull on, dev at 0.5 would add chips to 4 more right answers and to no wrong one; at 0.4 it would match today. Left at 0.5. The 0.5 / 0.8 sender thresholds in `planAsk` read the sender answer, which the Kage path ignores. `unreadOnly` and `needsReply` (0.6) are yes/no answers this phase didn't touch. Triage confidence is only shown. Rules: 25 tp / 5 fp / 0 trash, unchanged, `lib/rules/fixtures.test.ts` untouched. Not loosened. A head-start "none" in a rules call now spreads half its mass evenly, which adds at most 0.5 / 11 ≈ 0.05 to a rule. |
| 2026-10-30 | Checks | `bun run test`: 2039 pass, 0 fail. `bun run typecheck` and eslint on `lib/kage` and the fit script: clean. Eval: baseline holds. Changelog line under Unreleased. Baseline file not re-pinned (see the decision below). |
| 2026-10-30 | ⛔ B | **Waiting for user review.** Nothing committed; all work is uncommitted in the worktree. |
| 2026-10-30 | ⛔ B passed | User decisions: keep the coverage pull off (rerun `scripts/kage-fit.ts` after 3.2); re-pin the baseline now. Search gap still open. |
| 2026-10-30 | Re-pin | `bun run eval:kage --write-baseline`: `baseline.json` now holds the Checkpoint B numbers (dev intent Brier 0.138, ECE 0.143, category ECE 0.154; holdout intent ECE 0.071, category ECE 0.088). The gate now guards the category ECE gains. |
| 2026-10-30 | 2.1 | `lib/kage/arbitrate.ts`: `arbitrate(kage, heuristic, threshold)` as the plan says (agree: the higher confidence; disagree and Kage below the threshold: the heuristic, with its own confidence). `noulConfidence` turns a yes/no into Kage's confidence (`noul`, or `1 − noul` below the 0.6 cut). `ARBITRATION` holds one threshold per question. Override confidence: the heuristic's own number, or Kage's? Tried Kage's on dev only (category at 0.45): Brier 0.149 → 0.151, ECE 0.134 → 0.161. Kept the heuristic's. |
| 2026-10-30 | 2.1 fit | `scripts/kage-fit-arbitrate.ts`: thresholds 0 to 0.95 in steps of 0.05, one question at a time, by dev accuracy. The lowest threshold within one paired standard error of the best wins. A threshold is thrown out if it raises dev ECE by more than 0.02. Holdout is printed only for the chosen setting. **Intent: 0.** The heuristic is right alone on 6 dev asks, and Kage is very sure on 5 of them (0.90 to 1.0: "unread invoices", "unread newsletters", "which promos do I get the most", "any news on the launch", "emails I sent to Jonas"). Those are Phase 3.2's operator mix-ups. Where Kage is unsure (0.37), the heuristic's fallback `find_topic` is wrong ("tell me a joke"). Every threshold above 0 costs dev accuracy. **needsReply: 0.6**, dev 84% → 87%, holdout 96% → 100%. **Category: fit chose 0.45**, dev 76% → 80%, ECE 0.166 → 0.134 (the heuristic's "primary" beats Kage's evidence-free `other@0.41` on mail between people). The best dev accuracy was 84% at 0.9, but that is inside one standard error. |
| 2026-10-30 | 2.1 gate | Category at 0.45 fails the regression gate: holdout category ECE 0.088 → 0.111 (margin 0.02), even though holdout Brier improves (0.056 → 0.048) and holdout accuracy stays at 25/27. Same choice as Checkpoint B: **committed with category at 0**, and 0.45 is one setting away. The 0.45 eval run also printed blind totals, which the CLI shows by default. They are not in this log and played no part in the choice. |
| 2026-10-30 | 2.2 | Wired in only when `source === "kage"`. `planAsk` arbitrates intent before the sender rule (a named contact still turns generic intents into `from_person`). `jevTriage` computes the heuristic only on the Kage path, then arbitrates category and needsReply. Urgency is left for Phase 4. The result still says `source: "kage"` (the decision is below). Both take an optional thresholds argument for the fit script. Jev answers are never arbitrated. 8 tests in `lib/kage/arbitrate.test.ts`: the helper, `noulConfidence`, and the wiring through a fixed client stamped `kage-1` vs `jev-1`. The rules engine calls Kage directly, so it never goes through arbitration: rules stay at 25 tp / 5 fp / 0 trash. |
| 2026-10-30 | 2.3 | Agreement table for the committed setting: no change on any split (both thresholds that could move it are at 0; the mail row counts category and needsReply together, so the needsReply gain shows in the metric only). With category at 0.45 (dev, holdout): "only keywords" mail 6 → 4 and 2 → 1, but **"only Kage" also shrank**, 8 → 7 and 3 → 2 (dev: "Disk usage above 90%", Kage `updates@0.39`, went to the heuristic's wrong "primary"). So 0.45 also fails 2.3's "must not shrink". |
| 2026-10-30 | Checks | `bun run test`: 2047 pass, 0 fail. `bun run typecheck` and eslint on the touched files: clean. Eval: baseline holds. Changelog line under Unreleased. Note: `scripts/kage-fit.ts` scores through `planAsk` and `jevTriage`, so its next run (after 3.2) measures Kage with arbitration on. |
| 2026-10-30 | ⛔ C | **Waiting for user review.** Nothing committed; all work is uncommitted in the worktree. |
| 2026-10-30 | ⛔ C passed | User decisions: source stays `"kage"` (no code change); category arbitration stays 0, rerun `scripts/kage-fit-arbitrate.ts` after 3.1; re-pin the baseline now. |
| 2026-10-30 | Re-pin | `bun run eval:kage --write-baseline`: `baseline.json` now holds the Checkpoint C numbers (dev intent Brier 0.125, holdout 0.085; holdout intent ECE 0.088, dev category ECE 0.166). |
| 2026-10-30 | 3.1 | `lib/kage/shape.ts`: `senderKind` (bulk / person / role / unknown, from the address part, bulk platforms like Substack, and personal domains) and `shapeFeatures` → `#sender_bulk`, `#sender_person`, `#reply_thread`, `#asks_me`, `#when`, only for a state with a `from` field. A bulk sender never gets `#reply_thread` or `#asks_me` ("RE: RE: your invoice", "quick question: are you free?"). Label side: `shapeLinks`, a short word list ("direct", "person to person", "correspondence", "automated", "question", "meeting"…), matched as words, not stems; applied only when the state has a shape. Role addresses (legal@, status@, security@) are neither bulk nor a person. `weight()` now counts a feature below one hit linearly (it went negative before; no existing value was below 1). New `KageTuning.shape` scales the state side. Swept on dev: rules fp rises above 2.5 (6 at 3, 7 at 4), best allowed dev category Brier 0.090 ± 0.028 at 2.5; the smallest weight inside one SE is **1** (0.117), which also had the lowest ECE and fewest rule misfires. Dev category 76% → 82%, Brier 0.144 → 0.117, ECE 0.166 → 0.089, needsReply 39 → 40 of 45 (gains "Weekend plans?", loses "Re: hiring plan" and "Re: venue": `#reply_thread` meets "direct conversation" in the yes criteria). Hostile 4/6 dev and 5/5 holdout, unchanged (the two dev misses, cheapmeds and "Personal note from Anna", were misses before). Holdout (report only): category 93% → 96%, Brier 0.056 → 0.037, ECE 0.088 → 0.091, needsReply 27 → 26 of 27. Rules: 25 tp / 5 fp / 0 trash → 25 / 2 / 0 (GitHub misfires on people's mail 5 → 2); `lib/rules/fixtures.test.ts` re-pinned for that gain. 9 tests in `lib/kage/shape.test.ts`. |
| 2026-10-30 | 3.1 refit | `bun scripts/kage-fit-arbitrate.ts` after 3.1: intent 0, **category 0** (0.45 now 36/45 vs 37/45 at 0), **needsReply 0** (0.6 scores the same, 40/45 dev and 26/27 holdout; the fit takes the lowest). `ARBITRATION` is now `{ intent 0, category 0, needsReply 0 }`: the heuristic never overrules Kage; agreement still lifts confidence. |
| 2026-10-30 | 3.2 | Operators (`#newness`, `#unread`, `#counting`, `#top_people`, `#time_*`, and any word that raises only those, like "unread" or "most") count for `KageTuning.operator` of their weight in a choice where the state names a subject (`#money`, `#newsletter`, `#security`, `#meeting`, `#files`, `#social`, `#promo`, `#shipping`) that one of that choice's labels is about. Per choice, so the timeframe question (no subject labels) still reads "this month" at full weight. Swept on dev: intent Brier 0.125 at 1, 0.112 at 0.75, 0.090 at 0.5, 0.087 ± 0.025 at 0. **Chose 0.5**: the mildest damping that reaches the best dev accuracy (86% → 90%), inside one SE of the best. 0.75 sat on the window's edge and fixed no answers. Fixed on dev: "unread invoices", "unread newsletters", "which promos do I get the most", and one more. Triage and rules unchanged at every value. Holdout (report only): intent 91% → 96%, Brier 0.085 → 0.064, ECE 0.088 → 0.101 (inside the margin). 3 tests in `lib/kage/engine.test.ts` ("operators and subjects"). |
| 2026-10-30 | 3.2 fit | `bun scripts/kage-fit.ts` (coverage pull), now holding `shape` and `operator` at their committed values and comparing against the committed settings, not pre-Phase-1 Kage (otherwise it could hand back the GitHub misfires 3.1 removed). Only the committed setting survives. The Checkpoint B pull `{ coverage 0.5, unknown 0, none 0.25 }` now makes asks worse (dev intent Brier 0.093 → 0.100, ECE 0.118 → 0.150) for a small category gain (Brier 0.113 → 0.110) and one fewer rule misfire. **Pull stays off.** Temperature 1.75 to 2.5 all score within 0.001 on dev intent; 2 stays. |
| 2026-10-30 | 3.3 | A label's key now counts `KageTuning.labelKey` of its criteria next to them (merged as its own features, not glued into the criteria text). Choosing it needed 3.4 and 3.5 first: before them, any weight below 0.5 lost "is there anything I need to sign today" to `security`, held up only by the key "needs_reply" against the `sign` / "sign-ins" collision. Final sweep after 3.5 (dev, intent and category Brier averaged): 0.103 at 0, 0.101 at 0.1, **0.098 at 0.25**, 0.099 at 0.5, 0.101 at 1, all inside one SE. **Chose 0.25**, the lowest dev Brier and a small weight as the plan asks. Dev intent 92% (94% at 1, 92% at 0.1), category 82%. "Updated contract attached" (dev) and "FYI: updated slides" (holdout) still go to `updates`: only a weight of 0.1 or less frees them, and that costs a category Brier point. Rules unchanged at every value. |
| 2026-10-30 | 3.4 | `wink-porter2-stemmer@2.0.1` (MIT, 0 deps, 27 KB, unchanged since 2019). Read in full before install: pure regexes, no install scripts, no network, no worm markers; lockfile sha512 matches the registry and the installed file is byte-identical to the one read. Types in `lib/kage/wink-porter2-stemmer.d.ts`. `stem()` keeps numbers as written, then exceptions, then Porter2, behind a memo (cleared at 20,000 words): the regex chain doubled Kage's latency (p50 0.93 → 1.79 ms), the memo brought it to about 1.1 to 1.5 ms. Exceptions: `news` (Porter2 already keeps it), `lately` (else "late"), `following` (else `follow`, which made "the following event" in a calendar invite look `social`). Dev with 3.4 alone: "any news on the launch" fixed; rank top-1 58% → 67%, top-3 83% → 92%; Porter2 also merged "confirmed" with "order confirmations", which put a hotel booking on the receipts rule (fixed in 3.5). |
| 2026-10-30 | 3.5 | `scripts/kage-lexicon-audit.ts`: lists one-word stems that raise more than one concept, stems a one-word term shares with another concept's phrase (coverage only), and one-word terms that are stopwords. Exits 1 on anything not on its reviewed list, with a reason per entry. Fixed: `account` (no longer a bare `#system_notice` word), `confirm` (phrases on both sides: "please confirm" vs "order confirmation"), `regard` (sign-offs as phrases), `free` ("are you free"), `down` ("is down"), `call` ("a call", "phone call"), `save` ("and save"), `connect` ("wants to connect"). Reviewed and kept: `market`, `notif`, `receipt`, `unsubscrib`, `unread`, `thought`, `tonight`, and stopword terms `from`, `please`, `got`, `received`. **`code` kept as is**, with a note in the lexicon: dropping it, or adding it to `#promo` too, let the keyword-stuffed hostile e3 ("security alert sign-in code discount sale…") clear the security rule at 0.98; the shared stem between "discount codes" and "sign-in codes" is what keeps those rules competing. Also in `normalize()`: "sign-in(s)", "signed in", "log in" are joined (`signin`, `login`), so "did the signed lease come back" no longer raises `#security`; and "pull request(s)" / "merge request" are joined, so GitHub's criteria no longer raise `#request`. That join was load-bearing: with it, the old `confirm` entry had the receipts rule absorbing people's requests (5 false positives); the `confirm` fix and the join need each other. `#when` lost its label links ("bookings", "meeting"…): "flight, hotel and train bookings" claimed every email that names a weekday (3 travel false positives on people's mail), and a trash rule about "calendar invites" would do the same. `#when` stays a state feature for Phase 4. Rules after 3.5: **26 tp / 0 fp / 0 trash** (Phase 3 start: 25 / 5 / 0). |
| 2026-10-30 | Checks | `bun run test`: 2062 pass, **1 fail: the eval gate, holdout intent ECE 0.088 → 0.137** (margin 0.02). Everything else holds, including `lib/rules/fixtures.test.ts` (re-pinned for gains only: GitHub fp 5 → 0, travel tp 2 → 3; "people's mail clears no rule" replaces the test that needed GitHub misfires to exist) and every hostile fixture that passed before. `bun run typecheck` and eslint on `lib/kage`, the three Kage scripts and the rules test: clean. Lexicon audit: all reviewed. Changelog: three new lines, and the Phase 2 line rewritten (it said the word rules overrule Kage on needsReply, which is no longer true). |
| 2026-10-30 | ⛔ D | **Waiting for user review.** Nothing committed; all work is uncommitted in the worktree. The baseline was not re-pinned (decision 1 below). |
| 2026-10-30 | ⛔ D passed | User decisions: re-pin the baseline now; `labelKey` stays 0.25; do the intent calibration in `planAsk` now, as a Phase 4 pre-task. |
| 2026-10-30 | Re-pin | `bun run eval:kage --write-baseline`: `baseline.json` now holds the Checkpoint D numbers (dev intent Brier 0.080, ECE 0.132; holdout intent ECE 0.137, category ECE 0.104). The gate is green again. |
| 2026-10-30 | 4.0 | Intent calibration. `lib/kage/calibrate.ts`: `sharpen(probabilities, power)` raises each probability to `power` and renormalises (temperature scaling after the fact; the order never changes, so no answer changes). `planAsk` applies `INTENT_POWER` to Kage's intent probabilities only (the confidence and the "Not quite?" alternatives), before the second opinion. Jev answers are left alone, and so are rules and triage, which share Kage's temperature. `planAsk`'s fifth argument is now an options object `{ arbitration, intentPower }`. `scripts/kage-fit-calibrate.ts`: powers 0.5 to 3.5 by 0.1, scored through `planAsk` by dev intent Brier; one number that can't change an answer, so the lowest Brier wins outright. **Chose 1.7**: dev Brier 0.080 → 0.068, ECE 0.132 → 0.074, mean confidence 0.835 → 0.899 against 92% right; 1.5 to 1.9 all within 0.001. Holdout (report only): Brier 0.055 → 0.036, ECE 0.137 → 0.068. The "Not quite?" chips (confidence < 0.5, or `other`) are unchanged on dev: 4 of 6 wrong asks and the same 5 right ones still get them. A winning `other` now reads about 0.73 instead of 0.37, but `other` always shows the chips. 5 tests in `lib/kage/calibrate.test.ts`. |
| 2026-10-30 | 4.1 | `decideScore` is now a cumulative logit. Each level's BM25 match is evidence for that level *or above*: P(≥ k) = σ(slope × (evidence for k and up − floor × "can wait" evidence) + when + asks − bulk − cut_k), with `bulk` only on the steps from level 2 up. The score is the expected level; P(≥ k) is clamped to fall with k, so no level's share goes negative. `ScaleTuning` (`cuts`, `slope`, `floor`, `when`, `bulk`, `asks`) is a new `KageTuning.scale`. A longer rubric repeats the last cut gap. `#when` and `#sender_bulk` are the plan's state features. **Added beyond the plan: `asks`** (`#asks_me`, a question put to the reader), because person mail labelled level 1 had no rubric words at all ("Are you around Friday?", "quick one"). `rubricEvidence` and `scaleLevels` are exported for the fit. The old softmax (`FLOOR_BASE`, `SCORE_TEMPERATURE`) is gone. Rules don't ask `score` questions, so they can't move (26 / 0 / 0, `lib/rules/fixtures.test.ts` untouched). |
| 2026-10-30 | 4.2 | `scripts/kage-fit-urgency.ts`. Reads each dev email once through `jevTriage` (a client that records the request), then sweeps the scale on that evidence (1.4 M settings in about 40 s), and checks the winner end to end. It prints MAE, **ordering** (share of pairs with different labels put the right way round) and Ask's **"anything pressing"** filter (urgency ≥ 0.5 vs. labels ≥ 2). What the sweeps showed: (1) every engine orders urgency close to chance on dev (keywords 0.514, Kage before Phase 4 0.489), and **"always 0" beats them all on MAE** (dev 0.133, holdout 0.173); (2) the lowest dev MAE has no interior optimum: pushing the grid out kept lowering dev MAE (0.142 → 0.127 → 0.121) by holding mail at 0 harder, while holdout MAE rose (0.168 → 0.178) and the filter went silent (0 of 4 pressing dev emails). Rule used: throw out settings that make "anything pressing" lose a hit or gain a false alarm vs. Kage before Phase 4 (rebuilt in the script from the same evidence; it matches the eval's 0.212 / 0.259), then within one paired SE of the best dev MAE take the **mildest** (lowest first cut, the one that holds evidence-free mail down least; then fewest terms; then MAE), like `kage-fit.ts`'s "warmest". Two rules tried and dropped first: "fewest active terms" (picked a near-silent setting, ordering 0.46) and "best ordering in the window" (chased noise and let the spam "final notice" through as pressing). **Committed `{ cuts [3, 3.5, 4], slope 0.5, floor 6, when 0, bulk 8, asks 2 }`**: dev MAE 0.212 → 0.133, ordering 0.489 → 0.691, pressing 1/4 hit with 3 → 0 false alarms. `bulk 8` is the plan's cap made literal (bulk mail stays at level 1 or below). `floor 6`, `bulk 8` and `asks 2` sit on the grid's top edge; `when` didn't earn a place. Holdout (report only): MAE 0.259 → **0.172** (keywords 0.197 ✓ target; always-0 0.173), ordering 0.469 → 0.611 (keywords 0.528), pressing 1/3 hit with 3 → 0 false. 5 tests in `lib/kage/engine.test.ts` ("urgency as a scale"). |
| 2026-10-30 | Checks | `bun run test`: 2073 pass, 0 fail (the eval gate holds against the Checkpoint D pin). `bun run typecheck` and eslint on `lib/kage`, `plan.ts`, `jev.ts` and the new fit scripts: clean. `bun scripts/kage-lexicon-audit.ts`: all reviewed (no lexicon edits this phase). Hostile: dev 4/6, holdout 5/5, unchanged. Changelog: two new lines (Ask's %, urgency as a scale). |
| 2026-10-30 | ⛔ E | **Waiting for user review.** Nothing committed; all work is uncommitted in the worktree. The baseline was not re-pinned after 4.0 to 4.2 (decision 1 below). |
| 2026-10-30 | ⛔ E passed | User decisions: re-pin the baseline; accept the committed urgency fit rule (pressing guard, mildest within one paired SE); keep `asks`, remove the unused `when` term; leave urgency evidence ("running late", "disk usage", "can't log in") for the learned weights, no lexicon work now. |
| 2026-10-30 | `when` removed | `ScaleTuning.when` and `ScaleEvidence.when` are gone from `lib/kage/engine.ts`, and `scripts/kage-fit-urgency.ts` no longer sweeps it (grid 1.4 M → 175 k settings). The `#when` shape feature stays (Phase 3.1, still a state feature). It was 0, so every eval number is unchanged. Also fixed a type error in the Phase 4 test "levels are a distribution" (`bun run typecheck` failed on an array of mixed state shapes; the Phase 4 check had run tsc before that test was finished). |
| 2026-10-30 | Re-pin | `bun run eval:kage --write-baseline`: `baseline.json` now holds the Checkpoint E numbers (dev intent Brier 0.068, ECE 0.074; holdout intent ECE 0.068, urgency MAE 0.172). |
| 2026-10-30 | 5.1 | `withKageFallback(client, { deadlineMs, onFallback })` in `lib/kage/index.ts`. The deadline covers the whole call, retries included (the SDK's own `timeout` is per attempt with no total budget): an `AbortSignal.timeout` joined with the caller's signal. When it fires, Kage answers. After one miss the same client skips Jev, and `jevFor` builds one client per request, so an Ask (plan, then rank) waits about 3 s at most, not 3 s per call. The caller's own abort still throws and doesn't count as a miss. `jevFor(session, { interactive: true })` sets `INTERACTIVE_DEADLINE_MS = 3_000`; only `lib/jev/ask/pipeline.ts` passes it. Triage and rules keep the 8 s timeout and its retry. No "Kage first, then swap in Jev". With `KAGE=off` the deadline still holds, and the callers' `catch` falls back to heuristics. 4 tests in `lib/kage/index.test.ts`. (bun's `rejects` spin after an abort bit once; the tests use `.catch`.) |
| 2026-10-30 | 5.2 | `lib/jev/fallbacks.ts`: `fallbackReason` (auth, rate_limit, timeout, network, server, other; timeout is checked before network, since `APITimeoutError` is a connection error), counts per API key (bounded at 100, like the key-health cache) and for the process, and a `console.warn` once per reason per process, with the error class and status only, never the key. A key `jevFor` skips as rejected counts too, as `auth`, so a dead key keeps counting after the first 403. It sits outside `lib/jev/client.ts` because `test/setup.ts` mocks that module for every test. Shown in two places: `JevStatus.fallbacks` (optional; that key's own count: a user key's count is that user's alone, but every user on the server key shares one count, last reason and time), which Settings adds to the Jev line ("Since this server started, Kage answered 3 times instead, last because Jev took too long"); and a live "Jev fallbacks" card on `/dev/kage`, by reason, from the running server, not the eval report. 3 tests in `lib/jev/fallbacks.test.ts`. |
| 2026-10-30 | 5.3 | LRU of compiled criteria in `lib/kage/engine.ts` (1024 entries): rubric levels, yes/no instructions, criteria with and without shape links, and each label's finished doc (keyed by shape, `labelKey`, label and text, so a fit script's other `labelKey` never reads a stale doc). Cached maps are shared, so the builders write into fresh maps; nothing writes to a cached one. Every eval number is unchanged; Kage latency p50 1.1 → 0.2 ms, p95 1.9 → 0.5 ms (dev). 2 tests: a warm cache answers the same as a cold one for shaped and plain states, and a different `labelKey` isn't served from another's entry. |
| 2026-10-30 | 5.4 | The gate (`lib/dev/kage-eval.test.ts`) runs in `bun run test` (`bun test --isolate` picks it up; seen in the full run). It now also proves it closes: a baseline slightly better than today (dev intent all right, holdout urgency MAE 0.05 lower) fails on exactly those two metrics. Blind is still never gated. |
| 2026-10-30 | 5.5 | Changelog: two lines (Ask's shorter wait, the fallback count in Settings). A third line on the speed-up was dropped in review: "remembers the questions it has already read" read as keeping what people ask (the cache holds only fixed criteria text), and 1 ms is not something a user feels. Kage memory note updated with the final blind totals. |
| 2026-10-30 | Checks | `bun run test`: **2081 pass, 6 todo, 0 fail** (132 files), including the eval gate and `lib/rules/fixtures.test.ts` (untouched this phase; no lexicon edits, so no trash false positives to bisect). `bun run eval:kage`: baseline holds; no metric moved in Phase 5. `bun scripts/kage-lexicon-audit.ts`: all reviewed. `bun run typecheck`: clean. eslint on every touched file: clean. Hostile: dev 4/6, holdout 5/5, unchanged. |
| 2026-10-30 | ⛔ F | **Plan done.** Nothing committed; all work is uncommitted in the worktree. |

### Results at Checkpoint F (final)

Accuracy is as at Checkpoint E: Phase 5 changed no answer. Start of plan (Checkpoint A) → end:

| Metric | Dev A → F | Holdout A → F | Blind A → F (totals only; keywords) |
|---|---|---|---|
| Ask intent | 86% → 92% | 91% → 98% | 88% → 88% (73%) |
| Intent Brier | 0.139 → 0.068 | 0.094 → 0.036 | 0.108 → 0.082 (0.136) |
| Intent ECE | 0.126 → 0.074 | 0.071 → 0.068 | 0.128 → 0.087 (0.194) |
| Triage category | 76% → 82% | 93% → 93% | 63% → 68% (70%) |
| Category ECE | 0.167 → 0.100 | 0.095 → 0.104 | 0.277 → 0.129 (0.209) |
| Needs reply | 84% → 91% | 96% → 100% | 80% → 85% (80%) |
| Urgency MAE | 0.212 → 0.133 | 0.259 → 0.172 | 0.289 → 0.222 (0.284) |
| Rank top-1 / top-3 | 58% / 83% → 67% / 92% | 100% / 100% → same | 8% / 25% → 8% / 25% (8% / 33%) |
| Rules tp / fp / trash fp | 25 / 5 / 0 → 26 / 0 / 0 | | |
| Latency p50 | 0.93 ms → 0.2 ms | | |

Still open, outside this plan: the search gap (blind rank top-1 8%; needs learned weights or local embeddings), blind category still below the keywords (68% vs 70%), hostile dev 4/6, and urgency evidence for person and ops mail. All of these wait for the learned weights, which need a working TypeSafe key.

### Results at Checkpoint E (Kage: `INTENT_POWER 1.7`, `scale` as committed; all else as at D)

| Metric | Dev D → E | Holdout D → E | Blind D → E (totals only) |
|---|---|---|---|
| Ask intent | 92% → 92% | 98% → 98% | 88% → 88% |
| Intent Brier | 0.080 → **0.068** | 0.055 → **0.036** | 0.085 → 0.082 |
| Intent ECE | 0.132 → **0.074** | 0.137 → **0.068** | 0.137 → 0.087 |
| Urgency MAE (keywords) | 0.212 → **0.133** (0.178) | 0.259 → **0.172** (0.197) | 0.289 → 0.222 (0.284) |
| Urgency ordering (keywords) | 0.489 → 0.691 (0.514) | 0.469 → 0.611 (0.528) | not computed |
| "Anything pressing" hits, false alarms | 1/4, 3 → 1/4, 0 | 1/3, 3 → 1/3, 0 | not computed |
| Category, needsReply, rank, rules | unchanged | unchanged | unchanged |

Blind totals are printed by the eval by default; they played no part in any choice.

Decisions for the user:

1. **Re-pin the baseline?** Every gated metric improved or held, so the gate passes against the D pin. Re-pinning locks in the intent ECE (0.137 → 0.068 holdout) and urgency MAE gains, so later phases can't quietly spend them. Suggestion: re-pin.
2. **The urgency fit rule and its edges.** Plain "lowest dev MAE" is what the plan says, but it has no interior optimum and goes silent (see 4.2). The committed rule adds the "pressing" guard and takes the mildest in the window. `floor`, `bulk` and `asks` sit on the grid's top edge. Accept, or prefer a plainer rule? Also: keep `asks` (added beyond the plan) and the unused `when` term (0), or drop `when` from the code?
3. **Urgency's real limit is evidence, not the scale.** Dev level-2 mail like "Running 10 min late", "Disk usage above 90%" and "Can't log in to staging" has no rubric words, so no setting can lift it. Lifting it needs lexicon terms aimed at urgency (risky: the `late` / `lately` and `code` webs) or the learned weights. Holdout MAE is now under the keywords, but only just under "always 0" (0.172 vs 0.173). The real gains are the ordering and no spam in "pressing".
4. Still open: the search gap (blind rank top-1 8%), and hostile dev 4/6.

### Results at Checkpoint D (Kage, committed `{ T 2, none 0.5, shape 1, operator 0.5, labelKey 0.25 }`, arbitration all 0)

| Metric | Dev C → D | Holdout C → D | Blind C → D (totals only) |
|---|---|---|---|
| Ask intent | 86% → 92% | 91% → **98%** | 88% → 88% |
| Intent Brier | 0.125 → 0.080 | 0.085 → 0.055 | 0.101 → 0.085 |
| Intent ECE | 0.138 → 0.132 | 0.088 → **0.137** ✗ gate | 0.113 → 0.137 |
| Triage category | 76% → 82% | 93% → 93% | 63% → 68% |
| Category ECE | 0.166 → 0.100 | 0.088 → 0.104 | 0.163 → 0.129 |
| Hostile category | 67% → 67% | 100% → 100% | 25% → 25% |
| Needs reply | 87% → 91% | 100% → 100% | 80% → 85% |
| Rank top-1 / top-3 | 58% / 83% → 67% / 92% | 100% / 100% → same | 8% / 25% → 8% / 25% |
| Rules tp / fp / trash fp | 25 / 5 / 0 → **26 / 0 / 0** | | |
| Latency p50 | 0.93 ms → about 1.3 to 1.5 ms | | |

Why holdout intent ECE rose while its Brier fell by a third: Kage got answers right without getting surer of them. On dev (the only split looked at for this), intent is underconfident: mean confidence 0.835 against 92% right, while category is calibrated (0.812 against 82%). A cooler temperature would fix intent, but temperature is shared by every choice question: below 2, rules misfire again (4 at T = 1, 3 at T = 1.5) and category tips into overconfidence. The dev fit keeps T = 2. Blind's intent ECE moved the same way, which fits that reading; it played no part in any choice.

Decisions for the user:

1. **Re-pin the baseline?** Holdout intent ECE 0.137 fails the gate, so `bun run test` has 1 failure until this is decided. Brier (the proper score) improved on every split, and accuracy rose. Suggestion: re-pin (`bun run eval:kage --write-baseline`), and treat intent underconfidence as its own task: a per-question calibration step in `planAsk` (one fitted temperature for the intent answer only, on dev), which leaves rules and triage alone. Or keep the gate red and do that calibration first.
2. **labelKey 0.25 or 0.1?** 0.1 also frees "Updated contract attached" and "FYI: updated slides" from `updates` (the plan's own example), for a slightly worse dev category Brier (0.115 → 0.121) and inside one SE. 0.25 had the best dev Brier. Suggestion: 0.25 as committed; Phase 4's `#sender_person` cap can address person mail landing in `updates` from inside Kage.
3. Still open: the search gap (blind rank top-1 8%), and hostile dev 4/6 (cheapmeds and "Personal note from Anna" were misses before Phase 3 too).

### Results at Checkpoint C (Kage, committed setting `{ intent 0, category 0, needsReply 0.6 }`)

| Metric | Dev B → C | Holdout B → C | Blind B → C |
|---|---|---|---|
| Ask intent | 86% → 86% | 91% → 91% | 88% → 88% |
| Intent Brier | 0.138 → 0.125 | 0.094 → 0.085 | 0.112 → 0.101 |
| Intent ECE | 0.143 → 0.138 | 0.071 → 0.088 | 0.132 → 0.113 |
| Triage category | 76% → 76% | 93% → 93% | 63% → 63% |
| Category ECE | 0.154 → 0.166 | 0.088 → 0.088 | 0.160 → 0.163 |
| Needs reply | 84% → 87% | 96% → 100% | 80% → 80% |
| Rules tp / fp / trash fp | 25 / 5 / 0 → same | | |

The intent Brier gain comes only from agreement: when both engines pick the same intent, the higher confidence stands, and on dev every ask where both picked the same intent was right (49 of 49; all 4 "both wrong" asks are disagreements). That also lifts holdout intent ECE (0.071 → 0.088, inside the margin). Agreement on category moves ECE a little both ways (dev +0.012, holdout 0). The heuristic's triage "confidence" counts urgency and reply words, not category evidence.

Decisions for the user:

1. **Source label.** When the heuristic wins inside the Kage path, should `source` say "kage" or "rules"? Today only needsReply can be overruled (and the category, if decision 2 turns it on). Suggestion: keep **"kage"**. `source` labels the whole triage result, and the category, urgency and most answers are still Kage's. "rules" would be wrong for those fields. The code's name for the keyword path is "heuristic" anyway. A per-field label would need a schema change that no screen uses.
2. **Category arbitration at 0.45?** Dev 76% → 80% and ECE better, holdout Brier better, but holdout ECE fails the gate (0.088 → 0.111), and "only Kage right" shrinks by one on dev and on holdout. Suggestion: leave it at 0. Phase 3.1's `#sender_person` / `#reply_thread` shape features go after the same misses ("Weekend plans?" from a gmail address going to `other`) from inside Kage. Run `bun scripts/kage-fit-arbitrate.ts` again after 3.1. To turn it on: `category: 0.45` in `ARBITRATION`.
3. **Re-pin the baseline again?** It would lock in the intent Brier gain (dev 0.125, holdout 0.085), but also accept holdout intent ECE 0.088 and dev category ECE 0.166. Suggestion: re-pin, as at Checkpoint B.
4. Still open: the search gap (blind rank top-1 8%).

### Results at Checkpoint B (Kage; accuracy unchanged on every split, by design)

| Metric | Dev A → B | Holdout A → B | Blind A → B |
|---|---|---|---|
| Intent Brier | 0.139 → 0.138 | 0.094 → 0.094 | 0.108 → 0.112 |
| Intent ECE | 0.126 → 0.143 | 0.071 → 0.071 | 0.128 → 0.132 |
| Category ECE | 0.167 → 0.154 | 0.095 → 0.088 | **0.277 → 0.160** |
| Rules tp / fp / trash fp | 25 / 5 / 0 → same | | |

Targets: blind intent Brier clearly below the keywords (0.112 vs 0.136) ✓; holdout ECE ≤ 0.10 (intent 0.071, category 0.088) ✓. The big change is the blind category ECE, where Kage was most overconfident at Checkpoint A. The small intent loss on blind comes from "other" answers losing their head start.

Decisions for the user:

1. **Turn the coverage pull on?** It is what 1.1 asked for. On dev it helps a little (0.142 → 0.138, within one standard error). On holdout it hurts intent ECE past the gate (0.071 → 0.129). It lowers confidence on questions where two intents both have a claim ("how many receipts this month", "unread newsletters"), which is honest but adds chips to right answers. Most confident misses on dev are operator mix-ups ("how many", "new", "unread" pulling towards the wrong intent), which Phase 3.2 targets. Suggestion: leave it off, and run `bun scripts/kage-fit.ts` again after 3.2. To turn it on: `KAGE_TUNING = { temperature: 2, coverage: 0.5, unknown: 0, span: Infinity, none: 0.25 }` and re-pin the baseline.
2. **Re-pin the baseline now?** The gate still compares against Checkpoint A. Re-pinning would lock in the category ECE gains but also accept the dev intent ECE rise (0.126 → 0.143, within the 0.02 margin). Suggestion: re-pin, so later phases can't quietly spend the gain.
3. Still open from Checkpoint A: the search gap (blind rank top-1 8%).

### Baseline at Checkpoint A (Kage vs keywords, before any Kage change)

| Metric | Dev K / kw | Holdout K / kw | Blind K / kw |
|---|---|---|---|
| Ask intent | 86% / 79% | 91% / 80% | 88% / 73% |
| Intent Brier | 0.139 / 0.127 | 0.094 / 0.116 | 0.108 / 0.136 |
| Intent ECE | 0.126 / 0.185 | 0.071 / 0.203 | 0.128 / 0.194 |
| Triage category | 76% / 78% | 93% / 89% | **63% / 70%** |
| Category ECE | 0.167 / 0.287 | 0.095 / 0.38 | 0.277 / 0.209 |
| Hostile category | 67% / 83% | 100% / 100% | 25% / 25% (n=4) |
| Needs reply | 84% / 89% | 96% / 100% | 80% / 80% |
| Urgency MAE | 0.212 / 0.178 | 0.259 / 0.197 | 0.289 / 0.284 |
| Rank top-1 | 58% / 75% | 100% / 100% | **8% / 8%** |
| Rank top-3 | 83% / 83% | 100% / 100% | 25% / 33% |
| Rank says none | 50% / 100% | 100% / 100% | 0% / 0% (n=3) |

Blind agreement: asks 41 both right · 11 only Kage · 2 only keywords · 6 both wrong; emails 15 · 7 · 6 · 12; searches 1 · 0 · 0 · 14.

What this changes for the plan:

- Kage leads on ask intent on blind (88% vs 73%). Triage is where it is weakest: category 63%, below the keywords, and its confidence is overconfident there (ECE 0.277). Phases 1 to 3 aim at this.
- **Search is the biggest gap, and the plan does not cover it yet.** Both engines get 1 of 12 blind searches right. The blind fixtures were checked and are correct: the right email uses other words than the question ("bill" vs "invoice"), next to look-alikes that share a word. Phase 3's lexicon work helps a little. A real fix needs either the learned weights or local embeddings, which the plan has set aside so far. Decision for the user.
