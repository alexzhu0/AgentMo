# AgentMo Linux x64 preload asset

`agentmo-nondumpable-preload.so` is admitted only at the repository-pinned
SHA-256. The Phase 4 Linux gate independently compiles its source twice to
prove deterministic source/toolchain output, then executes the pinned asset in
the same-UID descriptor attack. Cross-toolchain compiler bytes are not treated
as portable identity evidence.
