---
phase: 02-codex-builder
reviewed: 2026-07-24T17:59:09Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - AGENTS.md
  - .planning/phases/02-codex-builder/02-18-PLAN.md
  - .planning/phases/02-codex-builder/02-REVIEW.md
  - src/builder-immutable-journal.js
  - src/builder-codex-uat.js
  - test/builder-immutable-journal-v1.test.js
  - test/builder-codex-uat.test.js
  - test/codex-builder-behavior.test.js
  - test/builder-codex-uat-prior-attempt.test.js
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
review_scope_status: stopped_after_confirmed_blocker
---

# Phase 02: Post-Fix Code Review Report

**Reviewed:** 2026-07-24T17:59:09Z
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

A release-packed, generic `file:` importer can irreversibly poison a valid
Codex UAT attempt by appending a non-UAT immutable-journal entry. The public
head admission is sufficient for that append, while the private capability is
checked only when the *new* bytes claim the UAT v2 schema. The next canonical
UAT load then rejects the mixed history, so the attempt cannot resume or
terminate through the closed APIs.

Review stopped after confirming this blocker, as requested. The remaining
in-scope host and I/O-inventory paths were not assessed.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Generic packed importer can permanently poison a UAT attempt journal

**Classification:** BLOCKER

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:344-359`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:705-724`, and `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:367-371`

**Issue:** `appendImmutableJournalEntry()` requires the private UAT
capability only when its incoming `canonicalBytes` parse with
`schemaVersion: "agentmo.codex-uat-attempt-journal.v2"`. A generic packed
caller can instead load a valid UAT journal, receive the genuine public
`head` admission, and append arbitrary non-UAT bytes with that admission.
`selectDesiredAppend()` accepts the head and commits the successor. The UAT
loader subsequently parses every immutable entry as a UAT entry and rejects
the non-UAT successor; because the journal is append-only, canonical UAT APIs
can no longer recover, resume, or terminate the attempt.

This is an authorization-boundary bypass and irreversible denial of service,
not merely a malformed-input rejection. It violates the requirement that UAT
mutation flows only through evidence-derived canonical start-to-terminate
transitions.

**Reproduction evidence:** An isolated temporary release fixture legally
started a UAT attempt, then imported the release-packed
`src/builder-immutable-journal.js` by `file:` URL. With the genuine
`current.head`, its append of `Buffer.from("generic-poison\\n")` returned
`{ committed: true, appendStatus: "committed-clean" }` and advanced the
generic view from one to two entries. A subsequent
`loadCodexUatAttemptJournal(journalPath)` returned
`AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED`. The temporary fixture was
removed after the check.

The existing packed-import regression in
`test/builder-codex-uat.test.js:246-299,1275-1320` only attempts entries
whose new bytes are UAT v2 and therefore exercise the current guard; it does
not attempt a non-UAT successor of a legal UAT head.

**Fix:** Make the capability decision after loading the journal and treat the
entire continuation of a UAT history as UAT-scoped. Reject a non-UAT successor
when any admitted existing entry is canonical UAT, and require the private
canonical UAT capability for every append to such a journal. Preserve the
current capability requirement for a UAT genesis entry. Add a release-packed
`file:` regression that:

```js
const current = await packedGeneric.loadImmutableJournal({ journalPath });
await assert.rejects(
  packedGeneric.appendImmutableJournalEntry({
    journalPath,
    canonicalBytes: Buffer.from("generic-poison\\n"),
    expectedPredecessorAdmission: current.head,
  }),
  (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
);
await loadCodexUatAttemptJournal(journalPath); // remains usable
```

The detection must inspect internal admitted entry bytes (or an equivalent
unforgeable journal-mode marker), not a caller-supplied flag.

---

_Reviewed: 2026-07-24T17:59:09Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
