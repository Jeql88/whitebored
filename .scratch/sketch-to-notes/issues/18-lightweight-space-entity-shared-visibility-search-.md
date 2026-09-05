# Lightweight Space entity — shared visibility, search, combined study (D21)

Status: done
Slice: 18

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (D21).

## What to build

A lightweight "Space" (workspace) entity for group study. A Space has members; a board optionally belongs to a Space (`spaceId`); membership grants visibility, search scope, and combined study across all boards in the Space. It is an **additional grouping layer on top of** the existing per-board sharing (owner / editors / collaborators / visitors), not a replacement. For V1, there is **one Space everyone joins**.

Everyone's boards in the Space are visible and searchable together (the D20 search mechanism widens to the Space scope with no change to its mechanism), search shows all versions of a topic, and a mock paper can be generated from the combined boards with a document attached. This is the largest net-new model and is built last.

## Acceptance criteria

- [ ] A Space entity with members exists; boards carry an optional `spaceId`
- [ ] Membership grants visibility of, and layers on top of (does not replace) per-board sharing
- [ ] Space members see everyone's boards visible and searchable together (story 51)
- [ ] Searching the Space surfaces all versions of a topic (story 52)
- [ ] A mock paper can be generated from the combined Space boards with a document attached (story 53)
- [ ] V1 ships one Space everyone joins

## Blocked by

- #10
- #9
- #11
