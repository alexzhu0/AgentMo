# Phase 2 Gap Architecture Spike Manifest

## Idea

用三个隔离、可运行的实验替代继续抽象规划，验证 Phase 2 剩余 blocker 的真实宿主与持久化边界，再把验证结果送回 gap plans。实验代码只存在于 `.planning/spikes/`，不修改 AgentMo 生产实现。

## Requirements

- 保持 `Discover -> Plan -> Produce` 与 Phase 2 范围不变。
- Codex hook 输入只能形成 `value-blind-operator-observation-candidate`；同用户来源不宣称密码学可证明。
- UAT 运行状态只允许一个 append-only、predecessor-bound journal 权威；派生产物不得与 journal 形成 digest 环。
- 所有 Codex CLI 实验使用隔离的临时 `HOME`/`CODEX_HOME`，不得读取项目 `.env` 或真实用户凭据/会话。
- Spike 只验证机制，不构成 domain quality、Agent Package quality、production readiness 或更广 Codex compatibility 认证。
- 本轮不提交 Git；结论必须包含可重跑命令、敌对边界与对 Phase 2 计划的明确影响。
- 固定 `agentmo-local` marketplace 必须投射到独立于任何 consumer project 的 exact user-owned root；项目只持有 consumer reference。
- Candidate 必须先作为无 journal-head 回指的 content-addressed leaf 发布，再由 `candidate-ready` entry 单向引用；`resume` 是从 journal 状态派生的动作，不是第二条生命周期记录。
- UAT session 顺序固定为 setup/activation apply 先完成，再启动本次 fresh normal-trust/auth Codex 进程；只有该新进程的 `SessionStart` 可进入 observation candidate。
- Post-uninstall verifier 必须从 exact successor tarball 全新解包，分别提供只读 preview 与有副作用的 decision；candidate 同时绑定 successor version、release digest 和 tarball digest。

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|---|---|---|---|---|
| 001 | codex-marketplace-ownership | standard | Given two isolated project consumers share one Codex user host, when marketplace/plugin ownership changes or the original source disappears, then the surviving project's visibility and supported ownership model are observed through the real CLI | VALIDATED | codex, marketplace, ownership, lifecycle |
| 002 | append-only-journal-order | standard | Given one immutable attempt journal, when candidate publication, forks, crashes, and human decisions occur, then a unique acyclic chain can classify every reachable state without a mutable head | VALIDATED | journal, cas, recovery, evidence |
| 003 | post-uninstall-verifier | standard | Given the project-local runtime and receipt have been removed, when a verifier from an exact packed release inspects journal and candidate bytes, then it can preview and decide only for the bound successor release while rejecting baseline or foreign verifiers | VALIDATED | uninstall, verifier, package, admission |
