# Regenerate notes — AI reconciliation fenced by grounding (D7)

Status: ready-for-agent
Slice: 7

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D7).

## What to build

Regenerate notes with AI reconciliation, fenced by grounding, so a user's corrections survive and improve the whole document instead of being wiped. The user's edited/added lines are passed to the AI as **fixed constraints it must honor**; the AI may reword, reorder, or merge the rest for coherence, but every output line must still trace to a shape (or be a protected line). The verification pass runs on the regenerated notes: anything not appearing on the board is dropped or flagged. The AI is forbidden from inventing facts during regeneration — a "coherence improvement" can never slip in something the user didn't draw. First-generate and regenerate share the same machinery. Matching protected lines across regeneration reuses the shared regeneration primitive.

## Acceptance criteria

- [ ] Hand-edited and added lines are preserved across regeneration (story 11)
- [ ] Regeneration folds edits in coherently (reword/reorder/merge the rest), not just protect them in place (story 12)
- [ ] Every regenerated line traces to a shape or is a protected line; invented lines are dropped/flagged (story 13)
- [ ] Protected-line matching uses the shared regeneration primitive
- [ ] Unit tests: regeneration honors protected lines and drops invented ones, model stubbed (D7)

## Blocked by

- #6
- #5
