# Mock-exam view + full-screen study route (D17, D22)

Status: ready-for-agent
Slice: 9

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D17, D22).

## What to build

The mock-exam view: a second view over the same card data as flashcards (not a separate data model). The exam disclaimer — plain text that it's from the user's notes and not a real-exam prediction — is a view property. Flashcards and exams open in their own full-screen route, not a cramped side tab. This slice covers the notes-only source; the notes+documents two-deck story arrives with the documents/scope slices.

## Acceptance criteria

- [ ] A mock exam renders from the same card records as flashcards (two views, one data model) (story 33)
- [ ] The exam carries a plain disclaimer that it's from the user's notes, not a real-exam prediction (story 38)
- [ ] Flashcards and exams open in a dedicated full-screen route, not a tab (story 41)
- [ ] Source selection supports "my notes only" (story 34, notes-only portion)

## Blocked by

- #8
