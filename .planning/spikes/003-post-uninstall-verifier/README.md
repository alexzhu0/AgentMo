---
spike: 003
name: post-uninstall-verifier
type: standard
validates: "Given the project-local runtime and receipt have been removed, when a verifier from an exact packed release inspects journal and candidate bytes, then it can preview and decide only for the bound successor release while rejecting baseline or foreign verifiers"
verdict: VALIDATED
related: [001, 002]
tags: [uninstall, verifier, package, admission]
---

# Spike 003: Post-Uninstall Verifier

## What This Validates

Given a completed eleven-scenario journal whose final uninstall removed the project-local runtime, verify that a standalone verifier extracted from the exact successor tarball can inspect candidate bytes and append one human decision without relying on the deleted launcher or current receipt.

## Research

The experiment uses only local Node.js, `npm pack`, and system `tar`. Two real packages share the same verifier source but have different semantic versions and independently derived release/tarball digests.

| Approach | Pros | Cons | Status |
|---|---|---|---|
| Call deleted project launcher | Preserves prior CLI path | Impossible after successful uninstall | Rejected |
| Trust any extracted package verifier | Easy to run | Baseline/foreign release could approve successor evidence | Rejected |
| Freshly extract exact successor tarball and self-check verifier/release identity | Survives uninstall and binds release + tarball + candidate | Requires explicit tarball path/digest at human gate | Tested |

## How to Run

```bash
node --test .planning/spikes/003-post-uninstall-verifier/spike.test.mjs
```

## What to Expect

The tests build two real tarballs, remove the simulated project runtime, run read-only preview, reject baseline/wrong/tampered/stale verifiers, append one exact decision, and reject a second decision.

## Investigation Trail

- The first packaging run attempted to use the real user npm cache and was blocked by the sandbox. Moving `HOME` and npm cache into the spike root made both tarballs reproducible without touching user state.
- The project-local launcher directory was renamed away before candidate publication and verifier execution. Preview still succeeded because the verifier was freshly extracted from the packed successor release and needed only the journal root, candidate digest, expected head, and exact tarball.
- Preview produced bounded digests/version only and did not append an entry.
- Baseline verifier plus baseline tarball was rejected against the successor candidate. Successor verifier plus baseline tarball was also rejected.
- Modifying the extracted verifier caused its embedded verifier digest check to fail before evidence admission.
- Wrong expected head and candidate digests were rejected. The exact successor verifier appended one `human-admission`; a second decision using the prior head was rejected.

## Results

**Verdict: VALIDATED — 2/2 packed integration tests pass.** Post-uninstall exact admission is feasible without the deleted project launcher or current receipt when all of the following are true:

1. baseline and successor have different semantic versions, release digests, and tarball digests;
2. the candidate records the exact successor version/release/tarball identity;
3. the verifier is freshly extracted from that tarball, recomputes its own verifier/release identity, and hashes the supplied tarball;
4. preview is a separate read-only command that emits only bounded digests;
5. decision requires the exact previewed head/candidate pair and appends at most one successor.

This verifier proves exact package/evidence correspondence only. Per D-29/D-31, it does not prove that the observation originated cryptographically from Codex; that remains the human normal-trust/auth boundary.
