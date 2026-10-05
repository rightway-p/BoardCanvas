const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const PDFLib = require("pdf-lib");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv9sAAAAASUVORK5CYII=", "base64");
const context2d = { save() {}, restore() {}, translate() {}, fillRect(x, y, width, height) { (this.fills ||= []).push({ color: this.fillStyle, x, y, width, height }); } };
const document = { createElement: () => ({
  width: 0, height: 0,
  getContext: () => context2d,
  toBlob: (callback) => callback({ arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) })
}) };
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/board-export.js"), "utf8"), { window, document, Uint8Array, ArrayBuffer, Array });
const { exportSequence, pageBounds, sequenceFor, pdfPageLayout, sourcePointToVisual, framePointToVisual } = window.BoardExport;

function renderStroke() {}

async function sourcePdf() {
  const source = await PDFLib.PDFDocument.create();
  source.addPage([612, 792]).drawRectangle({ x: 40, y: 40, width: 120, height: 60, color: PDFLib.rgb(1, 0, 0) });
  source.addPage([800, 400]).drawRectangle({ x: 20, y: 20, width: 140, height: 90, color: PDFLib.rgb(0, 0, 1) });
  source.addPage([300, 400]);
  return { bytes: await source.save(), source };
}

test("PDF pages keep source dimensions and blanks are optional in sequence", async () => {
  const { bytes, source } = await sourcePdf();
  const pages = [
    { kind: "pdf", pdfPage: 1, pdfWorldSize: { width: 700, height: 900 }, strokes: [] },
    { kind: "blank", worldSize: { width: 600, height: 900 }, background: "#ff0000", strokes: [] },
    { kind: "pdf", pdfPage: 2, pdfWorldSize: null, strokes: [] },
    { kind: "pdf", pdfPage: 3, pdfWorldSize: null, strokes: [] }
  ];

  const defaultBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, drawStrokePath: renderStroke });
  const defaultPdf = await PDFLib.PDFDocument.load(defaultBytes);
  assert.equal(defaultPdf.getPageCount(), 3);
  assert.deepEqual(JSON.parse(JSON.stringify(defaultPdf.getPages().map((page) => page.getSize()))), JSON.parse(JSON.stringify(source.getPages().map((page) => page.getSize()))));

  const withBlankBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, includeBlankPages: true, blankSize: { width: 600, height: 900 }, drawStrokePath: renderStroke });
  const withBlank = await PDFLib.PDFDocument.load(withBlankBytes);
  assert.equal(withBlank.getPageCount(), 4);
  const blankSize = withBlank.getPage(1).getSize();
  assert.ok(blankSize.height > blankSize.width);
});

test("without a source PDF, every blank page is retained", async () => {
  const bytes = await exportSequence({
    PDFLib,
    pages: [{ kind: "blank", worldSize: { width: 800, height: 1100 }, background: "#ffffff", strokes: [] }, { kind: "blank", worldSize: { width: 800, height: 1100 }, background: "#000000", strokes: [] }],
    includeBlankPages: false,
    drawStrokePath: renderStroke
  });
  const pdf = await PDFLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 2);
});

test("blank pages preserve outside ink while PDF pages keep the default crop", async () => {
  context2d.fills = [];
  const { bytes } = await sourcePdf();
  const pages = [
    { kind: "pdf", pdfPage: 1, pdfWorldSize: { width: 700, height: 900 }, strokes: [] },
    { kind: "blank", worldSize: { width: 800, height: 1100 }, background: "#ffffff", strokes: [{ widthPx: 10, points: [{ x: -100, y: -100 }] }] }
  ];
  const exportedBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, includeBlankPages: true, drawStrokePath: renderStroke });
  const exported = await PDFLib.PDFDocument.load(exportedBytes);
  assert.deepEqual(exported.getPage(0).getSize(), { width: 612, height: 792 });
  const blankSize = exported.getPage(1).getSize();
  assert.ok(blankSize.width > 612);
  assert.ok(blankSize.height > 792);
  assert.ok(context2d.fills.some(({ color, x, y, width, height }) => color === "#ffffff" && x < 0 && y < 0 && width > 800 && height > 1100));
});

test("outside-ink bounds include stroke radii while the default crop stays at the page frame", () => {
  const frame = { width: 100, height: 80 };
  const strokes = [{ widthPx: 8, points: [{ x: -5, y: 20 }, { x: 95, y: 86 }] }];
  assert.deepEqual(JSON.parse(JSON.stringify(pageBounds(frame, strokes, false))), { minX: 0, minY: 0, maxX: 100, maxY: 80 });
  assert.deepEqual(JSON.parse(JSON.stringify(pageBounds(frame, strokes, true))), { minX: -9, minY: 0, maxX: 100, maxY: 90 });
  assert.equal(sequenceFor([{ kind: "pdf" }, { kind: "blank" }], true, false).length, 1);
  assert.equal(sequenceFor([{ kind: "pdf" }, { kind: "blank" }], false, false).length, 2);
});

test("PDF output expands only when outside ink is requested", async () => {
  const { bytes } = await sourcePdf();
  const pages = [{ kind: "pdf", pdfPage: 1, pdfWorldSize: { width: 700, height: 900 },
    strokes: [{ kind: "pen", color: "#111111", widthPx: 10, points: [{ x: -30, y: -30 }] }] }];
  const croppedBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, drawStrokePath: renderStroke });
  const cropped = await PDFLib.PDFDocument.load(croppedBytes);
  assert.deepEqual(cropped.getPage(0).getSize(), { width: 612, height: 792 });

  const expandedBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, includeOutsideInk: true, drawStrokePath: renderStroke });
  const expanded = await PDFLib.PDFDocument.load(expandedBytes);
  assert.ok(expanded.getPage(0).getSize().width > 612);
  assert.ok(expanded.getPage(0).getSize().height > 792);
});

test("rotated and cropped PDF pages use their visual frame for source and ink", async () => {
  const source = await PDFLib.PDFDocument.create();
  const page = source.addPage([200, 100]);
  page.drawRectangle({ x: 20, y: 20, width: 100, height: 60, color: PDFLib.rgb(0.8, 0.2, 0.1) });
  page.setCropBox(20, 10, 160, 60);
  page.setRotation(PDFLib.degrees(90));
  const bytes = await source.save();
  const pages = [{ kind: "pdf", pdfPage: 1, pdfWorldSize: { width: 120, height: 320 },
    strokes: [{ kind: "pen", color: "#111111", widthPx: 8, points: [{ x: -20, y: -20 }] }] }];

  const insideBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, drawStrokePath: renderStroke });
  const inside = await PDFLib.PDFDocument.load(insideBytes);
  assert.deepEqual(inside.getPage(0).getSize(), { width: 60, height: 160 });
  const expandedBytes = await exportSequence({ PDFLib, pdfBytes: bytes, pages, includeOutsideInk: true, drawStrokePath: renderStroke });
  const expanded = await PDFLib.PDFDocument.load(expandedBytes);
  assert.ok(expanded.getPage(0).getSize().width > 60);
  assert.ok(expanded.getPage(0).getSize().height > 160);
});

test("source-to-visual point mapping matches PDF.js for every quarter turn", async () => {
  const source = await PDFLib.PDFDocument.create();
  for (const angle of [0, 90, 180, 270]) {
    const page = source.addPage([200, 100]);
    page.setCropBox(20, 10, 160, 60);
    page.setRotation(PDFLib.degrees(angle));
    const layout = pdfPageLayout(page);
    const point = sourcePointToVisual(30, 30, layout);
    const expected = {
      0: { width: 160, height: 60, x: 10, y: 40 },
      90: { width: 60, height: 160, x: 20, y: 10 },
      180: { width: 160, height: 60, x: 150, y: 20 },
      270: { width: 60, height: 160, x: 40, y: 150 }
    }[angle];
    assert.deepEqual(JSON.parse(JSON.stringify({ width: layout.width, height: layout.height, ...point })), expected);
    const frame = { width: layout.width * 2, height: layout.height * 2 + 40 };
    const rasterPoint = { x: point.x * 2, y: 20 + point.y * 2 };
    const mappedInk = framePointToVisual(rasterPoint.x, rasterPoint.y, frame, layout);
    assert.ok(Math.abs(mappedInk.x - point.x) < 0.0001);
    assert.ok(Math.abs(mappedInk.y - point.y) < 0.0001);
  }
});
