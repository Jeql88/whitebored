import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import StudyView from "./StudyView";
import { getBoardCards, gradeBoardCard } from "../../api/whiteboard";

// StudyRoute — the full-screen study ROUTE container (slice #9, D22/story 41). Mounted
// at /whiteboard/:id/study, it is the dedicated full view for studying a board's cards
// (flashcards + mock exam), NOT a cramped side tab. This is the thin container: it owns
// the fetch and the grade round-trip and hands the presentational StudyView its cards +
// callbacks. StudyView + MockExam + examSession hold all the tested behaviour; keeping
// the network out of them is what makes them drivable from a test with fakes.
//
// Cards are read from the board's notes-only deck (story 34, notes-only portion); the
// notes+documents two-deck story arrives with the documents/scope slices. Grading posts
// the SM-2 quality grade back and the SERVER applies review() (scheduling never runs
// client-side). A not-yet-served cards endpoint is a FORESEEN case — the route degrades
// to an empty deck rather than crashing (the cards HTTP endpoint lands with the wiring
// slice; this route is forward-compatible with it).

export default function StudyRoute() {
  const { id: boardId } = useParams();
  const navigate = useNavigate();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getBoardCards(boardId, { deck: "notes" })
      .then((res) => {
        if (!alive) return;
        setCards(res.cards);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [boardId]);

  // Grade → post to the server, which applies SM-2 review() and returns the new
  // schedule. We fold the returned reviewState back into the local deck so a re-study
  // reflects it, but scheduling itself is entirely server-side.
  const handleGrade = useCallback(
    (card, grade) => {
      if (!card || !card.id) return;
      gradeBoardCard(boardId, card.id, grade, { deck: card.deck || "notes" }).then(
        (res) => {
          if (res && res.reviewState) {
            setCards((cs) =>
              cs.map((c) =>
                c.id === card.id ? { ...c, reviewState: res.reviewState } : c
              )
            );
          }
        }
      );
    },
    [boardId]
  );

  // "Show on board" from a card leaves the full-screen route back to the editor,
  // carrying the source shapes so the editor can highlight them (click-to-highlight,
  // story 36). The editor reads ?highlight=… on mount; absent that support the user
  // still lands back on the board.
  const handleRevealSource = useCallback(
    (sourceElementIds) => {
      const ids = Array.isArray(sourceElementIds) ? sourceElementIds : [];
      const q = ids.length ? `?highlight=${encodeURIComponent(ids.join(","))}` : "";
      navigate(`/whiteboard/${boardId}${q}`);
    },
    [boardId, navigate]
  );

  const handleExit = useCallback(() => {
    navigate(`/whiteboard/${boardId}`);
  }, [boardId, navigate]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[var(--surface-bg)] text-[var(--surface-muted)]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <p className="text-sm">Loading study session…</p>
      </div>
    );
  }

  return (
    <StudyView
      cards={cards}
      onGrade={handleGrade}
      onRevealSource={handleRevealSource}
      onExit={handleExit}
    />
  );
}
