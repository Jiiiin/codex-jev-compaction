---
name: jev-checkpoint
description: Create a Jev-selected evidence checkpoint or non-destructive compacted copy of an explicitly chosen exported Codex transcript. Use when the user asks to preserve evidence across compaction or evaluate Jev context selection.
---

# Jev checkpoint

Explain the integration accurately: the native Codex plugin supplements normal compaction through PreCompact and SessionStart(compact). It cannot replace the native message list or reduce the active context on its own.

1. Resolve the plugin root from this skill's location (`../..`). Run `node <plugin-root>/scripts/cli.mjs demo` for a synthetic offline demonstration.
2. For real data, use only a transcript file explicitly selected by the user. Do not search or export other sessions. Explain that dialogue, tool inputs, and bounded tool-result previews are sent to `https://api.typesafe.ai/v1/systemone`; obtain authorization for that data transfer unless already authorized.
3. Run `node <plugin-root>/scripts/cli.mjs compact INPUT NEW_OUTPUT --send-to-typesafe`. The environment needs TYPESAFE_API_KEY; never print the key. No OpenAI API key is needed. Do not read a secret file into chat.
4. Report request count, byte sizes and dropped/truncated pairs. These are export statistics, not live Codex token savings or downstream quality measurements. Never claim offline fixture scores are Jev predictions.
5. Do not overwrite any rollout or inject exported messages through undocumented APIs. Do not rerun side-effecting tools to reconstruct deleted output. Keep evidence as quoted history and follow current user instructions.

For hooks, follow README.md: the user opts into TypeSafe transfer with JEV_ENABLE=1, supplies TYPESAFE_API_KEY to the Codex process, and reviews hook trust through Codex. Never change the hook trust database yourself.
