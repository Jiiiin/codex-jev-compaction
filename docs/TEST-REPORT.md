# System test report — 2026-09-18

Release decision: **HOLD**. The changes improve robustness and offline evidence transport. They do not yet establish real Jev usefulness or downstream Codex task quality.

## Verified locally

- Codex CLI 0.154.0 successfully installs the GitHub marketplace package. The real app-server `hooks/list` recognizes both command hooks, without plugin parse errors. After source review, the two current plugin definitions were trusted through the normal Codex `/hooks` UI; no trust database editing or bypass flag was used.
- **55 tests pass on Node 22 and 24 across Linux, macOS and Windows (all 6 CI jobs).** [Verified CI run](https://github.com/Jiiiin/codex-jev-compaction/actions/runs/35315821913), commit `7fbc45e`. Coverage includes core, hook subprocess, loopback HTTP, filesystem and randomized invariants.
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
- The Jev scorer still sees bounded previews. A fact hidden in the middle may affect its decision, so live scoring and task-level comparisons are mandatory before release.

## Fixes prompted by testing

1. Prioritize scored historical evidence over automatically pinned recent logs.
2. Use head/tail excerpts so trailing errors and user corrections can survive.
3. Split long history into bounded batches with shared task anchors.
4. Store complete selected outputs in private, expiring local snapshots for bounded read-only recovery.
5. Atomically claim checkpoints to avoid duplicate injection under concurrent restore.
6. Reject malformed/null/oversized input; sanitize parse/network errors; reject output overwrite before network.
7. Add private key-file support, offline doctor output, and metadata-only hook diagnostics.
8. Codex's `additionalContextLimit` is an approximate token limit, not a character limit. The plugin now uses 0 with its own hard 6000-character cap, avoiding a second spill/truncation layer.

## Outstanding evidence

No TypeSafe key has been configured for this testing run. No real Jev requests, real-model A/B outcomes or paid usage measurements have been claimed. Runtime hook success uses local model/Jev stubs, as described above. The live synthetic evaluator is ready and only uses bundled fixtures. Marketplace submission remains gated on these results and publisher verification.

Commands: `npm test`, `npm run evaluate`, and (with a locally configured key) `node plugins/codex-jev-compaction/scripts/evaluate.mjs --live-synthetic`.
