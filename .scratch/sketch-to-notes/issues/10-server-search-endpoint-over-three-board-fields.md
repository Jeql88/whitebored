# Server search endpoint over three board fields (D20)

Status: ready-for-agent
Slice: 10

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D20).

## What to build

Rework search from the current flat client-side `textIndex` filter to a server endpoint over Mongo's text index. Replace the single `textIndex` with three distinct board fields — `transcriptionText`, `typedLabelsText`, `notesText` — plus board name. Search runs server-side, scoped to boards the user can access, and returns **which field matched** so a result can say whether the hit was in notes, a typed label, or handwriting. Typed labels are read directly from the Excalidraw scene. Search is keyword/substring only and is **never sent to AI** — instant, offline, free. Ships scoped to the user's own boards; the mechanism is built to widen to the Space later with no change.

## Acceptance criteria

- [ ] Board documents carry `transcriptionText`, `typedLabelsText`, `notesText` (replacing the flat `textIndex`)
- [ ] A server search endpoint queries Mongo's text index over those fields + name, scoped to accessible boards
- [ ] Results indicate which field matched (story 49)
- [ ] Search across transcribed handwriting, typed labels, and generated notes together (story 48)
- [ ] Search is keyword/substring only, never sent to AI (story 50)
- [ ] The dashboard client search is switched to the new endpoint

## Blocked by

- #3
- #6
