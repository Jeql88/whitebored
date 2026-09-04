# Shared "protect-what's-yours" regeneration primitive

Status: done
Slice: 5

## Parent

Sketch-to-Notes V1 PRD — `.scratch/sketch-to-notes/PRD.md` (Cross-cutting primitive).

## What to build

Build the shared **"protect what's yours across regeneration"** primitive once, as reusable infrastructure. Five features (notes regeneration D7, fact-check dismissals D15, cards D18, and implicitly coverage and scope) all need the same mechanic: match regenerated content to prior content by `sourceElementIds` + a fingerprint, so user-owned edits, dismissals, and review state survive a regenerate instead of being wiped.

The PRD calls this the highest-leverage piece of infrastructure in the plan. Build it as a standalone, well-tested module with a clear matching API; later slices consume it rather than re-implementing matching.

## Acceptance criteria

- [ ] A shared module matches regenerated items to prior items by `sourceElementIds` + fingerprint
- [ ] Matching handles: unchanged item (keep prior state), deleted-shape item (retire), genuinely new item (fresh)
- [ ] The API is generic enough to serve notes lines, cards, and fact-check dismissals
- [ ] Pure/deterministic — unit-tested with no model call

## Blocked by

- #1
