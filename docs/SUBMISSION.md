# 官方市场提交草案（尚未提交）

当前状态：**实验版本；发布门槛未满足**。不能用离线测试结果声称真实 Jev 效果、自动压缩质量提升或实时 token 节省。

## 拟展示信息

- 名称：Codex Jev Compaction
- 发布者：Jiiiin。平台上的已验证个人/企业身份须由账户持有人选择，不能以 GitHub 用户名冒充已验证法定身份。
- 类别：Productivity
- 简介：Preserve selected tool evidence across Codex compaction, with opt-in Jev scoring and private local recovery.
- 长描述：An experimental Codex plugin that supplements native compaction. It scores bounded tool-history previews with TypeSafe Jev, saves selected evidence locally, and restores short quoted excerpts with a paged reader for complete selected outputs. It does not replace native compaction, rewrite transcripts, or promise token savings. Requires Node.js 22+, compatible Codex command hooks, hook trust, and a user-provided TypeSafe key. Scoring is off by default. Ordinary Chat does not run its Codex hooks.
- 网站：https://github.com/Jiiiin/codex-jev-compaction
- 支持：https://github.com/Jiiiin/codex-jev-compaction/issues
- 隐私：https://github.com/Jiiiin/codex-jev-compaction/blob/main/PRIVACY.md
- 使用条款：https://github.com/Jiiiin/codex-jev-compaction/blob/main/TERMS.md
- 技术路线：按当前无 MCP 的代码评估 Skills only 上传。环境变量/私有 Key 文件在公开市场的配置体验仍需门户校验，不能假定上传后即可使用。

## 建议入口提示

1. Run the synthetic offline demo and explain what this plugin adds to native compaction.
2. Check whether this Codex process has the required Jev configuration without displaying credentials.
3. Evaluate Jev evidence selection on the bundled synthetic Mario, ticket and hotel scenarios.

## 审核测试案例

| 类型 | 操作 | 预期 |
|---|---|---|
| 正例 1 | 运行 demo | 合成数据、固定假分数；不联网，不宣称模型质量 |
| 正例 2 | doctor，配置私有 Key 文件 | 报告是否已配置，不显示 Key；不联网 |
| 正例 3 | 授权后导出指定合成 transcript | 创建新文件，原文件不变，报告请求数 |
| 正例 4 | 可信 PreCompact → 原生压缩 → SessionStart(compact) | 限长恢复一次，当前用户指令优先 |
| 正例 5 | 读取所选记录的长输出中间页 | 只读本地完整记录，不重新派发工单/预订酒店 |
| 反例 1 | 未启用或缺 Key | 不调用 TypeSafe，原生压缩继续 |
| 反例 2 | API 超时、401、429、529 或异常概率 | 不恢复旧检查点，不重试计费请求，不泄露错误正文 |
| 反例 3 | 输出已存在、过期快照、其他 workspace | 拒绝覆盖或读取，不上传其他会话 |

## 必须通过的发布门槛

- [x] Node 22/24 在 macOS/Linux/Windows 的 CI 全部通过（运行时 hook 链路不能用跨平台单测替代）。
- [ ] 真实 Jev API 合成集评估：记录模型版本、逐例保留结果、usage 和延迟；不以 oracle 分数代替。
- [ ] 真实 Codex + 真实 Jev 完整链路；安装、信任、手动/自动压缩、立即续跑和 429 回退已用真实运行时 + 本地模型/Jev 桩验证，二次压缩测试见报告。
- [ ] 与原生压缩的配对任务评估：至少覆盖旧证据、用户纠正、临时错误、有副作用动作及长输出中间事实；关键事实召回不下降，无重复副作用。
- [ ] 测额外上下文、API 延迟和实际费用；没有数据则不写节省百分比。
- [ ] 干净机器安装、Key 配置、禁用和清理说明可按文档完成。
- [ ] 发布身份、地区、公开政策页面和平台账户权限可用；上传包扫描通过。

提交入口：https://platform.openai.com/plugins 。提交启动审核，审核通过后再发布；目前没有执行提交或发布。
