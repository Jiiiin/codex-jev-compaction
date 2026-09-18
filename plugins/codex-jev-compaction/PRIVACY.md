# Privacy and data handling / 数据处理说明

Publisher: Jiiiin, the maintainer of this GitHub repository. This experimental open-source plugin is independent of OpenAI and TypeSafe. This page describes the code in this repository; it does not replace either provider's policies.

## Network / 网络

The plugin is disabled by default. Setting `JEV_ENABLE=1` and supplying a TypeSafe key enables automatic scoring hooks. The export CLI requires `--send-to-typesafe`; the synthetic evaluator requires `--live-synthetic`.

Enabled scoring sends bounded user/assistant text, tool names and inputs, and head/tail tool-output previews directly to `https://api.typesafe.ai/v1/systemone`. Requests use `jev-latest`. Your TypeSafe key is sent in the Authorization header to that endpoint. Redirects are disabled. The plugin author does not operate a proxy, analytics endpoint, or data-collection server.

这些文本可能含源代码、个人信息或业务数据。本插件不提供可靠的自动脱敏功能。请仅在允许向 TypeSafe 发送这些内容的环境启用。reasoning 加密内容、未知类型及非文本输出不参与发送。

TypeSafe's retention, account handling and other practices are governed by its [published legal documents](https://docs.typesafe.ai/legal). Do not assume zero retention unless your TypeSafe agreement provides it. Codex/OpenAI processing is governed separately by your applicable OpenAI settings and agreements.

## Local storage / 本地存储

- Checkpoints contain excerpts and are bound to the originating session and workspace, consumed once, and rejected after 15 minutes.
- Selected complete tool inputs/outputs are also stored in private local evidence files. The reader only accepts the original workspace and rejects files older than 15 minutes. It returns bounded pages without rerunning tools.
- Expiration prevents reading; it does not guarantee immediate physical deletion. A subsequent enabled checkpoint run removes expired evidence snapshots. If the plugin stops running, files can remain until you delete the plugin's data directory. Interrupted writes may also remain.
- Diagnostics contain timestamps, outcome, elapsed time, counts and reported API usage, not conversation text, request bodies or keys. They are not sent to the author.
- Newly created private directories use 0700 and files use 0600 on POSIX. Windows uses the user's existing filesystem ACLs; Unix permission bits are not an ACL guarantee.
- The plugin never overwrites your live Codex transcript. CLI exports remain until you delete them.

## Credentials / 凭据

Keys are read from the Codex process environment or an explicitly configured private file. The plugin does not copy them into its data directory. A `.env` file is not automatically loaded. Do not attach credentials or real transcripts to public issues.

## Controls and support / 控制与支持

Disable the plugin or unset `JEV_ENABLE` and restart the relevant Codex process to stop automatic network calls. Delete its local plugin-data files and any explicit CLI exports to remove plugin-created content. Uninstalling the plugin is not a promise that all data files are removed.

For questions or bugs, use [GitHub Issues](https://github.com/Jiiiin/codex-jev-compaction/issues), with synthetic or redacted examples only.
