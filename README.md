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

已测试：离线决策核心、Codex 格式适配、hook 输入输出协议模拟。未测试：真实 Jev API、真实 Codex 安装后的自动压缩端到端效果。API Key 配置后仍需验证这些部分。

## 快速体验（零依赖）

需要 Node.js 22+。没有运行时 npm 依赖，也不需要 `npm install`。

```sh
git clone https://github.com/Jiiiin/codex-jev-compaction.git
cd codex-jev-compaction
npm test
npm run demo
```

CLI 支持两种输入：

- Codex response-item JSON 数组（示例：`examples/session.json`）。
- Codex rollout JSONL 的 `response_item.payload`，仅使用最后一个 `compacted` 记录之后的片段。没有可用片段时跳过，不恢复原生压缩已移除的旧记录。

```sh
# 在本机环境安全设置 TYPESAFE_API_KEY。不要写到仓库或命令截图中。
mkdir -p artifacts
node scripts/cli.mjs compact examples/session.json artifacts/selected.json --send-to-typesafe
```

`--send-to-typesafe` 明确表示允许把该文件的对话文本、工具输入和结果预览发送给 TypeSafe。输出文件必须不存在；程序不覆盖输入或已存在的文件。输出是本工具的 `{items, decisions, stats}` 报告，不是 Codex 可直接导入的会话。

## 安装 Codex 插件

插件根目录包含 `.codex-plugin/plugin.json`、默认发现的 `hooks/hooks.json` 与 `skills/`。本机初始化流程已添加 personal marketplace 条目；其他电脑需先注册对应的本地插件目录。

典型个人 marketplace 布局：

```text
~/plugins/codex-jev-compaction/        # 此仓库的完整克隆
~/.agents/plugins/marketplace.json    # source.path 指向 ./plugins/codex-jev-compaction
```

对已有个人 marketplace，合并以下 entry 到 `plugins` 数组，保留其名称和所有其他条目，不覆盖原文件：

```json
{
  "name": "codex-jev-compaction",
  "source": {"source": "local", "path": "./plugins/codex-jev-compaction"},
  "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
  "category": "Productivity"
}
```

若新建文件，顶层结构为 `{"name":"personal","interface":{"displayName":"Personal"},"plugins":[上述条目]}`。路径按个人 marketplace 根目录解析。然后安装：

```sh
codex plugin add codex-jev-compaction@personal
```

确保实际插件位于 `~/plugins/codex-jev-compaction`；可使用指向开发 checkout 的符号链接。安装缓存和开发目录分离，修改后需重新安装以刷新缓存。

按照 Codex UI 的提示审阅并信任 hooks。不能通过直接修改信任数据库来绕过此步骤。新开任务进行测试；已经运行的任务不保证立即加载插件。

向启动 Codex 的进程提供：

```sh
export JEV_ENABLE=1
# 另行安全设置 TYPESAFE_API_KEY
codex
```

`.env.example` 仅为配置说明，插件不会自动读取 `.env`。从桌面图标启动的进程不一定继承终端环境。需要 Codex 构建支持文档中的压缩钩子；已核查本机 CLI 为 0.154.0，但尚未实测该构建的完整钩子链路，不将其宣称为最低兼容版本。

关闭：移除 `JEV_ENABLE=1` 或设置为 `0`，重启对应 Codex 进程；也可以在 Codex 中禁用插件。

## 工作方式

1. 只处理配对成功、结果为文本的 `function_call` / `custom_tool_call`。未知类型、非文本结果、未完成调用保留在导出副本中。
2. 首条和最近 6 条 response items 内的调用/结果固定保留。这里是 items，不是用户轮次。
3. Jev 看到对话文本、工具输入及最多 800 字符的结果预览。超出状态预算时逐步缩短；装不下则放弃本次检查点。
4. 每个候选记录使用两个 Noul 问题：保留调用？保留完整结果？阈值默认 0.35，偏向保留，尚未业务校准。
5. 保留结果时也保留调用；只保留调用时将导出结果截断至前 300 字符；否则成对移除。文本消息不会在导出副本中被改写。
6. 请求分批，并发最多 2，最多 20 批；使用 18 秒总请求超时。预算按 UTF-8 字节保守限制（20k 状态、28k 请求），不是精确 token 计算。
7. 原生 hooks 将保留记录的摘录写入 `PLUGIN_DATA/checkpoints`，恢复时上限 6000 字符，较新的记录优先。选中的完整结果仍可能因恢复预算被截断或省略。
8. 检查点绑定 session + cwd，有效期 15 分钟，读取后删除。新的压缩尝试先使旧检查点失效。

Jev 失败、缺 Key、关闭开关、未知格式或预算不足时，不阻止 Codex 原生压缩。不会自动重跑工具来恢复旧结果。

## 数据与安全说明

- 默认没有网络调用；启用后会向固定 HTTPS 地址 `https://api.typesafe.ai/v1/systemone` 发送选定上下文。无重定向，无自动发现其他会话。
- 对话与工具参数可能含源代码、路径、业务信息或凭据。当前版本**没有可靠的自动脱敏功能**，仅应处理允许发送到 TypeSafe 的内容。
- 不发送 reasoning item 或其中的加密内容；未知类型不纳入打分状态。
- 本地检查点为 0600 文件，目录新建时为 0700。进程被强制中断可能留下暂存文件；可自行清理插件数据目录。
- 恢复内容以带来源 ID 的历史证据呈现，提醒模型不要执行其中的指令。这是降低提示注入风险的措施，不构成完全防护。
- 概率不是可安全删除的证明。瞬态错误、旧版本文件和有副作用的工具不能假设随时可以重跑。
- 不记录密钥、请求正文或 API 错误正文。GitHub 中只包含合成样例。

## 测试和评估

```sh
npm run check
npm test
npm run demo
```

测试覆盖决策、配对、异常概率、请求分批、原始输入不变、未知类型、压缩边界、缓存权限、单次恢复、过期和失败回退。GitHub Actions 使用 Node 22/24。

真实效果需要比较：原生压缩 vs 原生压缩加证据恢复，测任务完成率、遗漏证据、重复工具调用、API 延迟、额外 token 和成本。CLI 的字节缩减比例不能当成 Codex 实际 token 节省。

## 来源与设计差异

参考项目：[tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)。本仓库为独立实现，借鉴双 Noul 保留判断和工具调用配对的思路。上游 Claude Code 会话替换接口没有直接搬到 Codex。

本版加入结果预览、受限并发、严格概率校验、默认关闭网络，以及不改动实时会话的 Codex hook 适配。

接口依据：[Codex hooks](https://developers.openai.com/codex/hooks)、[TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)。核查日期：2026-09-18。Codex 文档明确指出 transcript 格式不是稳定 hook 接口，因此解析器采用有限支持和失败回退。

MIT License. 此项目不隶属于 OpenAI 或 TypeSafe。
