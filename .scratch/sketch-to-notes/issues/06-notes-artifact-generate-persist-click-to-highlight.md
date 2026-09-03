# Notes artifact — generate, persist, click-to-highlight, streaming (D6, D8, D9)

Status: ready-for-agent
Slice: 6

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D6, D8, D9, D22 layout).

## What to build

Phase 2 of the pipeline: turn corrected transcription into a persistent, editable Notes artifact beside the canvas. Notes are a structured list of lines (one notes record per board); each line carries `text`, `kind` (summary / heading / key-point / sequence-step), `sourceElementIds`, and `origin` (board / chat). The artifact persists — it is not a chat message that scrolls away.

Note type (Lecture / Meeting / Process / Freeform), chosen before generating, changes the prompt template only; all four feed the single line shape. Process-map power (ordered steps) comes from reading Excalidraw arrows/bindings directly.

Notes stream in line-by-line over the existing Socket.IO channel. Each line appears only after passing a **local** verification check — its key terms appear in the transcription (a string/term match, not an AI call) — so nothing flickers or is retracted. Clicking a note line highlights the shape it came from on the board.

This slice introduces the AI panel, so it also lands the responsive layout (D22): docked right column on wide screens with the canvas reflowing (Excalidraw viewport update), slide-over sheet on narrow screens.

## Acceptance criteria

- [ ] Pressing Generate produces notes from the corrected transcription and persists them as one editable record per board (story 8)
- [ ] Each note line stores `text`, `kind`, `sourceElementIds`, `origin`
- [ ] A note type picker (Lecture / Meeting / Process / Freeform) selects the prompt template before generating (story 10)
- [ ] Notes stream line-by-line over Socket.IO; a line renders only after local key-terms verification passes (stories 14, 15)
- [ ] Clicking a note line highlights its source shape on the board (story 9)
- [ ] Panel is a docked right column (canvas reflows) on wide screens and a slide-over sheet on narrow (stories 54, 55)
- [ ] Unit tests: verification drops un-traceable lines with the model stubbed (D9)

## Blocked by

- #4
- #1
