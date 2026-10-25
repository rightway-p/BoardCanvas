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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true });
    await context.addInitScript(() => localStorage.setItem('board.setup-wizard.completed.v1', 'true'));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      await window.boardRestorePromise;
      boardPageSequence = [BoardState.createBlankPage('smoke-a'), BoardState.createBlankPage('smoke-b')];
      boardPageIndex = 0; renderBoardPage(0); setBoardInteractionMode('multi');
    });
    const cdp = await context.newCDPSession(page);
    const state = () => page.evaluate(() => ({ count: strokes.length, strokes: JSON.stringify(strokes), camera: { ...boardCamera }, undo: !undoButton.disabled, redo: !redoButton.disabled }));
    const contacts = (offset = 0) => [{ id: 1, x: 400 + offset, y: 400 }, { id: 2, x: 440 + offset, y: 400 }];
    async function tap(jitter = 0) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts() });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(jitter) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    async function draw(x) {
      await page.mouse.move(x, 300); await page.mouse.down(); await page.mouse.move(x + 100, 330, { steps: 4 }); await page.mouse.up();
    }
    await draw(350); await draw(550);
    const original = await state(); assert.equal(original.count, 2);
    await tap(2); await tap(3);
    assert.equal((await state()).count, 2);
    await page.waitForTimeout(360); assert.equal((await state()).count, 1);
    assert.deepEqual((await state()).camera, original.camera);
    await tap(); await tap(); await tap();
    assert.equal((await state()).strokes, original.strokes);
    await page.waitForTimeout(360); assert.equal((await state()).strokes, original.strokes);

    await tap(); await tap();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts() });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(70) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(360);
    const panned = await state(); assert.equal(panned.count, 2); assert.notDeepEqual(panned.camera, original.camera); assert.equal(panned.undo, true);
    await page.locator('#undoButton').click(); assert.equal((await state()).count, 1);
    await page.locator('#redoButton').click(); assert.equal((await state()).strokes, original.strokes);
    assert.deepEqual((await state()).camera, panned.camera);

    await tap(); await tap();
    await page.evaluate(() => { finishActiveBoardInput(); saveCurrentStrokeState(); renderBoardPage(1); });
    await page.waitForTimeout(360); assert.equal((await state()).count, 0);
    await draw(350); assert.equal((await state()).count, 1);
    await page.evaluate(() => { finishActiveBoardInput(); saveCurrentStrokeState(); renderBoardPage(0); });
    assert.equal((await state()).strokes, original.strokes);
    await tap(); await tap();
    await page.locator('#eraserTool').focus(); await page.keyboard.press('Enter');
    await page.waitForTimeout(360); assert.equal((await state()).strokes, original.strokes);
    assert.equal(await page.evaluate(() => tool), 'eraser');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'passed', checks: ['double tap', 'triple tap redo only', 'tap jitter preserves camera', 'pan cancels pending undo', 'buttons after pan', 'page isolation', 'keyboard tool change cancels pending undo'], pageErrors: errors }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
