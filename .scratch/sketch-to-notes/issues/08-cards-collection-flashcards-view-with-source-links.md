# Cards collection + Flashcards view with source links (D17, D18)

Status: done
Slice: 8

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D17 partial, D18).

## What to build

Flashcards generated from the user's notes, as first-class card records in their own collection: `{ question, answer, deck: notes|document, source: sourceElementIds | citation, boardId, reviewState }`. This slice delivers the notes-only deck (shapes-only): each card links back to the shape it came from. Relationship questions ("what comes after Approval?") are generated from Excalidraw arrows/bindings — questions a text-only tool couldn't produce. Card verification reuses the local key-terms check.

Spaced repetition uses SM-2 (`ease`, `interval`, `dueDate`, `lapses` per card) — pure arithmetic, no AI cost. On regenerate, new cards are matched to existing ones by `sourceElementIds` + question fingerprint (via the shared regeneration primitive) so unchanged cards keep their schedule; deleted-shape cards retire; genuinely new cards start fresh.

## Acceptance criteria

- [ ] Flashcards generate from notes as records with the fields above, in their own collection
- [ ] Each notes-deck card links to its source shape (story 36)
- [ ] Relationship questions are generated from diagram arrows/bindings (story 37)
- [ ] SM-2 scheduling fields are maintained per card (story 39)
- [ ] Review history survives regeneration via matching (unchanged keep schedule, deleted retire, new start fresh) (story 40)
- [ ] Unit tests: card verification drops un-traceable cards; review state survives regeneration, model stubbed (D17, D18)

## Blocked by

- #6
- #5
