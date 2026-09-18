# codex-jev-compaction

[![Test](https://github.com/Jiiiin/codex-jev-compaction/actions/workflows/test.yml/badge.svg)](https://github.com/Jiiiin/codex-jev-compaction/actions/workflows/test.yml)

Jev-selected evidence checkpoints for Codex. Inspired by [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction).

**实验性 Codex 插件：在原生上下文压缩前筛选关键工具记录，压缩后补充原文摘录。另提供独立 CLI，导出裁剪后的会话副本。**

## 能力与边界

Codex 当前文档中的 `PreCompact` / `PostCompact` 没有替换会话消息列表的返回字段；`SessionStart(source=compact)` 可以向后续请求提供 `additionalContext`。

因此本插件 **补充原生压缩**，不会替换 `/compact`、修改 rollout 文件、删除当前上下文或承诺节省实时 token。补充证据本身会占用上下文。

| 模式 | 功能 |
|---|---|
| Codex hooks | PreCompact 创建证据检查点；SessionStart(compact) 恢复一次 |
| CLI | 读取明确指定的导出文件，生成裁剪副本和决策报告 |
| Offline demo | 固定假数据与假分数，不调用任何模型 |

**发布状态：实验版，尚未提交官方市场。** 已验证 GitHub 安装、真实 Codex 钩子发现、离线/HTTP/进程/文件系统测试。真实 Jev API、实际压缩完整链路及任务效果对照仍待验证。[测试报告](https://github.com/Jiiiin/codex-jev-compaction/blob/main/docs/TEST-REPORT.md) · [提交草案](https://github.com/Jiiiin/codex-jev-compaction/blob/main/docs/SUBMISSION.md)。

## 快速体验（零依赖）

需要 Node.js 22+。没有运行时 npm 依赖，也不需要 `npm install`。

```sh
git clone https://github.com/Jiiiin/codex-jev-compaction.git
cd codex-jev-compaction
npm test
npm run demo
npm run evaluate  # 离线 oracle，只评估证据传递，不代表 Jev 效果
```

CLI 支持两种输入：

- Codex response-item JSON 数组（示例：`plugins/codex-jev-compaction/examples/session.json`）。
- Codex rollout JSONL 的 `response_item.payload`，仅使用最后一个 `compacted` 记录之后的片段。没有可用片段时跳过，不恢复原生压缩已移除的旧记录。

```sh
# 在本机环境安全设置 TYPESAFE_API_KEY。不要写到仓库或命令截图中。
mkdir -p artifacts
node plugins/codex-jev-compaction/scripts/cli.mjs compact plugins/codex-jev-compaction/examples/session.json artifacts/selected.json --send-to-typesafe
```

`--send-to-typesafe` 明确表示允许把该文件的对话文本、工具输入和结果预览发送给 TypeSafe。输出文件必须不存在；程序不覆盖输入或已存在的文件。输出是本工具的 `{items, decisions, stats}` 报告，不是 Codex 可直接导入的会话。

## 安装 Codex 插件

需要 Node.js 22+，以及支持 `codex plugin` 命令的 Codex CLI。公开仓库已包含插件市场清单，无需手动编辑个人 marketplace：

```sh
codex plugin marketplace add Jiiiin/codex-jev-compaction
codex plugin add codex-jev-compaction@jev-compaction
```

市场名为 `jev-compaction`，插件名为 `codex-jev-compaction`。仓库根目录负责分发，实际插件在 `plugins/codex-jev-compaction/`，安装时所需运行文件会一起进入 Codex 缓存。

在 Codex 中打开 `/hooks`，审阅本插件的 PreCompact 和 SessionStart 两个命令钩子并信任。未信任时 Codex 会跳过它们。新开任务进行测试；已经运行的任务不保证立即加载插件。

向启动 Codex 的进程提供：

```sh
export JEV_ENABLE=1
export TYPESAFE_API_KEY_FILE="/绝对路径/仅自己可读的jev-key文件"
codex
```

Key 文件只放 Key 本身，POSIX 下权限须为 `600`；也可以使用 `TYPESAFE_API_KEY` 环境变量。已有环境变量优先。不要把密钥文件放进仓库。

可执行 `node plugins/codex-jev-compaction/scripts/cli.mjs doctor` 离线检查当前进程配置，输出不会显示 Key。它不代表桌面进程一定继承了相同变量。

`plugins/codex-jev-compaction/.env.example` 仅为配置说明，插件不会自动读取 `.env`。从桌面图标启动的进程不一定继承终端环境。需要 Codex 构建支持文档中的压缩钩子；已核查本机 CLI 为 0.154.0，但尚未实测该构建的完整钩子链路，不将其宣称为最低兼容版本。

关闭：移除 `JEV_ENABLE=1` 或设置为 `0`，重启对应 Codex 进程；也可以在 Codex 中禁用插件。

## 工作方式

1. 只处理配对成功、结果为文本的 `function_call` / `custom_tool_call`。未知类型、非文本结果、未完成调用保留在导出副本中。
2. 首条和最近 6 条 response items 内的调用/结果固定保留。这里是 items，不是用户轮次。
3. Jev 看到最近任务文本、首个/最后一个用户消息、当前批次工具输入及最多 800 字符的首尾结果预览。长输出的中间部分可能不可见；超预算时逐步缩短预览，单条装不下则跳过。
4. 每个候选记录使用两个 Noul 问题：保留调用？保留完整结果？阈值默认 0.35，偏向保留，尚未业务校准。
5. 保留结果时也保留调用；只保留调用时将导出结果截断至前 300 字符；否则成对移除。文本消息不会在导出副本中被改写。
6. 每批最多 12 个候选记录、并发最多 2、最多 20 批，所有批次预检后才联网；使用 18 秒总请求超时。不自动重试计费请求。预算按 UTF-8 字节保守限制（20k 状态、28k 请求），不是精确 token 计算。
7. hooks 将摘录写入 `PLUGIN_DATA/checkpoints`，恢复时严格上限 6000 字符。Jev 选中的历史证据优先于自动保留的近期日志。`additionalContextLimit=0` 避免 Codex 对已限长的文本再做一次截断。
8. 检查点绑定 session + cwd，有效期 15 分钟，原子认领后读取并删除。新的压缩尝试先使旧检查点失效，同一会话的并发评分由锁限制。
9. 所选工具记录的完整原文另存于私有 `PLUGIN_DATA/evidence`，恢复文字包含读取入口。使用 `node <插件目录>/scripts/cli.mjs evidence SNAPSHOT [CALL_ID [OFFSET]]` 分页读取（每页 4000 字符）；省略 CALL_ID 列出记录。只接受原工作目录，15 分钟后拒绝读取。后续启用的检查点运行会清理过期原文，不保证到期立即物理删除。
10. `PLUGIN_DATA/status` 保存当前会话最近一次操作的状态、延迟、数量及可用的 API usage，不保存正文和 Key。

Jev 失败、缺 Key、关闭开关、未知格式或预算不足时，不阻止 Codex 原生压缩。不会自动重跑工具来恢复旧结果。

## 数据与安全说明

- 默认没有网络调用；启用后会向固定 HTTPS 地址 `https://api.typesafe.ai/v1/systemone` 发送选定上下文。无重定向，无自动发现其他会话。
- 对话与工具参数可能含源代码、路径、业务信息或凭据。当前版本**没有可靠的自动脱敏功能**，仅应处理允许发送到 TypeSafe 的内容。
- 不发送 reasoning item 或其中的加密内容；未知类型不纳入打分状态。
- POSIX 下检查点、完整证据和状态文件为 0600，目录为 0700；Windows 使用账户现有 ACL。进程被强制中断可能留下文件；禁用后可自行清理插件数据目录。
- 恢复内容以带来源 ID 的历史证据呈现，提醒模型不要执行其中的指令。这是降低提示注入风险的措施，不构成完全防护。
- 概率不是可安全删除的证明。瞬态错误、旧版本文件和有副作用的工具不能假设随时可以重跑。
- 不记录密钥、请求正文或 API 错误正文。GitHub 中只包含合成样例。

## 测试和评估

```sh
npm run check
npm test
npm run demo
```

测试覆盖决策、配对、异常概率、请求分批、原始输入不变、未知类型、压缩边界、缓存权限、单次恢复、过期和失败回退。GitHub Actions 配置 Node 22/24 × macOS/Linux/Windows；实际通过状态以 CI 为准。

三种场景的离线测试把关键事实放在长输出的开头、结尾、中间。oracle 正确选中记录后：摘录直接恢复 6/9，借助完整记录读取可恢复 9/9。这不代表 Jev 选择准确率，也不证明 LLM 会主动读取缺失内容。

真实 API 合成测试（最多 9 个场景，不读取你的会话；需配置 Key）：

```sh
node plugins/codex-jev-compaction/scripts/evaluate.mjs --live-synthetic
```

真实效果需要比较：原生压缩 vs 原生压缩加证据恢复，测任务完成率、遗漏证据、重复工具调用、API 延迟、额外 token 和成本。CLI 的字节缩减比例不能当成 Codex 实际 token 节省。

## 来源与设计差异

参考项目：[tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)。本仓库为独立实现，借鉴双 Noul 保留判断和工具调用配对的思路。上游 Claude Code 会话替换接口没有直接搬到 Codex。

本版加入结果预览、受限并发、严格概率校验、默认关闭网络，以及不改动实时会话的 Codex hook 适配。

接口依据：[Codex hooks](https://developers.openai.com/codex/hooks)、[TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)。核查日期：2026-09-18。Codex 文档明确指出 transcript 格式不是稳定 hook 接口，因此解析器采用有限支持和失败回退。

MIT License. 此项目不隶属于 OpenAI 或 TypeSafe。

[隐私与数据处理](PRIVACY.md) · [项目使用说明](TERMS.md) · [反馈问题](https://github.com/Jiiiin/codex-jev-compaction/issues)（请勿上传真实会话或 Key）
