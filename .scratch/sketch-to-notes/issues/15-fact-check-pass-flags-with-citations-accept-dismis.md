# Fact-check pass — flags with citations, Accept/Dismiss, dismissals persist (D15)

Status: done
Slice: 15

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D15).

## What to build

A fact-check pass that flags where the board contradicts an attached source, with a citation. It runs after notes appear, only when a document is attached. Input: corrected notes + retrieved relevant chunks (via `retrieve`). Output: structured discrepancies `{ boardClaim, sourceClaim, citation: {docId, page}, severity }`.

**Every flag's citation is verified locally against the retrieved chunk before display; unverifiable flags are dropped** — a correction is evidence, not the model just asserting things. The user can **Accept or Dismiss** each flag. Accept marks the flag and *offers* to edit the specific note line (user confirms) — it never auto-edits the board or notes and never touches ink. Dismiss persists and **stays dismissed across regeneration** via a discrepancy fingerprint (reusing the shared regeneration primitive), so the user isn't re-nagged. Flags are stored per board.

## Acceptance criteria

- [ ] After notes, with a document attached, the pass produces discrepancies with the shape above (story 26)
- [ ] Each flag carries the exact source claim + page citation (story 27)
- [ ] Every citation is verified locally against its retrieved chunk before display; unverifiable flags are dropped (D15)
- [ ] Accept offers to edit the specific note line on user confirmation; nothing auto-edits notes or ink (story 28)
- [ ] Dismiss persists across regeneration via fingerprint, using the shared regeneration primitive (story 29)
- [ ] Unit tests: flags with unverifiable citations are dropped; dismissed flags don't reappear after regeneration, model stubbed (D15)

## Blocked by

- #12
- #7
