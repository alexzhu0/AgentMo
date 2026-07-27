---
spike: 002
name: append-only-journal-order
type: standard
validates: "Given one immutable attempt journal, when candidate publication, forks, crashes, and human decisions occur, then a unique acyclic chain can classify every reachable state without a mutable head"
verdict: VALIDATED
related: [001]
tags: [journal, cas, recovery, evidence]
---

# Spike 002: Append-Only Journal Order

## What This Validates

Given one immutable UAT attempt journal, candidate leaves, interruptions, forks, and human decisions, verify that publication order stays acyclic and every admitted state is derived from one unique predecessor chain.

## Research

This is a pure local persistence protocol with no external dependency. The experiment compares two directions:

| Direction | Consequence | Status |
|---|---|---|
| `candidate-ready entry -> candidate referencing journal head` | Candidate points back into the state authority and conflicts with locked D-30 | Rejected |
| `candidate leaf -> candidate-ready entry referencing candidate digest -> human decision entry` | Candidate is immutable and non-authoritative until the journal binds it; no back-reference or cycle | Tested |

The prototype uses content-addressed immutable entry files, exclusive creation, predecessor digests, a bounded unique-chain scan, and no mutable head file.

## How to Run

```bash
node --test .planning/spikes/002-append-only-journal-order/spike.test.mjs
```

## What to Expect

Tests cover the full eleven-scenario gate, early candidate rejection, orphan candidate recovery, fork/gap rejection, ignored staging debris, malformed published entries, mutually exclusive failure/interruption, and single human decision.

## Investigation Trail

- Publishing the candidate as a content-addressed leaf did not change the journal head. Reusing the same leaf after a simulated crash produced the same digest and allowed a later `candidate-ready` successor.
- A candidate contains the attempt identity, successor release digest, ordered evidence digest, scenario count, and false certification flags—but no journal head. The `candidate-ready` entry is the first state-authority object that references the candidate digest.
- The transition evaluator rejected early candidate production and out-of-order scenarios. In particular, activation precedes `trust-auth-observed`, which precedes `session-start` observation.
- Two distinct children of one predecessor produced a detectable fork; an entry with a missing predecessor produced a gap/orphan rejection. The loader did not choose either as current.
- A staging file was ignored because it was not an entry. A malformed published entry failed the entire scan closed.
- `failure` and `interruption` were terminal and mutually exclusive; a second human decision was rejected.

The validated transition table is:

| Entry/action | Legal predecessor state | New state |
|---|---|---|
| `attempt-started` | empty | started |
| `setup-applied` | started | setup |
| `activation-applied` | setup | activated |
| `trust-auth-observed` | activated | observing |
| `scenario-observed(N)` | observing with next fixed scenario `N` | observing or scenarios-complete |
| candidate leaf publication | scenarios-complete | unchanged; leaf is non-authoritative |
| `candidate-ready` | scenarios-complete plus exact matching candidate leaf | candidate-ready |
| `human-admission` / `human-rejection` | candidate-ready | terminal |
| `failure` / `interruption` | any nonterminal state before candidate-ready | terminal |

`resume` is not an entry kind. It is a deterministic action derived from the unique admitted current state.

## Results

**Verdict: VALIDATED — 5/5 hostile protocol tests pass.** A single append-only journal can represent the complete UAT lifecycle without a mutable head or digest cycle when the candidate is published first as a non-authoritative leaf and then referenced by `candidate-ready`.

The Phase 2 plans must reverse their current candidate direction: candidate bytes must not reference `candidate-ready` or any journal head. They must also include the complete transition table above rather than only an entry vocabulary.
