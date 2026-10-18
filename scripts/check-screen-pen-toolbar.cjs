const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "tmp", "screen-pen-toolbar");
const playwrightPath = process.env.PLAYWRIGHT_MODULE || "playwright";
const playwright = require(playwrightPath);
const palettes = ["#111111", "#ffffff", "#e53935", "#1e88e5", "#43a047", "#fb8c00"]
  .map((color, index) => ({ color, width: [2, 3, 4, 5, 6, 7][index], type: "basic" }));
const cases = [
  { placement: "left", width: 1920, height: 1080, dpr: 1, name: "left-1920x1080-dpr1" },
  { placement: "right", width: 1920, height: 1080, dpr: 1, name: "right-1920x1080-dpr1" },
  { placement: "left", width: 1920, height: 1048, dpr: 1, name: "left-1920x1048-dpr1" },
  { placement: "right", width: 1920, height: 1048, dpr: 1, name: "right-1920x1048-dpr1" },
  { placement: "left", width: 1536, height: 864, dpr: 1.25, name: "left-1536x864-dpr1_25" },
  { placement: "right", width: 1536, height: 864, dpr: 1.25, name: "right-1536x864-dpr1_25" },
  { placement: "left", width: 1280, height: 720, dpr: 1.5, name: "left-1280x720-dpr1_5" },
  { placement: "right", width: 1280, height: 720, dpr: 1.5, name: "right-1280x720-dpr1_5" }
];

function startServer() {
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    let file;
    try { file = path.resolve(root, `.${decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname)}`); }
    catch { res.writeHead(400).end("Bad request"); return; }
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end("Forbidden"); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end("Not found"); return; }
    res.writeHead(200, { "content-type": `${mime[path.extname(file)] || "application/octet-stream"}; charset=utf-8`, "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const server = await startServer();
  const address = server.address();
  let browser;
  const failures = [];
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    for (const testCase of cases) {
      const context = await browser.newContext({ viewport: { width: testCase.width, height: testCase.height }, deviceScaleFactor: testCase.dpr });
      await context.addInitScript(({ presets }) => {
        localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets));
        localStorage.setItem("board.setup-wizard.completed.v1", "true");
      }, { presets: palettes });
      const page = await context.newPage();
      page.on("pageerror", (error) => failures.push(`${testCase.name}: page error: ${error.message}`));
      await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
      await page.evaluate((placement) => {
        if (typeof setToolbarPlacement === "function") setToolbarPlacement(placement, false);
        else throw new Error("setToolbarPlacement unavailable");
      }, testCase.placement);
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => {
        const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const toolbar = document.querySelector(".toolbar");
        const app = document.querySelector(".app");
        const presets = [...document.querySelectorAll("#penPresets .pen-preset")];
        const controls = [...toolbar.querySelectorAll("button, input, select, .preset-group, .current-pen-editor, .presentation-page-nav, #documentEditor")]
          .filter((el) => !el.hidden && getComputedStyle(el).display !== "none");
        const layoutItems = [...toolbar.children].filter((el) => !el.hidden && getComputedStyle(el).display !== "none");
        const overlaps = [];
        for (let i = 0; i < layoutItems.length; i += 1) for (let j = i + 1; j < layoutItems.length; j += 1) {
          const a = layoutItems[i].getBoundingClientRect();
          const b = layoutItems[j].getBoundingClientRect();
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push(`${layoutItems[i].id || layoutItems[i].className} / ${layoutItems[j].id || layoutItems[j].className}`);
        }
        const bounds = rect(toolbar);
        return {
          viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, clientHeight: document.documentElement.clientHeight },
          bodyScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
          appClass: app.className,
          toolbar: bounds,
          paletteCount: presets.length,
          palettes: presets.map((el) => ({ rect: rect(el), overflow: el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth })),
          paletteGaps: presets.slice(1).map((el, index) => Math.round((el.getBoundingClientRect().top - presets[index].getBoundingClientRect().bottom) * 10) / 10),
          controls: controls.map((el) => ({ id: el.id || el.className, rect: rect(el) })),
          overlaps,
          outsideControls: controls.filter((el) => { const r = el.getBoundingClientRect(); return r.left < bounds.left - 0.5 || r.top < bounds.top - 0.5 || r.right > bounds.right + 0.5 || r.bottom > bounds.bottom + 0.5; }).map((el) => el.id || el.className),
          hiddenRequired: ["fitPageButton", "navModeLockButton", "appInfoButton", "fullscreenToggle"].filter((id) => { const el = document.getElementById(id); return !el || el.getClientRects().length === 0; })
        };
      });
      const screenshot = path.join(outputDir, `${testCase.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      if (testCase.width === 1920 && testCase.height === 1080 && testCase.dpr === 1) {
        await page.locator(".toolbar").screenshot({ path: path.join(outputDir, `${testCase.name}-toolbar.png`) });
      }
      const errors = [];
      if (metrics.paletteCount !== 6) errors.push(`expected six palettes, got ${metrics.paletteCount}`);
      if (metrics.bodyScroll.width > metrics.viewport.width || metrics.bodyScroll.height > metrics.viewport.clientHeight) errors.push("document scrolls beyond viewport/client height");
      if (metrics.outsideControls.length) errors.push(`controls outside toolbar: ${metrics.outsideControls.join(", ")}`);
      if (metrics.overlaps.length) errors.push(`toolbar items overlap: ${metrics.overlaps.join(", ")}`);
      if (metrics.hiddenRequired.length) errors.push(`required controls not visible: ${metrics.hiddenRequired.join(", ")}`);
      if (metrics.palettes.some((p) => p.overflow)) errors.push("palette content clips or scrolls");
      if (metrics.palettes.some((p) => Math.abs(p.rect.height - 28) > 0.5)) errors.push("palette height is not 28px");
      if (testCase.width >= 1536 && metrics.paletteGaps.some((gap) => Math.abs(gap - 4) > 0.5)) errors.push("palette gap is not 4px");
      const result = { ...testCase, screenshot, metrics, errors };
      fs.writeFileSync(path.join(outputDir, `${testCase.name}.json`), JSON.stringify(result, null, 2));
      console.log(`${errors.length ? "FAIL" : "PASS"} ${testCase.name} ${errors.join("; ")}`);
      if (errors.length) failures.push(`${testCase.name}: ${errors.join("; ")}`);
      await context.close();
    }
    const transitions = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    await transitions.addInitScript(({ presets }) => {
      localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets));
      localStorage.setItem("board.setup-wizard.completed.v1", "true");
    }, { presets: palettes });
    const transitionPage = await transitions.newPage();
    await transitionPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    const transitionErrors = [];
    for (const [width, height, placement] of [[1920, 1080, "left"], [1920, 1080, "top"], [1920, 1080, "right"], [1920, 1080, "bottom"], [1920, 1080, "floating"], [1920, 1048, "left"]]) {
      await transitionPage.setViewportSize({ width, height });
      await transitionPage.evaluate((value) => setToolbarPlacement(value, false), placement);
      await transitionPage.waitForTimeout(100);
      const value = await transitionPage.evaluate(() => {
        const presets = [...document.querySelectorAll("#penPresets .pen-preset")];
        const toolbar = document.querySelector(".toolbar").getBoundingClientRect();
        return { placement: document.querySelector(".app").className, count: presets.length, heights: presets.map((el) => el.getBoundingClientRect().height), gaps: presets.slice(1).map((el, i) => Math.round((el.getBoundingClientRect().top - presets[i].getBoundingClientRect().bottom) * 10) / 10), scrollHeight: document.documentElement.scrollHeight, viewportHeight: document.documentElement.clientHeight, toolbarHeight: toolbar.height };
      });
      if (value.count !== 6 || value.scrollHeight > value.viewportHeight || value.toolbarHeight <= 0 || (["left", "right"].includes(placement) && (value.heights.some((height) => Math.abs(height - 28) > 0.5) || value.gaps.some((gap) => Math.abs(gap - 4) > 0.5)))) transitionErrors.push(`${placement} ${width}x${height}: ${JSON.stringify(value)}`);
    }
    await transitions.close();
    fs.writeFileSync(path.join(outputDir, "placement-transitions.json"), JSON.stringify({ transitionErrors }, null, 2));
    console.log(`${transitionErrors.length ? "FAIL" : "PASS"} placement-transitions ${transitionErrors.length ? transitionErrors.join("; ") : ""}`);
    failures.push(...transitionErrors.map((error) => `placement-transitions: ${error}`));

    const many = Array.from({ length: 20 }, (_, index) => ({ color: `#${(0x112233 + index * 0x090d11).toString(16).slice(-6)}`, width: index === 19 ? 11 : 2 + index % 6, type: "basic" }));
    const manyContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await manyContext.addInitScript(({ presets }) => { localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets)); localStorage.setItem("board.setup-wizard.completed.v1", "true"); }, { presets: many });
    const manyPage = await manyContext.newPage(); await manyPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    const manyErrors = [];
    for (const placement of ["top", "left", "right", "floating"]) {
      await manyPage.evaluate((value) => setToolbarPlacement(value, false), placement); await manyPage.waitForTimeout(100);
      const beforeMenu = await manyPage.evaluate(() => ({ visible: [...document.querySelectorAll("#penPresets .pen-preset")].filter((el) => !el.hidden && el.getClientRects().length).length, more: document.querySelector(".pen-preset-more")?.getClientRects().length > 0, scroll: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
      await manyPage.locator(".pen-preset-more").click();
      const menu = await manyPage.evaluate(() => { const popup = document.querySelector(".pen-preset-overflow-popover"); const rects = [...(popup?.querySelectorAll(".pen-preset") || [])].map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, visible: !el.hidden && r.width > 0 && r.height > 0 }; }); return { count: rects.length, allVisible: rects.every((r) => r.visible && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight) }; });
      if (beforeMenu.visible !== 6 || !beforeMenu.more || beforeMenu.scroll || menu.count !== 14 || !menu.allVisible) manyErrors.push(`${placement}: ${JSON.stringify({ beforeMenu, menu })}`);
      if (placement === "right") {
        await manyPage.locator('.pen-preset-overflow-popover [aria-label="pen preset 20"]').click();
        const applied = await manyPage.evaluate(() => ({ width: Number(lineWidthInput.value), locked: navModeLocked }));
        if (applied.width !== 11) manyErrors.push(`right overflow last preset not applied: ${JSON.stringify(applied)}`);
      } else await manyPage.keyboard.press("Escape");
    }
    await manyPage.evaluate(() => setNavigationModeLock(true));
    await manyPage.locator(".pen-preset-more").click();
    await manyPage.locator('.pen-preset-overflow-popover [aria-label="pen preset 20"]').click();
    const lockedAfterExtra = await manyPage.evaluate(() => ({ locked: navModeLocked, pan: panMode, tool, width: Number(lineWidthInput.value) }));
    if (!lockedAfterExtra.locked || !lockedAfterExtra.pan || lockedAfterExtra.tool !== "pen" || lockedAfterExtra.width !== 11) manyErrors.push(`overflow click cleared lock: ${JSON.stringify(lockedAfterExtra)}`);
    await manyContext.close();
    const compactContext = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 1 });
    await compactContext.addInitScript(({ presets }) => { localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets)); localStorage.setItem("board.setup-wizard.completed.v1", "true"); }, { presets: many });
    const compactPage = await compactContext.newPage(); await compactPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    for (const placement of ["left", "floating"]) {
      await compactPage.evaluate((value) => setToolbarPlacement(value, false), placement); await compactPage.waitForTimeout(100);
      const result = await compactPage.evaluate(() => {
        const required = ["fitPageButton", "navModeLockButton", "penTool", "eraserTool", "clearButton", "undoButton", "redoButton", "appInfoButton", "fullscreenToggle"];
        return { controls: Object.fromEntries(required.map((id) => [id, Boolean(document.getElementById(id)?.getClientRects().length)])), more: Boolean(document.querySelector(".pen-preset-more")?.getClientRects().length), scroll: document.documentElement.scrollHeight > document.documentElement.clientHeight };
      });
      if (Object.values(result.controls).some((visible) => !visible) || !result.more || result.scroll) manyErrors.push(`1280x600 ${placement}: ${JSON.stringify(result)}`);
    }
    await compactContext.close();
    fs.writeFileSync(path.join(outputDir, "20-palette-results.json"), JSON.stringify({ manyErrors }, null, 2));
    console.log(`${manyErrors.length ? "FAIL" : "PASS"} 20-palette-overflow ${manyErrors.length ? manyErrors.join("; ") : "top/left/right/floating and 1280x600 side/floating"}`);
    failures.push(...manyErrors.map((error) => `20-palette: ${error}`));

    const interactionContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    await interactionContext.addInitScript(({ presets }) => {
      localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets));
      localStorage.setItem("board.setup-wizard.completed.v1", "true");
      localStorage.setItem("board.settings.interactionMode.v1", "single");
    }, { presets: palettes });
    const interactionPage = await interactionContext.newPage();
    const interactionErrors = [];
    const log = async (label, task) => { try { const result = await task(); console.log(`${interactionErrors.includes(label) ? "FAIL" : "PASS"} interaction ${label}${result ? ` ${JSON.stringify(result)}` : ""}`); } catch (error) { interactionErrors.push(`${label}: ${error.message}`); console.log(`FAIL interaction ${label}: ${error.message}`); } };
    await interactionPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    await log("lexical-state", async () => interactionPage.evaluate(() => ({ navModeLocked, panMode, tool, scale: boardCamera.scale, hasBoardState: !!BoardState })));
    await log("lock-ui", async () => {
      await interactionPage.locator("#navModeLockButton").click();
      const state = await interactionPage.evaluate(() => ({ locked: navModeLocked, pan: panMode, aria: navModeLockButton.getAttribute("aria-pressed"), penDisabled: penToolButton.disabled, eraserDisabled: eraserToolButton.disabled, tool }));
      if (!state.locked || !state.pan || state.aria !== "true" || !state.penDisabled || !state.eraserDisabled || state.tool !== "pen") throw new Error(JSON.stringify(state));
      return state;
    });
    await log("locked-pan-no-ink", async () => {
      const before = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length }));
      const rect = await interactionPage.locator("#board").boundingBox();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      await interactionPage.mouse.move(x, y);
      await interactionPage.mouse.down();
      await interactionPage.mouse.move(x + 110, y + 60, { steps: 3 });
      const during = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, trusted: window.__toolbarTrustedPointer }));
      await interactionPage.mouse.up();
      const after = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked, active: activePanPointerId, pointer: currentInputPointerId }));
      if (Math.hypot(during.camera.x - before.camera.x, during.camera.y - before.camera.y) < 10 || during.strokes !== before.strokes || after.strokes !== before.strokes || !after.locked || after.active !== null || after.pointer !== null) throw new Error(JSON.stringify({ before, during, after }));
      return { before, during, after };
    });
    await log("cancel-and-blur-release", async () => {
      const rect = await interactionPage.locator("#board").boundingBox();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      await interactionPage.mouse.move(x, y); await interactionPage.mouse.down();
      await interactionPage.evaluate(() => { const id = activePanPointerId; canvas.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: id, pointerType: "mouse", isPrimary: true })); });
      const cancel = await interactionPage.evaluate(() => ({ active: activePanPointerId, input: currentInputPointerId, locked: navModeLocked, capture: canvas.hasPointerCapture(1) }));
      await interactionPage.mouse.up();
      await interactionPage.mouse.down();
      await interactionPage.evaluate(() => window.dispatchEvent(new Event("blur")));
      const blur = await interactionPage.evaluate(() => ({ active: activePanPointerId, input: currentInputPointerId, locked: navModeLocked }));
      await interactionPage.mouse.up();
      if (cancel.active !== null || cancel.input !== null || !cancel.locked || blur.active !== null || blur.input !== null || !blur.locked) throw new Error(JSON.stringify({ cancel, blur }));
      return { cancel, blur };
    });
    await log("lostpointercapture-recovery", async () => {
      await interactionPage.evaluate(() => {
        window.__lostCaptureSeen = []; window.__gotCaptureSeen = [];
        canvas.addEventListener("gotpointercapture", (event) => window.__gotCaptureSeen.push({ id: event.pointerId, trusted: event.isTrusted }));
        window.addEventListener("lostpointercapture", (event) => window.__lostCaptureSeen.push({ id: event.pointerId, trusted: event.isTrusted }));
      });
      const rect = await interactionPage.locator("#board").boundingBox();
      const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      await interactionPage.mouse.move(x, y); await interactionPage.mouse.down();
      await interactionPage.mouse.move(x + 1, y + 1);
      const gotCaptureEvents = await interactionPage.evaluate(() => window.__gotCaptureSeen);
      const hasCaptureBeforeRelease = await interactionPage.evaluate(() => canvas.hasPointerCapture(activePanPointerId));
      await interactionPage.evaluate(() => { if (canvas.hasPointerCapture(activePanPointerId)) canvas.releasePointerCapture(activePanPointerId); });
      await interactionPage.mouse.move(2, 2);
      const nativeLostEvents = await interactionPage.evaluate(() => window.__lostCaptureSeen.length);
      await interactionPage.waitForTimeout(30);
      const lost = await interactionPage.evaluate(({ gotCaptureEvents, hasCaptureBeforeRelease, nativeLostEvents }) => ({ gotCaptureEvents, hasCaptureBeforeRelease, nativeLostEvents, active: activePanPointerId, input: currentInputPointerId, locked: navModeLocked, captures: canvas.hasPointerCapture(1), events: window.__lostCaptureSeen }), { gotCaptureEvents, hasCaptureBeforeRelease, nativeLostEvents });
      await interactionPage.mouse.up();
      const beforeNext = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length }));
      await interactionPage.mouse.move(x, y);
      await interactionPage.mouse.down();
      await interactionPage.mouse.move(x + 50, y + 20, { steps: 2 });
      await interactionPage.mouse.up();
      const next = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, active: activePanPointerId, input: currentInputPointerId, locked: navModeLocked, tool, strokes: strokes.length }));
      if (!gotCaptureEvents.some((event) => event.trusted && event.id === 1) || !hasCaptureBeforeRelease || nativeLostEvents === 0 || lost.active !== null || lost.input !== null || !lost.locked || next.active !== null || next.input !== null || !next.locked || next.tool !== "pen" || next.strokes !== beforeNext.strokes || Math.hypot(next.camera.x - beforeNext.camera.x, next.camera.y - beforeNext.camera.y) < 10) throw new Error(JSON.stringify({ lost, beforeNext, next }));
      return { lost, beforeNext, next };
    });
    await log("fit-page-remains-locked", async () => { await interactionPage.locator("#fitPageButton").click(); const state = await interactionPage.evaluate(() => ({ locked: navModeLocked, pan: panMode, aria: navModeLockButton.getAttribute("aria-pressed") })); if (!state.locked || !state.pan || state.aria !== "true") throw new Error(JSON.stringify(state)); return state; });
    await log("locked-multi-pan-remains-locked", async () => {
      await interactionPage.evaluate(() => setBoardInteractionMode("multi"));
      const before = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked }));
      const rect = await interactionPage.locator("#board").boundingBox(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      await interactionPage.mouse.move(x, y); await interactionPage.mouse.down(); await interactionPage.mouse.move(x + 40, y + 15, { steps: 2 }); await interactionPage.mouse.up();
      const after = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked, pan: panMode }));
      if (!before.locked || !after.locked || !after.pan || after.strokes !== before.strokes || Math.abs(after.camera.x - before.camera.x) < 10) throw new Error(JSON.stringify({ before, after }));
      return { before, after };
    });
    await log("locked-hold-zoom-existing-timing", async () => {
      const timing = await interactionPage.evaluate(() => devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs);
      const rect = await interactionPage.locator("#board").boundingBox(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const before = await interactionPage.evaluate(() => ({ ...boardCamera }));
      await interactionPage.mouse.move(x, y); await interactionPage.mouse.down(); await interactionPage.waitForTimeout(timing + 100); await interactionPage.mouse.move(x, y - 50, { steps: 2 }); await interactionPage.mouse.up();
      const after = await interactionPage.evaluate(() => ({ ...boardCamera }));
      const state = await interactionPage.evaluate(() => ({ locked: navModeLocked, pan: panMode, strokes: strokes.length }));
      if (Math.abs(after.scale - before.scale) < 0.05 || !state.locked || !state.pan || state.strokes !== 0) throw new Error(JSON.stringify({ timing, before, after, state }));
      return { timing, before, after, state };
    });
    await log("locked-preset-and-remote-nav", async () => {
      await interactionPage.locator("#penPresets .pen-preset").first().click();
      await interactionPage.evaluate(() => { BoardRemote.setMappings([{ actionId: "nextPage", code: "KeyN" }]); BoardRemote.handleKeyEvent(new KeyboardEvent("keydown", { code: "KeyN", key: "n", bubbles: true })); addBoardBlankPage(); });
      const state = await interactionPage.evaluate(() => ({ locked: navModeLocked, pan: panMode, tool, pages: boardPageSequence.length }));
      if (!state.locked || !state.pan || state.tool !== "pen" || state.pages < 2) throw new Error(JSON.stringify(state));
      return state;
    });
    await log("locked-pen-pointer", async () => {
      const cdp = await interactionContext.newCDPSession(interactionPage);
      const rect = await interactionPage.locator("#board").boundingBox(); const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
      const before = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length }));
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, pointerType: "pen" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, pointerType: "pen" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x + 50, y: y + 20, button: "left", buttons: 1, pointerType: "pen" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x + 50, y: y + 20, button: "left", buttons: 0, pointerType: "pen" });
      const after = await interactionPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked, pan: panMode }));
      if (!after.locked || !after.pan || after.strokes !== before.strokes || Math.abs(after.camera.x - before.camera.x) < 10) throw new Error(JSON.stringify({ before, after }));
      return { before, after };
    });
    await log("unlock-restores-pen", async () => {
      await interactionPage.locator("#navModeLockButton").click();
      await interactionPage.locator("#eraserTool").click();
      const erasing = await interactionPage.evaluate(() => tool);
      await interactionPage.locator("#navModeLockButton").click();
      await interactionPage.locator("#navModeLockButton").click();
      const state = await interactionPage.evaluate(() => ({ tool, pan: panMode, locked: navModeLocked, penDisabled: penToolButton.disabled }));
      if (erasing === "pen" || state.tool !== "pen" || state.pan || state.locked || state.penDisabled) throw new Error(JSON.stringify({ erasing, state }));
      return { erasing, state };
    });
    await interactionContext.close();
    fs.writeFileSync(path.join(outputDir, "interaction-results.json"), JSON.stringify({ interactionErrors }, null, 2));
    failures.push(...interactionErrors.map((error) => `interaction: ${error}`));

    const strokeErrors = [];
    for (const dpr of [1, 2]) {
      const strokeContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr });
      await strokeContext.addInitScript(({ presets }) => {
        localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets));
        localStorage.setItem("board.setup-wizard.completed.v1", "true");
        localStorage.setItem("board.settings.interactionMode.v1", "single");
      }, { presets: palettes });
      const strokePage = await strokeContext.newPage();
      await strokePage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
      await strokePage.evaluate(() => { window.__trustedPointerTypes = []; canvas.addEventListener("pointerdown", (event) => window.__trustedPointerTypes.push({ trusted: event.isTrusted, type: event.pointerType })); });
      const rect = await strokePage.locator("#board").boundingBox();
      const x0 = rect.x + rect.width / 2 - 120, y0 = rect.y + rect.height / 2;
      let preserved = null;
      for (const scale of [0.5, 1, 2, 6]) for (const width of [1, 4]) {
        const opacity = scale === 0.5 && width === 1 ? 0.5 : 1;
        await strokePage.evaluate(({ scale, width, opacity }) => {
          boardCamera = { x: 0, y: 0, scale }; panMode = false; navModeLocked = false; tool = "pen";
          lineWidthInput.value = String(width); penOpacity = opacity; applyBoardCamera();
        }, { scale, width, opacity });
        const beforeCount = await strokePage.evaluate(() => strokes.length);
        await strokePage.mouse.move(x0, y0); await strokePage.mouse.down();
        const activeWidth = await strokePage.evaluate(() => activeStroke?.widthPx ?? null);
        await strokePage.mouse.move(x0 + 90, y0 + 5, { steps: 3 }); await strokePage.mouse.up();
        const committed = await strokePage.evaluate(() => {
          const stroke = strokes.at(-1);
          return stroke ? { widthPx: stroke.widthPx, opacity: stroke.opacity, kind: stroke.kind, points: stroke.points.length } : null;
        });
        const expected = width * dpr / scale;
        if (committed?.kind !== "pen" || committed.points < 2 || Math.abs(activeWidth - expected) > 0.01 || Math.abs(committed.widthPx - expected) > 0.01 || Math.abs(committed.widthPx * scale / dpr - width) > 0.01 || Math.abs(committed.opacity - opacity) > 0.01 || beforeCount + 1 !== await strokePage.evaluate(() => strokes.length)) {
          strokeErrors.push(`dpr${dpr}/scale${scale}/width${width}: active=${activeWidth}, committed=${JSON.stringify(committed)}, expected=${expected}`);
        }
        if (preserved && Math.abs(await strokePage.evaluate((index) => strokes[index].widthPx, preserved.index) - preserved.widthPx) > 0.01) strokeErrors.push(`committed stroke width changed at later zoom dpr${dpr}`);
        if (!preserved) preserved = { index: beforeCount, widthPx: committed?.widthPx };
      }
      await strokePage.evaluate(() => { boardCamera = { x: 0, y: 0, scale: 1 }; applyBoardCamera(); });
      const countBeforeDot = await strokePage.evaluate(() => strokes.length);
      await strokePage.mouse.move(x0, y0); await strokePage.mouse.down(); await strokePage.mouse.up();
      const dot = await strokePage.evaluate(() => strokes.at(-1)?.points.length === 1);
      const trusted = await strokePage.evaluate(() => window.__trustedPointerTypes.every((event) => event.trusted && event.type === "mouse") && window.__trustedPointerTypes.length === 9);
      if (!dot) strokeErrors.push(`single pointer tap did not commit dot at dpr${dpr}`);
      if (!trusted) strokeErrors.push(`trusted mouse pointer events missing at dpr${dpr}`);
      const beforeErase = await strokePage.locator("#board").evaluate((canvas) => canvas.toDataURL());
      await strokePage.locator("#eraserTool").click();
      await strokePage.mouse.move(x0 + 30, y0); await strokePage.mouse.down(); await strokePage.mouse.move(x0 + 70, y0, { steps: 2 }); await strokePage.mouse.up();
      const afterErase = await strokePage.locator("#board").evaluate((canvas) => canvas.toDataURL());
      const toolAfterErase = await strokePage.evaluate(() => tool);
      if (beforeErase === afterErase || toolAfterErase !== "eraser") strokeErrors.push(`pixel eraser did not change rendered ink at dpr${dpr}`);
      await strokeContext.close();
    }
    fs.writeFileSync(path.join(outputDir, "stroke-results.json"), JSON.stringify({ strokeErrors }, null, 2));
    console.log(`${strokeErrors.length ? "FAIL" : "PASS"} stroke-zoom-dpr ${strokeErrors.length ? strokeErrors.join("; ") : "0.5/1/2/6 x width 1/4 at DPR 1/2, opacity, dot, eraser"}`);
    failures.push(...strokeErrors.map((error) => `stroke: ${error}`));

    const touchErrors = [];
    const touchContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5, hasTouch: true });
    await touchContext.addInitScript(({ presets }) => {
      localStorage.setItem("board.pen.presets.v1", JSON.stringify(presets));
      localStorage.setItem("board.setup-wizard.completed.v1", "true");
      localStorage.setItem("board.settings.interactionMode.v1", "single");
    }, { presets: palettes });
    const touchPage = await touchContext.newPage();
    await touchPage.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "networkidle" });
    const cdp = await touchContext.newCDPSession(touchPage);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await touchPage.locator("#navModeLockButton").click();
    const touchRect = await touchPage.locator("#board").boundingBox();
    const tx = touchRect.x + touchRect.width / 2, ty = touchRect.y + touchRect.height / 2;
    const touchBefore = await touchPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tx, y: ty, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tx + 80, y: ty + 45, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const touchAfter = await touchPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked, active: activePanPointerId, input: currentInputPointerId }));
    if (Math.hypot(touchAfter.camera.x - touchBefore.camera.x, touchAfter.camera.y - touchBefore.camera.y) < 10 || touchAfter.strokes !== touchBefore.strokes || !touchAfter.locked || touchAfter.active !== null || touchAfter.input !== null) touchErrors.push(`locked single-touch pan: ${JSON.stringify({ touchBefore, touchAfter })}`);
    await touchPage.evaluate(() => setBoardInteractionMode("multi"));
    const lockedMultiBefore = await touchPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: tx, y: ty, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: tx + 60, y: ty + 20, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const lockedMultiAfter = await touchPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked, active: activePanPointerId, input: currentInputPointerId }));
    if (Math.hypot(lockedMultiAfter.camera.x - lockedMultiBefore.camera.x, lockedMultiAfter.camera.y - lockedMultiBefore.camera.y) < 10 || lockedMultiAfter.strokes !== lockedMultiBefore.strokes || !lockedMultiAfter.locked || lockedMultiAfter.active !== null || lockedMultiAfter.input !== null) touchErrors.push(`locked multi-touch pan: ${JSON.stringify({ lockedMultiBefore, lockedMultiAfter })}`);
    await touchPage.evaluate(() => setNavigationModeLock(false));
    const autoBefore = await touchPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length }));
    const ax = tx - 80, ay = ty;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ax, y: ay, id: 11 }] });
    await touchPage.waitForTimeout(50);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ax, y: ay, id: 11 }, { x: ax + 140, y: ay, id: 12 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: ax - 20, y: ay, id: 11 }, { x: ax + 160, y: ay, id: 12 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const autoAfter = await touchPage.evaluate(() => ({ camera: { ...boardCamera }, strokes: strokes.length, locked: navModeLocked, mode: boardInteractionMode }));
    if (Math.abs(autoAfter.camera.scale - autoBefore.camera.scale) < 0.05 || autoAfter.strokes !== autoBefore.strokes || autoAfter.locked || autoAfter.mode !== "multi") touchErrors.push(`unlocked automatic two-touch zoom: ${JSON.stringify({ autoBefore, autoAfter })}`);
    await touchContext.close();
    fs.writeFileSync(path.join(outputDir, "touch-results.json"), JSON.stringify({ touchErrors }, null, 2));
    console.log(`${touchErrors.length ? "FAIL" : "PASS"} native-touch ${touchErrors.length ? touchErrors.join("; ") : "locked single pan and unlocked multi-touch zoom"}`);
    failures.push(...touchErrors.map((error) => `touch: ${error}`));
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log(`Screenshots and metrics: ${outputDir}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
