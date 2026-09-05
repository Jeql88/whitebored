import { describe, it, expect } from "vitest";
import { isAddable, addToNotesPayload, usableCitation } from "./addToNotes";

const answer = (bucket, extra = {}) => ({
  role: "assistant",
  text: "Mitosis has four phases",
  source: { bucket, addableToNotes: bucket !== "general", ...extra },
});

describe("add to notes from chat", () => {
  it("offers the move on a board answer", () => {
    expect(isAddable(answer("board", { sourceElementIds: ["s1"] }))).toBe(true);
  });

  it("offers the move on a document answer that carries a real citation", () => {
    expect(isAddable(answer("document", { docId: "d1", page: 3 }))).toBe(true);
  });

  it("never offers the move on general knowledge (story 19)", () => {
    expect(isAddable(answer("general"))).toBe(false);
  });

  it("does not offer a document answer whose citation is incomplete", () => {
    expect(isAddable(answer("document", { docId: "d1" }))).toBe(false);
    expect(isAddable(answer("document", { page: 3 }))).toBe(false);
  });

  it("never offers the move on the user's own message", () => {
    expect(isAddable({ role: "user", text: "what is mitosis?" })).toBe(false);
  });

  it("carries shapes for a board answer and a citation for a document answer", () => {
    expect(addToNotesPayload(answer("board", { sourceElementIds: ["s1"] }))).toEqual({
      text: "Mitosis has four phases",
      bucket: "board",
      sourceElementIds: ["s1"],
      citation: null,
    });

    expect(addToNotesPayload(answer("document", { docId: "d1", page: 3 }))).toEqual({
      text: "Mitosis has four phases",
      bucket: "document",
      sourceElementIds: [],
      citation: { docId: "d1", page: 3 },
    });
  });

  it("returns no payload for an answer that may not move", () => {
    expect(addToNotesPayload(answer("general"))).toBeNull();
  });

  it("usableCitation rejects a half-citation", () => {
    expect(usableCitation({ docId: "d1", page: 0 })).toBeNull();
    expect(usableCitation({ docId: "", page: 2 })).toBeNull();
    expect(usableCitation({ docId: "d1", page: 2 })).toEqual({ docId: "d1", page: 2 });
  });
});
