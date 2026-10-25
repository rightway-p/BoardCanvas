const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../dist');

(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (file !== root && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
    const target = file === root ? path.join(root, 'index.html') : file;
    if (!fs.existsSync(target)) return res.writeHead(404).end();
    const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
    res.setHeader('content-type', types[path.extname(target)] || 'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    for (const deviceScaleFactor of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, deviceScaleFactor });
      await context.addInitScript(() => localStorage.setItem('board.setup-wizard.completed.v1', 'true'));
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.evaluate(async () => {
        await window.boardRestorePromise;
        boardPageSequence = [BoardState.createBlankPage('feedback-a'), BoardState.createBlankPage('feedback-b')];
        boardPageIndex = 0; renderBoardPage(0); setBoardInteractionMode('multi');
      });
      const toast = page.locator('.board-action-feedback'), cursor = page.locator('.board-eraser-preview');
      const toastIs = async text => assert.equal(await toast.textContent(), text);
      for (const scale of [0.5, 1, 2]) {
        await page.evaluate(scale => {
          clearBoard(); tool = 'pen'; updateToolUI();
          boardCamera = { x: 0, y: 0, scale }; applyBoardCamera();
        }, scale);
        await page.mouse.move(300, 450); await page.mouse.down();
        await page.mouse.move(700, 450, { steps: 8 }); await page.mouse.up();
        await page.locator('#eraserTool').click(); await toastIs('지우개');
        await page.evaluate(() => applyEraserWidth(20, false));
        await page.mouse.move(500, 450);
        const rect = await cursor.boundingBox();
        assert.ok(rect); assert.ok(Math.abs(rect.width - 20 * scale) < 0.1);
        assert.ok(Math.abs(rect.x + rect.width / 2 - 500) < 0.1);
        assert.ok(Math.abs(rect.y + rect.height / 2 - 450) < 0.1);
        assert.equal(await page.locator('#board').evaluate(el => getComputedStyle(el).cursor), 'none');
        assert.equal(await cursor.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        // Real pointer input must erase the same radius shown by the DOM preview.
        await page.mouse.down(); await page.mouse.up();
        const pixels = await page.evaluate(scale => {
          const rect = boardWrapper.getBoundingClientRect();
          const alpha = x => ctx.getImageData(Math.floor((x - rect.left) * pixelRatio), Math.floor((450 - rect.top) * pixelRatio), 1, 1).data[3];
          return { center: alpha(500), inside: alpha(500 + 10 * scale - 2), outside: alpha(500 + 10 * scale + 2), count: strokes.length };
        }, scale);
        assert.equal(pixels.center, 0); assert.equal(pixels.inside, 0); assert.ok(pixels.outside > 0); assert.equal(pixels.count, 2);
        await page.locator('#undoButton').click(); await toastIs('실행 취소');
        assert.equal(await page.evaluate(() => strokes.length), 1);
        await page.locator('#redoButton').click(); await toastIs('다시 실행');
        assert.equal(await page.evaluate(() => strokes.length), 2);
      }
      await page.evaluate(() => { tool = 'strokeEraser'; updateToolUI(); applyEraserWidth(32, false); });
      await toastIs('획 지우개'); await page.mouse.move(500, 450);
      assert.equal(await cursor.evaluate(el => getComputedStyle(el).borderStyle), 'dashed');
      await page.evaluate(() => { tool = 'pen'; updateToolUI(); });
      assert.equal(await cursor.isVisible(), false);
      await page.evaluate(() => { saveCurrentStrokeState(); renderBoardPage(1); });
      await toastIs('페이지 2 / 2');
      await page.evaluate(() => undoStrokeAction()); await toastIs('되돌릴 작업이 없습니다');
      await page.evaluate(() => fitCurrentBoardPage()); await toastIs('페이지 맞춤');
      await page.evaluate(() => setNavigationModeLock(true)); await toastIs('줌·패닝 잠금');
      await page.evaluate(() => { setNavigationModeLock(false); tool = 'eraser'; updateToolUI(); applyEraserWidth(64, false); });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 650, y: 450 }] });
      assert.equal(await cursor.isVisible(), true);
      const label = page.locator('.board-eraser-label');
      assert.equal(await label.isVisible(), true);
      assert.match(await label.textContent(), /지우개 · 64px/);
      if (process.env.FEEDBACK_SCREENSHOT_DIR && deviceScaleFactor === 1) {
        fs.mkdirSync(process.env.FEEDBACK_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOT_DIR, 'eraser-light.png') });
        await page.evaluate(() => { applyBoardColor('#202733', false); showBoardAction('실행 취소'); });
        await page.screenshot({ path: path.join(process.env.FEEDBACK_SCREENSHOT_DIR, 'eraser-dark.png') });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await cursor.isVisible(), false); assert.equal(await label.isVisible(), false);
      await page.waitForTimeout(1500); assert.equal(await toast.isVisible(), false);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(JSON.stringify({ result: 'passed', checks: ['DPR 1 and 2', 'zoom 0.5/1/2', 'pointer center and actual erased radius', 'undo/redo notifications', 'page/fit/lock notifications', 'stroke eraser style', 'touch label lifecycle', 'automatic dismissal', 'no page errors'] }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
