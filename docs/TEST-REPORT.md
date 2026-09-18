# System test report — 2026-09-18

Release decision: **HOLD**. The changes improve robustness and offline evidence transport. They do not yet establish real Jev usefulness or downstream Codex task quality.

## Verified locally

- Codex CLI 0.154.0 successfully installs the GitHub marketplace package. The real app-server `hooks/list` recognizes both command hooks, without plugin parse errors. Their trust state is untrusted; this is discovery validation, not execution validation.
- Node 24.2.0: core, hook subprocess, local HTTP, filesystem and randomized invariant tests (see current CI for counts and platform results).
- 200 deterministic randomized trials preserve user/assistant text, unknown items, pinned pairs and input immutability.
- 120 tool-pair history processes within request/state limits and concurrency 2. Over-budget requests fail before any API call.
- Concurrent restoration consumes the checkpoint once. Disabled/missing-key execution makes no model calls. HTTP redirects, errors and deadline cancellation are covered using a loopback server and fake credentials.
- Existing output files are refused before network use. Malformed input and network errors do not echo private text. Key files require private permissions on POSIX.

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

No TypeSafe key has been configured for this testing run. No real Jev requests, real-model A/B outcomes, paid usage measurements or successful full compaction-hook executions have been claimed. The live synthetic evaluator is ready and only uses bundled fixtures. Marketplace submission remains gated on these results and publisher verification.

Commands: `npm test`, `npm run evaluate`, and (with a locally configured key) `node plugins/codex-jev-compaction/scripts/evaluate.mjs --live-synthetic`.
