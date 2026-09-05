# Rename human chat to Room; AI Chat tab with provenance tags (D10, D11)

Status: done
Slice: 13

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D10, D11).

## What to build

Introduce the AI Chat tab and resolve the naming collision with the existing chat. The **existing human-to-human socket chat is renamed "Room"** and kept as the live collaboration tool. The **new AI conversation becomes the "Chat" tab** — a new panel component, not a modification of the existing floating box.

Every AI answer is tagged with its source, and the tag is **provenance-based, not self-reported**: it follows from which context bucket grounded the answer — board text → "from your board"; retrieved document chunk → "from [doc], p.N"; neither → "general knowledge". The model is explicitly allowed to say "not in your material" and answer as general knowledge. Board/document tags are **verified locally** (key terms appear in board text, or the citation points to a real retrieved chunk) before the tag renders. The general-knowledge tag is visually distinct so untraceable facts can't sneak in through the side door.

## Acceptance criteria

- [ ] The existing human chat is renamed "Room" and still works as live collaboration messaging (story 21)
- [ ] A new AI "Chat" tab answers questions about the board, notes, or documents (story 16)
- [ ] Every answer carries a source tag derived from provenance: board / document+page / general knowledge (story 17)
- [ ] Board/document tags are verified locally before rendering; the model may answer "not in your material" as general knowledge (D11)
- [ ] The general-knowledge tag is visually distinct (story 18)
- [ ] Unit tests: tags are provenance-derived, and a board/document tag whose terms/citation don't verify is downgraded or dropped, model stubbed (D11)

## Blocked by

- #6
- #12
