# Scope bar + chat-driven scoping with resolve-then-confirm (D19)

Status: done
Slice: 17

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D19).

## What to build

A scope system for study generation, driven by a persistent structured object and an always-visible scope bar. Scope is a structured object (`source`, `range` [structural or concept-resolved], `count`, `difficulty`, `format`) — the single source of truth the bar renders, sitting above the generate button so the user always sees exactly what will be generated. Scope persists across reload.

Both the chat and the bar's `[edit]` control mutate it. A scope-changing chat message ("only up to mitosis, 20 questions") is parsed by Gemini into a **diff the user sees applied** to the bar — never a silent mutation. Scope can be expressed by structure (pages/sections) or by concept ("up to mitosis"). A **concept range resolves-then-confirms**: it's mapped to a concrete range (reusing the D16 topic/structure data), shown, and generation is **blocked until the user confirms** — so the user never revises the wrong material from a silent mismatch. This also delivers the notes+documents two-deck source selection: two clearly labelled decks that are never merged.

## Acceptance criteria

- [ ] An always-visible scope bar above the generate button renders the current scope (story 42)
- [ ] Scope is a persistent structured object that survives reload
- [ ] A scope-changing chat message is parsed into a diff shown applied to the bar, never a silent mutation (stories 43, 44)
- [ ] The bar's edit control mutates scope directly too (story 45)
- [ ] Scope can be set by structure (pages/sections) or by concept (story 46)
- [ ] Concept ranges resolve to a concrete range, are shown, and block generation until confirmed (story 47)
- [ ] notes+documents produces two clearly labelled decks that are never merged (stories 34, 35)

## Blocked by

- #9
- #13
- #16
