# Add to notes from chat with provenance preserved (D11, D12)

Status: ready-for-agent
Slice: 14

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D11, D12).

## What to build

Let the user move a chat answer into their notes without laundering general knowledge into the artifact. An **"Add to notes" button appears only on board- and document-sourced answers** — never on general-knowledge answers. An added line keeps its origin tag in the notes model, so provenance survives the move. Document-sourced added lines are stored with `origin=document` + a citation (not `sourceElementIds`); they're allowed in the notes artifact but **excluded from the notes-only flashcard deck**, which stays shapes-only.

## Acceptance criteria

- [ ] "Add to notes" appears only on board/document answers, never on general-knowledge ones (story 19)
- [ ] An added line retains its source tag in the notes model (story 20)
- [ ] Document-origin lines are stored with `origin=document` + citation, and are excluded from the notes-only deck (D12)
- [ ] Unit tests confirm the notes-only deck filter excludes document-origin lines

## Blocked by

- #13
- #8
