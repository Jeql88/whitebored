// Behaviour tests for the Documents panel (slice #11, D13), driven through the
// rendered UI with Testing Library. The document list, the open document (with its
// normalized pages), and callbacks are injected as props (the seam) — no live
// fetch, no socket. We assert only observable behaviour: attaching, listing,
// inline rendering, and jump-to-page (incl. citation-driven deep-linking).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentsPanel from "./DocumentsPanel";

function summary(docId, kind = "pdf", filename = `${docId}.pdf`) {
  return { docId, kind, filename, pageCount: 3 };
}

function fullDoc(docId, kind = "text", pages = 3) {
  return {
    docId,
    boardId: "b1",
    kind,
    filename: `${docId}.${kind === "pdf" ? "pdf" : "txt"}`,
    contentType: kind === "pdf" ? "application/pdf" : "text/plain",
    pages: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      text: `page ${i + 1} body`,
    })),
  };
}

describe("DocumentsPanel", () => {
  it("works fully with nothing uploaded — an empty state (story 25)", () => {
    render(<DocumentsPanel documents={[]} />);
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
    // The attach control is present so the user can add one.
    expect(screen.getByLabelText(/attach a document/i)).toBeInTheDocument();
  });

  it("attaches a picked file via onUpload (story 22)", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    render(<DocumentsPanel documents={[]} onUpload={onUpload} />);

    const file = new File(["%PDF-1.7"], "slides.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText(/attach a document/i), file);

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onUpload.mock.calls[0][0].name).toBe("slides.pdf");
  });

  it("lists the board's documents and opens one on click (story 23)", async () => {
    const user = userEvent.setup();
    const onSelectDocument = vi.fn();
    render(
      <DocumentsPanel
        documents={[summary("d1"), summary("d2", "text", "d2.txt")]}
        onSelectDocument={onSelectDocument}
      />
    );

    expect(screen.getByText("d1.pdf")).toBeInTheDocument();
    expect(screen.getByText("d2.txt")).toBeInTheDocument();

    await user.click(screen.getByText("d2.txt"));
    expect(onSelectDocument).toHaveBeenCalledWith("d2");
  });

  it("renders the open text document inline, showing the active page's text (story 23)", () => {
    render(
      <DocumentsPanel
        documents={[summary("d1", "text", "d1.txt")]}
        activeDoc={fullDoc("d1", "text", 3)}
        activePage={2}
      />
    );
    const viewer = screen.getByTestId("document-page");
    expect(viewer).toHaveAttribute("data-page", "2");
    expect(viewer).toHaveTextContent("page 2 body");
  });

  it("jump-to-page: next/prev and the page input drive onJumpToPage (story 24)", async () => {
    const user = userEvent.setup();
    const onJumpToPage = vi.fn();
    render(
      <DocumentsPanel
        documents={[summary("d1", "text", "d1.txt")]}
        activeDoc={fullDoc("d1", "text", 5)}
        activePage={2}
        onJumpToPage={onJumpToPage}
      />
    );

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(onJumpToPage).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: /previous page/i }));
    expect(onJumpToPage).toHaveBeenCalledWith(1);

    // Direct page entry (a citation deep-link surface). The input is controlled by
    // activePage, so a single change event carries the requested page number.
    fireEvent.change(screen.getByLabelText("Page"), { target: { value: "4" } });
    expect(onJumpToPage).toHaveBeenLastCalledWith(4);
  });

  it("citation deep-link: activePage is controlled, so a jump lands on that page", () => {
    // The caller sets activePage (e.g. from a { docId, page } citation); the viewer
    // reflects it without any user interaction.
    const { rerender } = render(
      <DocumentsPanel
        documents={[summary("d1", "text", "d1.txt")]}
        activeDoc={fullDoc("d1", "text", 5)}
        activePage={1}
      />
    );
    expect(screen.getByTestId("document-page")).toHaveAttribute("data-page", "1");

    rerender(
      <DocumentsPanel
        documents={[summary("d1", "text", "d1.txt")]}
        activeDoc={fullDoc("d1", "text", 5)}
        activePage={4}
      />
    );
    const viewer = screen.getByTestId("document-page");
    expect(viewer).toHaveAttribute("data-page", "4");
    expect(viewer).toHaveTextContent("page 4 body");
  });

  it("clamps an out-of-range activePage to the document's real range", () => {
    render(
      <DocumentsPanel
        documents={[summary("d1", "text", "d1.txt")]}
        activeDoc={fullDoc("d1", "text", 3)}
        activePage={99}
      />
    );
    // Past the end lands on the last page rather than blanking the viewer.
    expect(screen.getByTestId("document-page")).toHaveAttribute("data-page", "3");
  });

  it("renders a PDF inline via the raw URL, deep-linked to the page (#page=N)", () => {
    render(
      <DocumentsPanel
        documents={[summary("d1", "pdf")]}
        activeDoc={fullDoc("d1", "pdf", 3)}
        activePage={2}
        rawUrl={(doc) => `/api/whiteboards/b1/documents/${doc.docId}/raw`}
      />
    );
    const viewer = screen.getByTestId("document-page");
    expect(viewer.tagName.toLowerCase()).toBe("iframe");
    expect(viewer.getAttribute("src")).toBe(
      "/api/whiteboards/b1/documents/d1/raw#page=2"
    );
  });

  it("can remove a document when onDelete is provided", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <DocumentsPanel documents={[summary("d1", "text", "d1.txt")]} onDelete={onDelete} />
    );
    await user.click(screen.getByRole("button", { name: /remove d1\.txt/i }));
    expect(onDelete).toHaveBeenCalledWith("d1");
  });

  it("shows a working state while uploading", () => {
    render(<DocumentsPanel documents={[]} uploading />);
    expect(screen.getByRole("status")).toHaveTextContent(/uploading/i);
  });
});
