import { exportToBlob } from "@excalidraw/excalidraw";
// CommonJS module: Rollup cannot statically resolve a NAMED import from
// `module.exports`, so take the default export and destructure at runtime.
import groupingModule from "../../../server/recognition/grouping.js";
import { cropDimensions, PADDING } from "./cropDimensions";

const { groupCrops } = groupingModule;

// Turning the board into the crops the transcription seam reads (D1/D5).
//
// Grouping itself is shared with the server rather than reimplemented here: the
// module is pure and dependency-free, so importing it means the client and the
// recognizer can never disagree about what a crop IS. Duplicating ~120 lines of
// structure-first grouping would drift the moment either side changed.
//
// What only the browser can do is RASTERIZE: Excalidraw renders here, so each ink
// crop's image is exported here and attached before upload. Typed-text crops are
// ground truth and never become images — they carry their text verbatim and skip
// the model entirely.

// Export one crop's elements to a normalized data URL. Ink is upscaled and forced
// onto a white background: the recognizer reads dark strokes on light ground, and
// a transparent PNG would arrive as black-on-black.
async function cropImage(elements, files) {
  const blob = await exportToBlob({
    elements,
    files,
    mimeType: "image/png",
    appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
    // Padding does double duty: it gives the strokes breathing room AND lifts a
    // thin crop's short edge over the model's minimum without distorting the ink.
    // Scaling a 1200x30 strip up to a 320px short edge would cost seventeen tiles;
    // padding it costs only whitespace inside the tile already being paid for.
    exportPadding: PADDING,
    getDimensions: cropDimensions,
  });

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Build the upload payload: every crop the board yields, with ink crops carrying
// their rendered image. Returns [] for an empty board so the caller can say
// "nothing to read" without a round trip.
export async function buildBoardCrops(elements, files = {}) {
  const crops = groupCrops(elements);
  if (crops.length === 0) return [];

  const byId = new Map(elements.map((el) => [el.id, el]));

  return Promise.all(
    crops.map(async (crop) => {
      if (crop.kind === "text") {
        // Ground truth — send the text, never an image.
        return {
          cropId: crop.cropId,
          kind: "text",
          text: crop.text,
          sourceElementIds: crop.sourceElementIds,
          bbox: crop.bbox,
        };
      }

      const members = crop.sourceElementIds.map((id) => byId.get(id)).filter(Boolean);
      return {
        cropId: crop.cropId,
        kind: "ink",
        image: await cropImage(members, files),
        sourceElementIds: crop.sourceElementIds,
        bbox: crop.bbox,
      };
    })
  );
}

export { groupCrops };
