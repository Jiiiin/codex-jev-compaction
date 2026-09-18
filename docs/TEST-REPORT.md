# System test report — 2026-09-18

Release decision: **HOLD**. Real Jev scoring and real-model manual compaction have been exercised. Current evidence does not establish better task outcomes than native compaction; one restore timeout also requires a reliability follow-up.

## Verified locally

- Codex CLI 0.154.0 successfully installs the GitHub marketplace package. The real app-server `hooks/list` recognizes both command hooks, without plugin parse errors. After source review, the two current plugin definitions were trusted through the normal Codex `/hooks` UI; no trust database editing or bypass flag was used.
- **59 tests pass on Node 22 and 24 across Linux, macOS and Windows (all 6 CI jobs).** [Verified CI run](https://github.com/Jiiiin/codex-jev-compaction/actions/runs/35317624567), commit `c64b202`. Coverage includes core, hook subprocess, loopback HTTP, filesystem and randomized invariants.
- An allowlisted 19-file upload candidate was extracted into a fresh directory; offline demo and doctor both ran successfully. No credentials, transcripts or test artifacts are packaged.
- 200 deterministic randomized trials preserve user/assistant text, unknown items, pinned pairs and input immutability.
- 120 tool-pair history processes within request/state limits and concurrency 2. Over-budget requests fail before any API call.
- Concurrent restoration consumes the checkpoint once. Disabled/missing-key execution makes no model calls. HTTP redirects, errors and deadline cancellation are covered using a loopback server and fake credentials.
- Existing output files are refused before network use. Malformed input and network errors do not echo private text. Key files require private permissions on POSIX.

## Real Codex runtime integration (local stubs)

On macOS with Codex 0.154.0, the installed GitHub package was exercised using a loopback Responses API fixture and a child-process-only fake Jev fetch adapter. The actual Codex runtime generated and compacted its own transcript; tests did not overwrite session files or inject history through unstable resume APIs. Only synthetic tool calls were returned by the model fixture.

| Case | Observed result |
|---|---|
| Manual compaction, legacy history | PreCompact and SessionStart complete; selected evidence appears in the next model request |
| Automatic compaction during a turn | `trigger=auto`; evidence reaches the **immediate** continuation within that turn |
| Manual compaction, paginated history | Both hooks run; Codex supplies a compatible transcript; evidence reaches continuation |
| Jev 429 simulation | Native compaction and the next turn complete; no checkpoint evidence is injected |
| Repeated compaction without new tool evidence | Both hook cycles complete; the old checkpoint is not injected again |

These tests establish integration, not LLM quality or actual TypeSafe availability/latency. The hook processes took roughly 0.4–0.6 seconds each on this machine with stubbed responses; this excludes real API latency and is not a production latency claim. The harness requests archiving only its own synthetic test task after execution. The plugin remains disabled for real scoring without explicit environment configuration.

[Sanitized runtime results](runtime-results.json) contain the measured event statuses and continuation checks.

Reproduce after installation and hook review: `python3 scripts/runtime-smoke.py manual` (also `auto`, `paginated`, `failure`, `repeat`). The harness respects existing hook trust and runs existing user hooks. It creates its own synthetic test task, uses local model/Jev stubs, archives that task, and writes a compact report under ignored `artifacts/`. It never modifies persistent API credentials or trust settings.

## Three-scenario evidence transport

Mario, ticket and hotel fixtures each place a required fact at the head, tail and middle of a long tool output: 9 cases total. Offline scores are an **oracle**, deliberately selecting the correct old record. This tests what happens after selection, not whether Jev selects correctly.

- Short excerpts alone directly contain the complete fact in **6/9** cases.
- With the local snapshot reader, full selected original records are recoverable in **9/9** cases, including the middle. This is an exact-content assertion; it does not establish that an LLM will choose to read the missing page.
- The scorer still sees bounded previews. Live tests confirmed it can discard hidden middle facts. The final implementation always retains a record when its output preview is incomplete; its decision reason is `partial-preview`. This is a deterministic safety rule, not a Jev prediction.

## Fixes prompted by testing

1. Prioritize scored historical evidence over automatically pinned recent logs.
2. Use head/tail excerpts so trailing errors and user corrections can survive.
3. Split long history into bounded batches with shared task anchors.
4. Store complete selected outputs in private, expiring local snapshots for bounded read-only recovery.
5. Atomically claim checkpoints to avoid duplicate injection under concurrent restore.
6. Reject malformed/null/oversized input; sanitize parse/network errors; reject output overwrite before network.
7. Add private key-file support, offline doctor output, and metadata-only hook diagnostics.
8. Codex's `additionalContextLimit` is an approximate token limit, not a character limit. The plugin now uses 0 with its own hard 6000-character cap, avoiding a second spill/truncation layer.

## Real Jev selection, calibration and validation

Model reported by the API: `jev-1.13.0`. All inputs were generated synthetic fixtures. The key is outside the repository; neither it nor real conversations are in these results.

| Suite | Full fact recoverable from snapshot | Unrelated old records retained | Interpretation |
|---|---:|---:|---|
| Initial opaque-ID calibration | 9/9 | 45/45 | Too conservative; preserved all routine noise |
| Revised prompt alone | 7/9 | 0/45 | Rejected: two hidden middle facts were discarded |
| Revised prompt + partial-preview guard | 9/9 | 0/45 | Program retains any output the scorer did not see in full |
| Fresh build-error/refund/handoff validation | 9/9 | 0/45 | New tasks, same synthetic generator; limited generalization evidence |

Direct excerpts contain 6/9 facts in each suite. A deterministic reader can recover all 9/9 final selected facts, but this does **not** prove an LLM will choose to find their pages. On fresh validation, model scores alone would retain 8/9 gold records; the program guard prevents the remaining loss. All gold records are long, so full retention in this suite depends on the guard. Calibration results were used for tuning and are not independent evaluation data.

Final calibration latency was 266–995 ms per fixture (median 357 ms). Fresh validation was 296–944 ms (median 325 ms). Each fixture used one paid request. These are small, mostly warm samples, not a production SLA.

[Selection results, including failed calibration](live-selection-results.json).

Reproduce: `TYPESAFE_API_KEY_FILE=/private/key node scripts/live-holdout.mjs --send-synthetic-to-typesafe` and add `--validation` for the fresh tasks. This does not discover user sessions.

## Real model comparison

The paid runtime harness uses the configured Codex model (`gpt-6-astra` here), actual native compaction, actual TypeSafe requests and installed hooks. Dynamic business tools are synthetic, including the action detector. It creates and archives only its own test tasks. Eight one-time tool records are read; the old required fact is in the middle of a long output. The follow-up asks for exact facts and a new user correction. No prompt declares a gold record ID. A child-only observer records response usage and hook restoration metadata without stubbing the API.

Initial real-model tests exposed a supported-format gap: Codex code-mode emits `custom_tool_call_output` as an array of `input_text` blocks. The old parser skipped these. The fix accepts only text-only blocks, preserves mixed media unchanged, and stores all selected text in the snapshot. Two new regression tests exercise the real format.

All three scenarios answered the exact-checked facts and new user correction both with native compaction alone (**3/3**) and with the plugin (**3/3**, using the hotel retest). No synthetic action was invoked and the one-time observation tool was not re-read. There is no observed improvement over native compaction in this small comparison.

The first hotel trial also answered correctly, but SessionStart hit the original five-second deadline. That trial is **not** a successful evidence-restore result. Native compaction continued safely. The deadline was raised to ten seconds, the changed hook reviewed normally, and the hotel retest completed: actual Jev call 4285 ms; SessionStart 411 ms; 5995 restored characters. This is a successful retest, not proof that the rare timeout is solved. No automatic paid API retry was added.

Actual runtime Jev requests took 883–4285 ms. The plugin injects up to 6000 additional characters; explicit ticket/hotel measurements were 5995. No LLM snapshot-page read was observed because native summaries already contained the required facts. [Paired results and the failed trial](live-runtime-results.json).

Commands: `TYPESAFE_API_KEY_FILE=/private/key python3 scripts/live-runtime.py jev hotel` and `python3 scripts/live-runtime.py native hotel`. The harness requires an installed and normally reviewed/trusted plugin; it never edits trust state. Existing local hooks still run. Observed timing differences are not a controlled estimate of plugin overhead.

## Usage and upload candidate

Observed live requests in this test series: **49**, with **141,448 input tokens**. The [TypeSafe model page](https://docs.typesafe.ai/models) checked on 2026-09-18 lists $0.042 per million input tokens and free output tokens. Estimated Jev list-price cost is **$0.005941**; this is not an account invoice and excludes Codex model usage/subscription accounting. No claim of token or money savings is made.

The current 19-file archive is `codex-jev-compaction-0.1.0+codex.20260918070306.zip`, SHA-256 `fa09cebb9a81d29617182f4b08dffdaad3fa866da445242fe49a0f5707a8f3d2`. A fresh extraction passes demo and doctor. The archive is an upload candidate, not a submitted listing. Credentials and test artifacts are outside the package. Automatic-compaction stub integration was rerun after the parser change; the 429 stub fallback was rerun on the current installed version.

## Remaining release gates

- Establish material value on a larger paired downstream set, including actual LLM snapshot retrieval and more varied long tasks. Three successful answers per arm would still not demonstrate an improvement.
- Repeat restore reliability testing after the deadline change; a single later pass cannot erase the observed timeout.
- Real-model automatic compaction has not been evaluated; the automatic integration test uses local stubs.
- Clean extraction/CLI startup is tested; installation on a genuinely clean machine and official publisher identity/portal setup remain unverified.

The official marketplace has **not** received a submission. Public GitHub installation remains experimental.

Commands: `npm test`, `npm run evaluate`, and (with a locally configured key) `node plugins/codex-jev-compaction/scripts/evaluate.mjs --live-synthetic`.
