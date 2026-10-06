const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadStrokes() {
  const context = {
    normalizeHexColor: value => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : "",
    penColorInput: { value: "#111111" }, lineWidthInput: { value: "5" }, eraserWidthInput: { value: "14" },
    penOpacity: 1, pixelRatio: 1, ctx: null, boardCamera: { x: 0, y: 0, scale: 1 }, canvas: {}, strokes: []
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/strokes-core.js"), "utf8"), context);
  return context;
}

test("stroke opacity defaults to opaque while preserving explicit zero", () => {
  const context = loadStrokes();
  const points = [{ x: 1, y: 2 }];
  assert.equal(context.normalizeStrokeCollection([{ color: "#112233", points }])[0].opacity, 1);
  assert.equal(context.normalizeStrokeCollection([{ color: "#112233", opacity: null, points }])[0].opacity, 1);
  assert.equal(context.normalizeStrokeCollection([{ color: "#112233", opacity: 0, points }])[0].opacity, 0);
});

test("pen and eraser stroke records carry independent opacity", () => {
  const context = loadStrokes();
  context.penOpacity = 0.35;
  assert.equal(context.createStrokeRecord("pen", { x: 1, y: 2 }).opacity, 0.35);
  assert.equal(context.createStrokeRecord("pixel-eraser", { x: 1, y: 2 }).opacity, 1);
});

test("drawStrokePath uses alpha for pen and destination-out for eraser", () => {
  const context = loadStrokes();
  const calls = [];
  const target = { set strokeStyle(value) { calls.push(["strokeStyle", value]); }, set fillStyle(value) { calls.push(["fillStyle", value]); }, set globalCompositeOperation(value) { calls.push(["composite", value]); }, set lineWidth(value) { calls.push(["width", value]); }, beginPath() {}, arc() {}, fill() {}, moveTo() {}, quadraticCurveTo() {}, stroke() {} };
  context.drawStrokePath({ kind: "pen", color: "#112233", opacity: 0.4, widthPx: 4, points: [{ x: 1, y: 2 }] }, target);
  assert.ok(calls.some(([name, value]) => name === "strokeStyle" && value.includes("0.4")));
  calls.length = 0;
  context.drawStrokePath({ kind: "pixel-eraser", color: "#112233", opacity: 0.1, widthPx: 4, points: [{ x: 1, y: 2 }] }, target);
  assert.ok(calls.some(([name, value]) => name === "composite" && value === "destination-out"));
  assert.ok(calls.some(([name, value]) => name === "strokeStyle" && value.includes("1")));
});
