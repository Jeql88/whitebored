# PRD: Sketch-to-Notes (V1)

Status: ready-for-agent

> Synthesized from the `/grill-me` session on the Sketch-to-Notes product spec.
> Records 23 decisions (D1–D23) and three spec corrections that grilling surfaced.
> This is the durable record; it supersedes the raw spec wherever they conflict.

---

## Problem Statement

Sketching is the fastest way to think, but a sketch is a dead end. It's an image —
not searchable, not shareable as text, not a deliverable. So the work gets redone by
typing it up, or it gets lost. And nobody ever checks whether what they scribbled was
actually right.

The app today already has a hand-drawing canvas (Excalidraw), realtime collaboration,
and on-demand Google OCR that dumps a flat blob of recognized text into a per-board
search index. But that OCR text isn't structured, isn't linked back to what was drawn,
can't be turned into study material, and is never checked against a source. There is no
way to turn a board into trustworthy notes, ask questions grounded in the board, or find
out where the board contradicts the lecturer's slides.

## Solution

A three-tab AI panel beside the canvas (Notes / Chat / Documents) plus a full-screen
study mode, all built on a rewritten recognition pipeline that reads the drawing itself
(handwriting **and** diagram structure) with Gemini instead of Google Vision.

The user draws, presses **Generate Notes**, reviews and corrects what was read, and gets
structured, searchable notes where **every line traces back to a shape on the board**.
They can attach source material (PDF, slides-as-PDF, images, text); the app checks the
board against it (fact-check with citations), reports what the board doesn't cover, and
answers questions in Chat with a source tag on every answer. They can generate flashcards
and mock exams scoped to their notes, the documents, or both — with the notes-only deck
guaranteed to trace to shapes they drew. Groups of friends share a Space where everyone's
boards are visible, searchable, and combinable into a group study session.

The load-bearing promise is **not misleading the user** (spec §7): the board is the only
source for notes; reference material can flag/expand/inform/answer but never introduces a
topic into the notes; gaps are surfaced, never silently filled; and everything that can't
point at a shape is tagged as such.

## User Stories

### Recognition & transcription review

1. As a note-taker, I want to press one button and have the AI read both my handwriting and my diagram structure, so that my sketch becomes usable text without me retyping it.
2. As a note-taker, I want typed text labels to be taken as-is (never re-recognized), so that text I already digitized is never corrupted by OCR.
3. As a note-taker, I want the AI to use my diagram's arrows and boxes to understand structure, so that a process map comes back as steps and handoffs, not prose.
4. As a note-taker, I want to see exactly what the AI read *before* it writes notes, so that I can fix misread words before they propagate.
5. As a note-taker, I want to correct wrong words inline in the transcription, so that the notes are generated from what I actually wrote.
6. As a note-taker, I want illegible ink shown as a first-class `[unclear]` gap I can tap and fix, so that the app never silently guesses at a scrawl.
7. As a note-taker, I want the original strokes never auto-deleted, so that the drawing remains the source of truth and I can always re-read it myself.

### Notes artifact

8. As a note-taker, I want my notes to persist as an editable artifact (not a chat message that scrolls away), so that I can come back to them and refine them.
9. As a note-taker, I want to click a note line and see the shape it came from highlighted on the board, so that I trust the note traces to something I drew.
10. As a note-taker, I want to pick a note type (Lecture / Meeting / Process / Freeform) before generating, so that the notes come out shaped for what I drew.
11. As a note-taker, I want to edit a note line by hand and keep that edit when I regenerate, so that my corrections aren't wiped every time I press Generate.
12. As a note-taker, I want regeneration to fold my edits in coherently (not just protect them in place), so that the whole document stays consistent with the correction I made.
13. As a note-taker, I want the AI forbidden from inventing facts during regeneration, so that a "coherence improvement" never slips in something I didn't draw.
14. As a note-taker, I want notes to stream in line-by-line as they're ready, so that the wait feels responsive instead of a dead spinner.
15. As a note-taker, I want a streamed line to only appear once it's confirmed to trace to the board, so that I never see a line flicker and get retracted.

### Chat

16. As a note-taker, I want to ask questions about my board, my notes, or my documents in a Chat tab, so that I can interrogate my material without leaving the app.
17. As a note-taker, I want every chat answer tagged with its source (from your board / from a document with a page / general knowledge), so that I never mistake general knowledge for something I wrote.
18. As a note-taker, I want the general-knowledge tag to look visually distinct, so that untraceable facts can't sneak into my notes through the side door.
19. As a note-taker, I want an "Add to notes" button only on board- and document-sourced answers, so that I can't accidentally add general knowledge to my notes.
20. As a note-taker, I want an added chat line to keep its source tag in the notes, so that provenance survives the move into the artifact.
21. As a note-taker, I want to still have a live human chat ("Room") with the people on my board, so that collaboration messaging isn't lost when the AI chat takes the "Chat" name.

### Documents

22. As a note-taker, I want to attach source material per board (PDF, images, plain text; slides exported to PDF), so that the AI can check and answer against it.
23. As a note-taker, I want to read the attached document inline in a Documents tab, so that I don't have to leave the app to consult it.
24. As a note-taker, I want clicking any citation (fact-check flag, chat source tag) to jump to that page in the document, so that I can verify the source in one tap.
25. As a note-taker, I want everything to still work with nothing uploaded, so that documents are an enhancement and never a requirement.

### Fact check & coverage

26. As a note-taker, I want the app to flag where my board contradicts the source, with a citation, so that I find out before an exam that I had something backwards.
27. As a note-taker, I want each fact-check flag to carry the exact source claim and page, so that a correction is evidence, not the model just asserting things.
28. As a note-taker, I want to Accept or Dismiss each flag, and never have it auto-edit my board or notes, so that I stay in control when the source is wrong or out of date.
29. As a note-taker, I want a dismissed flag to stay dismissed when I regenerate, so that I'm not re-nagged about something I already judged.
30. As a note-taker, I want a coverage report of which document topics my board does and doesn't touch, so that I know what I didn't write down.
31. As a note-taker, I want the "N topics" count to stay stable across regenerations, so that the coverage number feels trustworthy, not random.
32. As a note-taker, I want gaps surfaced but never silently added to my notes, so that the tool stays a revision aid and not a crutch.

### Study

33. As a student, I want to generate flashcards and mock exams from my material, so that I can revise actively.
34. As a student, I want to choose the source (my notes only / notes + documents / documents only), so that I control whether I'm revising what I know or what I missed.
35. As a student, I want notes + documents to produce two clearly labelled decks that are never merged, so that I keep an honest picture of what I actually know.
36. As a student, I want each notes-deck card to link to the shape it came from, so that I trust it traces to something I drew.
37. As a student, I want relationship questions generated from my diagram ("what comes after Approval?"), so that I get questions a text-only tool couldn't produce.
38. As a student, I want a mock exam to carry a plain disclaimer that it's from my notes and not a real-exam prediction, so that I don't over-trust it.
39. As a student, I want spaced repetition scheduling on my cards, so that I review them at the right times.
40. As a student, I want my review history preserved when I regenerate cards after editing the board, so that weeks of review aren't reset by a small change.
41. As a student, I want flashcards and exams to open in their own full view, so that studying isn't cramped into a side tab.

### Scope

42. As a student, I want an always-visible scope bar above the generate button, so that I can see exactly what will be generated.
43. As a student, I want to change scope by typing in chat ("only up to mitosis, 20 questions"), so that I can adjust quickly.
44. As a student, I want a chat scope change shown as a diff applied to the scope bar, so that I always see what changed instead of it silently persisting.
45. As a student, I want to edit scope directly via the bar too, so that chat is a shortcut and not the only handle.
46. As a student, I want to scope by structure (pages/sections) or by concept ("up to mitosis"), so that I can express range the way I think.
47. As a student, I want a concept range resolved to a concrete range and confirmed before generating, so that I never revise the wrong material from a silent mismatch.

### Search & group space

48. As a note-taker, I want to search across my transcribed handwriting, typed labels, and generated notes together, so that I can find anything I've captured.
49. As a note-taker, I want search results to tell me which source matched, so that I know whether a hit was in my notes, a label, or my handwriting.
50. As a note-taker, I want search to be instant and offline (never sent to AI), so that it's fast, free, and reliable.
51. As a group member, I want a shared Space where everyone's boards are visible and searchable together, so that we can study from each other's notes.
52. As a group member, I want to search the Space and see all versions of a topic, so that I benefit from whoever drew it clearest.
53. As a group member, I want to generate a mock paper from the combined boards with a document attached, so that we can build a revision plan from what we collectively missed.

### Layout & performance

54. As a tablet user, I want the panel to be a slide-over sheet on narrow screens (not a fixed column), so that it doesn't eat half my screen while drawing.
55. As a desktop user, I want the panel docked as a right column with the canvas reflowing, so that I can read and draw at once.
56. As a user, I want generation to never hard-fail on a rate limit, so that a busy moment slows me down rather than breaking the flow.

## Implementation Decisions

### Recognition pipeline (rewrites the current on-demand OCR path)

- **[D2] All Gemini calls live server-side**, mirroring the existing Google Vision setup. The server owns the Gemini key, the grounding prompt, the JSON schema, and every verification step. The client only renders and uploads crops. This keeps the §7 grounding rules tamper-proof (a browser-side prompt could be edited away).
- **[D5] A reading-only `recognize` seam.** Contract (from the grilling session, replacing the spec's `recognize(input) → {text, confidence, sourceElementIds, bbox}`):
  ```
  recognize(crops) → [ { cropId, segments: [{ text, uncertain }], sourceElementIds, bbox } ]
  ```
  No confidence score (spec §7 distrusts self-reported confidence; nothing consumes it). Notes generation is a **separate** step, not part of `recognize`.
- **[D1] Crop grouping, structure-first.** The client groups strokes into crops using, in order of reliability: (1) typed `text` elements → ground truth, routed straight to transcription, never OCR'd; (2) Excalidraw structure — `containerId` bindings, `groupIds`, and geometric containment inside rectangles — defines crop boundaries where present; (3) distance-based agglomerative clustering (gap threshold scaled to stroke height) only for free-floating `freedraw` strokes with no structural signal. Each crop is normalized (upscale, uniform stroke, black-on-white, tight padding). **All crops are batched into one multi-image Gemini request keyed by crop ID** — per-crop linking without N round-trips.
- **[D3] Two-phase pipeline** (corrects spec §6's "one call"). **Phase 1:** crops → transcription + `[unclear]` (no notes). **User reviews/corrects.** **Phase 2:** corrected transcription → notes. Notes are never generated from uncorrected text.
- **[D4] Ship Phase 1 single-pass** with `[unclear]` handling. Store the transcription as **structured segments** (list of `{text, uncertain}`), not a flat string, so the two-pass disagreement flag can be added later without a rewrite. Two-pass (run twice at non-zero temperature, word-diff, mark divergent words uncertain) is deferred until confident-misreads prove real in daily use.

### Notes

- **[D6] Notes are a structured list of lines**, one notes record per board. Each line carries: `text`, `kind` (summary / heading / key-point / sequence-step), `sourceElementIds`, and `origin` (board / chat). Replaces nothing today — notes don't currently exist.
- **[D8] Note type changes the prompt only.** Lecture / Meeting / Process / Freeform are four prompt templates feeding the single D6 shape. Process-map power (ordered steps, relationship questions) comes from reading Excalidraw arrows/bindings directly, not from a per-type schema.
- **[D7] Regenerate uses AI reconciliation, fenced by grounding.** The user's edited/added lines are passed to the AI as **fixed constraints it must honor**; it may reword/reorder/merge the rest for coherence, but **every output line must still trace to a shape (or be a protected line)**, and the verification pass runs on the regenerated notes — anything not appearing on the board is dropped or flagged. First-generate and regenerate share the same machinery.
- **[D9] Streaming + local verification.** Notes stream **line-by-line over the existing Socket.IO channel**. Each line is shown only after passing a **local** verification check (its key terms appear in the transcription — a string/term match, **not** an AI call), so nothing flickers or is retracted. Zero extra Gemini cost.

### Chat & Documents

- **[D10] Two chats coexist.** The **new AI conversation is the "Chat" tab**; the **existing human-to-human socket chat is renamed "Room"** and kept as the live collaboration tool. The AI chat is a new panel component, not a modification of the existing floating box.
- **[D11] Chat source tags are provenance-based, not self-reported.** The tag follows from which context bucket grounded the answer: board text → "from your board"; retrieved document chunk → "from [doc], p.N"; neither → "general knowledge". The model is explicitly allowed to say "not in your material" and answer as general knowledge. Board/document tags are **verified locally** (key terms appear in board text / citation points to a real retrieved chunk) before the tag renders. "Add to notes" appears only on board/document answers.
- **[D12] Added chat lines keep their origin tag** in the notes model. Document-sourced added lines are stored with `origin=document` + a citation (not `sourceElementIds`); they're allowed in the notes artifact but **excluded from the notes-only flashcard deck**, which stays shapes-only.
- **[D13] Documents.** Accept PDF + images + plaintext (users export slides to PDF themselves — no server-side conversion infra). Store raw files in **GridFS** (stay in Mongo/Atlas, no new external service). Render inline with a client-side PDF viewer supporting **jump-to-page** so citations deep-link. Normalize every document to a list of "pages" internally (PDF = real pages; image = single page; text = synthetic chunks/sections) so the citation model is uniform. Require a text layer in V1; defer scanned-document OCR.
- **[D14] Retrieval seam.** Chunk + embed documents at upload via Gemini free-tier embeddings; store as `{docId, boardId, page, text, embedding[]}` in Mongo. Retrieval is **app-side cosine top-k in Node, scoped to the board's chunks**, behind a `retrieve(query, scope) → chunks` seam so Atlas Vector Search can replace the implementation later (group space / cross-board) without touching callers. Embeddings computed once per chunk at upload, never per query.

### Fact check & coverage

- **[D15] Fact-check pass** runs after notes appear, only when a document is attached. Input: corrected notes + retrieved relevant chunks. Output: structured discrepancies `{ boardClaim, sourceClaim, citation: {docId, page}, severity }`. **Every flag's citation is verified locally against the retrieved chunk before display; unverifiable flags are dropped.** Accept marks the flag and *offers* to edit the specific note line (user confirms) — never auto-edits, never touches ink. Dismiss persists and **stays dismissed across regeneration** (via a discrepancy fingerprint). Flags stored per board.
- **[D16] Coverage is two-step.** (1) At document upload/embed time, one Gemini pass extracts a **stable topic list** (each: label + page range) stored with the document — this fixes the "N topics" denominator so it doesn't wobble. (2) At report time, each topic's board-coverage is judged **semantically** using the D14 embeddings (cosine over board content vectors, threshold) or a cheap judgment pass; gaps cite the topic's page range. V1 coverage is **single-board vs. document**; the group-space union arrives with the Space work.

### Study

- **[D17] Cards are first-class records** in their own collection: `{ question, answer, deck: notes|document, source: sourceElementIds | citation, boardId, reviewState }`. **Two decks = a filter on `deck`, never merged in a query** (the honesty rule enforced as a query constraint). Flashcards and mock exam are **two views of the same card data**; the exam disclaimer is a view property. Card verification reuses the D9 local key-terms check. Relationship questions come from Excalidraw arrows/bindings.
- **[D18] Spaced repetition uses SM-2** (`ease`, `interval`, `dueDate`, `lapses` per card). On regenerate, new cards are **matched to existing ones** by `sourceElementIds` + question fingerprint so unchanged cards keep their schedule; deleted-shape cards retire; genuinely new cards start fresh. Pure arithmetic, no AI cost.

### Scope, search, space, layout, cost

- **[D19] Scope is a persistent structured object** (`source`, `range` [structural or concept-resolved], `count`, `difficulty`, `format`) — the single source of truth rendered by the always-visible scope bar. Both chat and the `[edit]` control mutate it; a scope-changing chat message is parsed by Gemini into a **diff the user sees applied** (never a silent mutation). Concept ranges **resolve-then-confirm**: mapped to a concrete range (reusing D16 topic/structure data), shown, and generation is **blocked until the user confirms**. Scope persists across reload.
- **[D20] Search rework.** Replace the flat `textIndex` with three fields on the board: `transcriptionText`, `typedLabelsText`, `notesText`. Move search to a **server endpoint over Mongo's text index** (extended to cover all three + name), scoped to accessible boards, returning **which field matched**. **Keyword/substring only — never sent to AI.** Ships scoped to the user's own boards first; widens to the Space with no change to the mechanism. Typed labels read directly from the Excalidraw scene.
- **[D21] A lightweight "Space" (workspace) entity.** A Space has members; a board optionally belongs to a Space (`spaceId`); membership grants visibility, search scope, and combined study across all boards in the Space. For V1, **one Space everyone joins**. It's an **additional grouping layer on top of** the existing per-board sharing (owner / editors / collaborators / visitors), not a replacement. Largest net-new model; built last.
- **[D22] One responsive panel component:** docked right column on wide screens, **slide-over sheet on narrow** (breakpoint-switched); the canvas reflows when the panel docks (Excalidraw viewport update). Flashcards/exams are a **separate full-screen route**, not a tab. The retained "Room" and comments stay as floating overlays but yield to the panel when it opens.
- **[D23] One central Gemini module** with per-user throttling, a burst-smoothing queue, and 429 backoff-retry (reuse the existing `rateLimit` middleware pattern). Features batch and defer calls (crops batched; fact-check/coverage after notes; chat/scope calls only on submit). Streaming shows a "working" state during waits. This choke point is the single place to swap in a paid Gemini tier if free-tier per-minute limits bite.

### Spec corrections surfaced by grilling

1. **§6 "Gemini returns transcription and notes in one call" contradicts §7 "transcription review before notes generate."** Resolved as the two-phase pipeline (D3). Build-order step 1 ("single call, JSON out") is superseded.
2. **The existing "Chat" is human-to-human, not AI.** The spec's Chat tab is a new feature; the existing one is renamed "Room" (D10). The spec doesn't acknowledge the collision.
3. **The §6 `recognize()` signature (flat `text` + `confidence`) predates the trust model** — it fights structured segments (D4) and §7's distrust of confidence. Rewritten in D5.

### Cross-cutting primitive

Five features (D7 notes, D15 dismissals, D18 cards, and implicitly coverage/scope) all need the same **"protect what's yours across regeneration"** mechanic — matching regenerated content to prior content by `sourceElementIds` + a fingerprint. Build this **once** as a shared primitive and reuse it; it's the highest-leverage piece of infrastructure in the plan.

## Testing Decisions

**What makes a good test here:** assert on **external behavior** — what a module returns given inputs — never on prompt strings, internal call counts, or model prose. The Gemini API is **always stubbed** and never hit in tests; real-model accuracy is validated by daily use (spec §2), not by a test suite. This PRD establishes the repo's first test pattern: **server-side unit tests with the Gemini client injected/stubbed.**

**Three seams to test (confirmed with the developer):**

1. **The central AI module (D23) — primary seam.** With the Gemini call stubbed, assert the deterministic logic wrapped around it:
   - Verification drops un-traceable note lines / cards (D7, D9, D17).
   - Chat tags are provenance-derived, and a board/document tag whose terms/citation don't verify is downgraded or dropped (D11).
   - Fact-check flags with unverifiable citations are dropped (D15).
   - The two-deck filter never returns a merged list (D17).
   - Dismissed fact-check flags don't reappear after regeneration (D15).
   - Card review state survives regeneration via matching (D18).
   - Regeneration honors protected lines and drops invented ones (D7).
2. **`recognize()` (D5) — pure seam.** With stubbed model responses: typed text bypasses OCR, bindings/containment define crop boundaries, clustering applies only to free-floating strokes (D1); output has the structured-segment shape that lets two-pass drop in later (D4).
3. **`retrieve(query, scope)` (D14) — pure seam.** Given known chunks + embeddings, cosine top-k returns the expected chunks. Deterministic (no model call at query time).

**Deliberately not tested:** the Gemini API itself; Excalidraw rendering; the React panel/notes UI (exercised by hand — no component-test prior art in the repo).

**Prior art:** none — the repo currently has no test runner. The first track that needs tests should also add the test runner + the Gemini-stub harness, and later tracks follow that pattern.

## Out of Scope

- **Spec §9 "Explicitly out of V1":** structural gap detection for client deliverables, Word/draw.io export, glossary system, audio recording, board replay, templates, workshop tooling.
- **Two-pass disagreement flagging** (deferred per D4 until confident-misreads prove real; the transcription structure is built to accept it).
- **Scanned-document OCR** (D13 requires a text layer in V1).
- **Atlas Vector Search / any real vector index** (D14 uses app-side cosine; the seam allows the swap later).
- **Group-space union coverage / cross-board chat / cross-board search** beyond what the single Space enables (V5 territory; the Space model is built to generalize).
- **Paid Gemini tier** (D23 leaves the choke point ready; not enabled in V1).
- **Server-side slides→PDF conversion** (users export to PDF themselves).
- **Folding Room/comments into the panel as tabs** (they stay floating overlays for V1).

## Further Notes

- **Build order** (from spec §8, adjusted for the two-phase correction): (1) Gemini swap + two-phase recognition, (2) grounding + `[unclear]`, (3) transcription review step, (4) Notes tab (artifact, click-to-highlight, streaming), (5) Flashcards with source links, (6) Quiz/mock-exam mode, (7) Search, (8) Documents tab, (9) Chat tab with source tagging, (10) Fact-check pass, (11) Coverage report, (12) Scope bar + chat-driven scoping, (13) Shared Space. Steps 1–3 are the foundation ("separates a study tool from a confident liar") — do them first. Steps 8–11 come after flashcards so that when a card is wrong you know whether it's bad recognition or retrieved material bleeding in.
- **Speed is the adoption lever** (spec §8): stream partial results (D9); run fact-check *after* notes appear; keep verification local (no per-line AI call).
- **Existing infrastructure to reuse:** the `/ocr` route shape and Google Vision fallback path (recognition replacement mirrors it); the Socket.IO channel (streaming + Room); the `rateLimit` middleware (the D23 queue); Mongo/Atlas + BetterAuth + per-board sharing (Space layers on top); the client-side board search in the dashboard (replaced by the D20 endpoint).
- **The OCR path is kept as a documented fallback** per spec §6, behind the same `recognize` seam.
