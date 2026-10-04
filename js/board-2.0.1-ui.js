const DEV_SETTINGS_KEY = "board.v2.dev-settings.v1";
const PDF_ZOOM_SETTING_KEY = "board.settings.allowPdfZoomBelowFit.v1";
const DEV_DEFAULTS = { zoomCueDelayMs: 500, zoomCueShrinkMs: 1500, presetHoldMs: 3000, movementThreshold: 12, zoomSensitivity: 0.008, showTouchOverlay: true };
let devSettings = { ...DEV_DEFAULTS };
let devSettingsDraft = null;
let devSettingsReturnFocus = null;
let devMode = false;
let devTouch = null;
let devTouchTimer = null;
let devTicker = null;
let zoomCueTimer = null;
const workReplacementManager = BoardState.createReplacementManager();
let activeDriveFileId = null;
let driveAuthenticated = false;

async function invokeDrive(command, args = {}) {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Google Drive는 데스크톱 앱에서 사용할 수 있습니다.");
  return invoke(command, args);
}
function formatDriveBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}
async function refreshDriveStatus() {
  const status = document.getElementById("driveStatus");
  const limit = document.getElementById("driveCacheLimit");
  try {
    const cache = await invokeDrive("drive_get_cache_status");
    limit.value = Math.round(cache.limitBytes / (1024 * 1024));
    document.getElementById("driveCacheLabel").textContent = `${formatDriveBytes(cache.usedBytes)} 사용 / ${formatDriveBytes(cache.limitBytes)} 한도`;
    if (driveAuthenticated) status.textContent = "Google Drive 연결됨";
    else if (status.textContent === "연결되지 않음") status.textContent = `Google Drive 미연결 · 캐시 ${formatDriveBytes(cache.usedBytes)} 사용`;
    return true;
  } catch (error) { status.textContent = error.message || "Drive 상태를 불러오지 못했습니다."; return false; }
}
async function loadDrivePdfList() {
  const status = document.getElementById("driveStatus"), list = document.getElementById("driveFileList");
  status.textContent = "PDF 목록 불러오는 중…"; list.replaceChildren();
  try {
    const files = []; let pageToken;
    do {
      const response = await invokeDrive("drive_list_pdfs", pageToken ? { pageToken } : {});
      files.push(...(response.files || [])); pageToken = response.nextPageToken || null;
    } while (pageToken);
    for (const file of files) {
      const button = document.createElement("button"); button.type = "button"; button.textContent = `${file.name} · ${formatDriveBytes(file.size)}`;
      button.addEventListener("click", () => { void importDrivePdf(file); }); list.appendChild(button);
    }
    driveAuthenticated = true;
    status.textContent = `연결됨 · PDF ${files.length}개`;
    await refreshDriveStatus();
    status.textContent = `연결됨 · PDF ${files.length}개`;
  } catch (error) { status.textContent = error.message || "Drive PDF 목록을 불러오지 못했습니다."; }
}
async function importDrivePdf(file) {
  const status = document.getElementById("driveStatus"); status.textContent = `${file.name} 가져오기 대기 중…`;
  try {
    const imported = await requestBoardWorkReplacement(async () => {
      status.textContent = `${file.name} 다운로드 중…`;
      const result = await invokeDrive("drive_download_pdf", { fileId: file.id });
      if (!BoardState.isByteLengthWithinLimit(result.size, BoardState.MAX_PDF_BYTES) || !BoardState.isBase64WithinLimit(result.pdfBase64, BoardState.MAX_PDF_BYTES)) {
        throw new Error("PDF 파일은 256 MiB 이하만 가져올 수 있습니다.");
      }
      const bytes = Uint8Array.from(atob(result.pdfBase64), (character) => character.charCodeAt(0));
      if (!(await loadPdfFromFile(new File([bytes], result.name || file.name, { type: "application/pdf" })))) return false;
      try {
        await invokeDrive("drive_set_active_pdf", { fileId: result.fileId || file.id });
        activeDriveFileId = result.fileId || file.id;
      } catch (error) {
        setDocumentStatus(`${result.name || file.name}을 열었지만 캐시 상태를 갱신하지 못했습니다. ${error.message || ""}`, "warning");
      }
      return true;
    });
    if (imported) { status.textContent = `${file.name} 가져옴`; document.getElementById("driveDialog").classList.add("is-hidden"); closeDocumentPopup(); }
    else status.textContent = "가져오기가 취소되었거나 완료되지 않았습니다.";
  } catch (error) { status.textContent = error.message || "Drive PDF를 가져오지 못했습니다."; }
}
async function clearActiveDrivePin() {
  if (!getTauriInvoke()) { activeDriveFileId = null; return true; }
  try {
    await invokeDrive("drive_set_active_pdf", { fileId: null });
    activeDriveFileId = null;
    return true;
  } catch (error) {
    setDocumentStatus(`현재 작업을 열었지만 이전 Drive 파일을 캐시에서 해제하지 못했습니다. ${error.message || ""}`, "warning");
    return false;
  }
}
function openDriveDialog() {
  const dialog = document.getElementById("driveDialog"); closeDocumentPopup(); dialog.classList.remove("is-hidden");
  document.getElementById("closeDriveDialog").focus();
  void refreshDriveStatus();
}

function currentBoardPage() { return boardPageSequence[boardPageIndex] || null; }
function finishActiveBoardInput() {
  if (activePanPointerId !== null) endPanOrZoom({ pointerId: activePanPointerId });
  if (strokeEraserActive && strokeEraserPointerId !== null) stopStrokeErasing({ pointerId: strokeEraserPointerId });
  if (drawing && currentInputPointerId !== null) stopDrawing({ type: "pointercancel", pointerId: currentInputPointerId });
  currentInputPointerId = null;
}
function saveBoardPageView() {
  BoardState.savePageState(boardPageSequence, boardPageIndex, strokes, boardCamera);
}
function renderBoardPage(index = boardPageIndex) {
  if (!boardPageSequence.length) boardPageSequence = BoardState.createPageSequence(0);
  clearPdfRenderDebounce();
  pdfRenderToken += 1;
  stopPdfRenderTask();
  const target = BoardState.pageForRender(boardPageSequence, index);
  boardPageIndex = target.index;
  const page = target.page;
  if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height };
  pdfPageNumber = page.kind === "pdf" ? page.pdfPage : 0;
  boardCamera = page.view ? { ...page.view } : { x: 0, y: 0, scale: 1 };
  pdfPageRasterCanvas = null;
  if (page.kind === "blank") applyBoardColor(page.background || "#ffffff", false);
  restoreCurrentStrokeState();
  if (page.kind === "pdf") void renderPdfPage(page.pdfPage);
  else renderBoardBackground();
  applyBoardCamera();
  updateBoardSequenceUI();
  updateUndoRedoUI();
  scheduleSessionAutosave();
}
function updateBoardSequenceUI() {
  const label = `${boardPageIndex + 1} / ${boardPageSequence.length}`;
  pdfPageIndicator.textContent = label;
  if (toolbarPdfPageIndicator) {
    toolbarPdfPageIndicator.textContent = label;
    toolbarPdfPageIndicator.classList.toggle("is-empty", boardPageSequence.length <= 1);
  }
  pdfPrevPageButton.disabled = boardPageIndex <= 0 || pdfExportInProgress || sessionRestoreInProgress;
  pdfNextPageButton.disabled = boardPageIndex >= boardPageSequence.length - 1 || pdfExportInProgress || sessionRestoreInProgress;
  removeDocumentButton.disabled = !hasLoadedPdfDocument() || pdfExportInProgress || sessionRestoreInProgress;
  if (pageManager) pageManager.classList.toggle("is-hidden", !pageManagerOpen);
  renderPageList();
}
function selectSettingsCategory(category) {
  const allowed = new Set(["documents", "screen", "remote", "about"]);
  if (!allowed.has(category)) return;
  document.querySelectorAll("[data-settings-category]").forEach((button) => {
    if (button.dataset.settingsCategory === category) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== category; });
  if (window.BoardRemote) {
    if (category === "remote") window.BoardRemote.openSettings(document.getElementById("remoteSettingsContent"));
    else window.BoardRemote.setSettingsContext({ open: true, remote: false });
  }
}
let pageManagerOpen = false;
function renderPageList() {
  if (!pageList) return;
  pageList.replaceChildren();
  boardPageSequence.forEach((page, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `page-entry${index === boardPageIndex ? " is-active" : ""}`;
    button.textContent = `${index + 1} · ${page.kind === "pdf" ? `PDF ${page.pdfPage}쪽` : "칠판"}`;
    button.addEventListener("click", () => { finishActiveBoardInput(); saveCurrentStrokeState(); saveBoardPageView(); renderBoardPage(index); });
    pageList.appendChild(button);
  });
  const active = currentBoardPage();
  deleteBlankPageButton.disabled = !active || active.kind !== "blank" || boardPageSequence.length <= 1;
  pageStructureUndoButton.disabled = pageStructureUndo.length === 0;
  pageStructureRedoButton.disabled = pageStructureRedo.length === 0;
}
function addBoardBlankPage() {
  if (pdfExportInProgress || sessionRestoreInProgress) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView();
  const index = boardPageIndex + 1;
  const page = BoardState.createBlankPage(`blank:${Date.now()}`);
  page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height };
  const op = { action: "add", index, page: structuredClone(page) };
  boardPageSequence.splice(index, 0, page);
  pageStructureUndo.push(op); pageStructureRedo.length = 0;
  renderBoardPage(index);
}
function deleteBoardBlankPage() {
  if (!BoardState.canDeletePage(boardPageSequence, boardPageIndex)) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView();
  const op = { action: "delete", index: boardPageIndex, page: null };
  BoardState.applyStructureOperation(boardPageSequence, op, true);
  pageStructureUndo.push(op); pageStructureRedo.length = 0;
  renderBoardPage(Math.max(0, boardPageIndex - 1));
}
function runPageStructureUndo(redo) {
  const from = redo ? pageStructureRedo : pageStructureUndo;
  const to = redo ? pageStructureUndo : pageStructureRedo;
  const op = from[from.length - 1];
  if (!op) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView();
  const oldIndex = boardPageIndex;
  if (!BoardState.applyStructureOperation(boardPageSequence, op, redo)) return;
  from.pop(); to.push(op);
  let next = oldIndex;
  if (op.action === "add") {
    if (redo && op.index <= oldIndex) next += 1;
    if (!redo && op.index < oldIndex) next -= 1;
  } else if (!redo) next = op.index;
  else if (op.index <= oldIndex) next = Math.max(0, oldIndex - 1);
  renderBoardPage(next);
}
function goToBoardPage(delta) {
  const next = boardPageIndex + delta;
  if (next < 0 || next >= boardPageSequence.length) return;
  finishActiveBoardInput();
  saveCurrentStrokeState(); saveBoardPageView(); renderBoardPage(next);
}
function applyBoardCamera() {
  if (boardWorld) boardWorld.style.transform = "none";
  renderBoardBackground();
  redrawAllStrokes();
}
function boardPageFitCamera(page, rect, ratio = pixelRatio) {
  const bounds = page && page.pdfContentBounds;
  if (!bounds || !(ratio > 0) || !(bounds.width > 0) || !(bounds.height > 0)) return null;
  const x = bounds.x / ratio, y = bounds.y / ratio;
  const width = bounds.width / ratio, height = bounds.height / ratio;
  const scale = Math.min(rect.width / width, rect.height / height);
  return { x: (rect.width - width * scale) / 2 - x * scale, y: (rect.height - height * scale) / 2 - y * scale, scale };
}
function isPdfZoomBelowFitAllowed() {
  try { return window.localStorage.getItem(PDF_ZOOM_SETTING_KEY) === "true"; } catch { return false; }
}
function setPdfZoomBelowFitAllowed(allowed) {
  try { window.localStorage.setItem(PDF_ZOOM_SETTING_KEY, String(Boolean(allowed))); } catch {}
  if (!allowed) enforcePdfZoomMinimum();
}
function minimumBoardZoomScale() {
  const page = currentBoardPage();
  if (!page || page.kind !== "pdf") return 0.2;
  const fit = boardPageFitCamera(page, boardWrapper.getBoundingClientRect());
  if (!fit || !(fit.scale > 0)) return 0.2;
  return isPdfZoomBelowFitAllowed() ? Math.min(0.2, fit.scale * 0.2) : fit.scale;
}
function zoomBoardCameraAt(camera, anchor, factor, minimumScale = minimumBoardZoomScale()) {
  const scale = Math.max(minimumScale, Math.min(Math.max(6, minimumScale), camera.scale * factor));
  const world = BoardState.pointToWorld(anchor, camera);
  return { x: anchor.x - world.x * scale, y: anchor.y - world.y * scale, scale };
}
function enforcePdfZoomMinimum() {
  const minimum = minimumBoardZoomScale();
  if (boardCamera.scale >= minimum) return false;
  const rect = boardWrapper.getBoundingClientRect();
  boardCamera = zoomBoardCameraAt(boardCamera, { x: rect.width / 2, y: rect.height / 2 }, minimum / boardCamera.scale, minimum);
  saveBoardPageView();
  applyBoardCamera();
  scheduleSessionAutosave();
  return true;
}
function isCurrentBoardPageFitted(rect = boardWrapper.getBoundingClientRect(), ratio = pixelRatio) {
  const expected = boardPageFitCamera(currentBoardPage(), rect, ratio);
  if (!expected || !boardCamera) return false;
  const tolerance = 0.01;
  return Math.abs(boardCamera.x - expected.x) < tolerance
    && Math.abs(boardCamera.y - expected.y) < tolerance
    && Math.abs(boardCamera.scale - expected.scale) < tolerance;
}
function refitBoardPageAfterViewportResize(previousRect, previousRatio) {
  return isCurrentBoardPageFitted(previousRect, previousRatio) && fitCurrentBoardPage(false);
}
function fitCurrentBoardPage(finishInput = true) {
  if (finishInput) finishActiveBoardInput();
  const page = currentBoardPage();
  if (page && page.kind === "pdf") {
    const fitted = boardPageFitCamera(page, boardWrapper.getBoundingClientRect());
    if (!fitted) return false;
    boardCamera = fitted;
  } else boardCamera = { x: 0, y: 0, scale: 1 };
  saveBoardPageView(); applyBoardCamera(); scheduleSessionAutosave();
  return true;
}
function boardWorkSnapshot() {
  saveCurrentStrokeState(); saveBoardPageView();
  if (hasLoadedPdfDocument() && !(loadedPdfBytes instanceof Uint8Array)) throw new Error("원본 PDF가 복구되지 않아 작업 파일을 만들 수 없습니다. PDF를 다시 불러오세요.");
  return { format: "boardcanvas-work", version: 1, savedAt: Date.now(), name: loadedDocumentName, pdfBase64: loadedPdfBytes ? encodeBase64(loadedPdfBytes) : null, pageIndex: boardPageIndex, pages: boardPageSequence.map((page) => ({ ...page, strokes: cloneStrokeCollection(page.strokes || []), view: page.view ? { ...page.view } : null, pdfWorldSize: page.pdfWorldSize ? { ...page.pdfWorldSize } : null, worldSize: page.worldSize ? { ...page.worldSize } : null })) };
}
function encodeBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
async function saveBoardWorkFile(requireVerified = false) {
  try {
    const data = new Blob([JSON.stringify(boardWorkSnapshot())], { type: "application/json" });
    if (!BoardState.isByteLengthWithinLimit(data.size, BoardState.MAX_SAVED_DOCUMENT_BYTES)) throw new Error("작업 파일은 512 MiB 이하만 저장할 수 있습니다. 필기량을 줄인 뒤 다시 저장해 주세요.");
    const fileName = `${(loadedDocumentName || "칠판").replace(/\.pdf$/i, "")}.boardwork`;
    const invoke = getTauriInvoke();
    if (invoke) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      const result = await invoke("save_document_file", { suggestedName: fileName, contentsBase64: encodeBase64(bytes), kind: "work" });
      if (!result || result.saved !== true) { setDocumentStatus("저장을 취소했습니다.", "warning"); return false; }
      setDocumentStatus("작업 파일을 저장했습니다.", "success");
      return true;
    }
    if (typeof window.showSaveFilePicker === "function") {
      const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: "Board 작업 파일", accept: { "application/json": [".boardwork"] } }] });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      setDocumentStatus("작업 파일을 저장했습니다.", "success");
      return true;
    }
    if (requireVerified) {
      setDocumentStatus("이 환경에서는 저장 완료를 확인할 수 없어 현재 작업을 유지했습니다.", "error");
      return false;
    }
    downloadBlobFile(data, fileName);
    setDocumentStatus("작업 파일 다운로드를 요청했습니다. 파일이 저장됐는지 확인해 주세요.", "warning");
    return true;
  } catch (error) {
    setDocumentStatus(error.message || "작업 파일을 만들지 못했습니다.", "error");
    return false;
  }
}
function requestBoardWorkReplacement(action) {
  if (workReplacementManager.hasPending()) {
    setDocumentStatus("다른 작업을 열기 위한 확인이 진행 중입니다. 먼저 현재 대화상자에서 선택해 주세요.", "warning");
    return Promise.resolve(false);
  }
  finishActiveBoardInput();
  saveCurrentStrokeState();
  saveBoardPageView();
  const hasWork = hasLoadedPdfDocument() || boardPageSequence.length > 1 || boardPageSequence.some((page) => (page.strokes || []).length);
  const request = workReplacementManager.request(action);
  if (!request.accepted) {
    setDocumentStatus("다른 작업을 열기 위한 확인이 진행 중입니다. 먼저 현재 대화상자에서 선택해 주세요.", "warning");
    return request.promise;
  }
  if (!hasWork) {
    const pending = workReplacementManager.take();
    void (async () => {
      try {
        const result = await pending.action();
        if (result === false) throw new Error("새 작업을 열지 못해 현재 작업을 유지했습니다.");
        workReplacementManager.settle(pending, true);
      } catch (error) {
        setDocumentStatus(error.message || "새 작업을 열지 못했습니다.", "error");
        workReplacementManager.settle(pending, false);
      }
    })();
    return request.promise;
  }
  replaceWorkDialog.classList.remove("is-hidden");
  return request.promise;
}
async function runUpdaterCheck(userInitiated) {
  const status = document.getElementById("updateStatus");
  const invoke = getTauriInvoke();
  if (!invoke) { if (userInitiated) status.textContent = "데스크톱 앱에서만 업데이트를 확인할 수 있습니다."; return false; }
  try {
    const { configured } = await invoke("get_updater_status");
    if (!configured) { if (userInitiated) status.textContent = "업데이트 배포 설정이 아직 준비되지 않았습니다."; return false; }
    const updater = window.__TAURI__ && window.__TAURI__.updater;
    if (!updater || typeof updater.checkUpdate !== "function" || typeof updater.installUpdate !== "function") throw new Error("업데이트 기능을 이 앱에서 사용할 수 없습니다.");
    status.textContent = "업데이트 확인 중…";
    const result = await updater.checkUpdate();
    if (!result.shouldUpdate) { status.textContent = "최신 버전을 사용 중입니다."; return true; }
    const manifest = result.manifest || {};
    if (!window.confirm(`${manifest.version || "새 버전"} 업데이트를 설치할까요?`)) { status.textContent = "설치를 취소했습니다."; return true; }
    if (!(await persistSessionState())) throw new Error("작업 복구 데이터를 안전하게 저장하지 못해 설치를 중단했습니다.");
    status.textContent = "업데이트 설치 중…";
    await updater.installUpdate();
    status.textContent = "업데이트를 설치했습니다.";
    return true;
  } catch (error) {
    status.textContent = error && error.message ? error.message : "업데이트를 확인하지 못했습니다.";
    return false;
  }
}
async function finishBoardWorkReplacement(save) {
  const pending = workReplacementManager.take();
  replaceWorkDialog.classList.add("is-hidden");
  if (!pending) return;
  try { if (save && !(await saveBoardWorkFile(true))) { workReplacementManager.settle(pending, false); return; } const result = await pending.action(); if (result === false) throw new Error("새 작업을 열지 못해 현재 작업을 유지했습니다."); workReplacementManager.settle(pending, true); }
  catch (error) { setDocumentStatus(error.message || "새 작업을 열지 못했습니다.", "error"); workReplacementManager.settle(pending, false); }
}
async function openBoardWorkFile(file) {
  if (!file || !BoardState.isByteLengthWithinLimit(file.size, BoardState.MAX_WORK_FILE_BYTES)) throw new Error("작업 파일은 512 MiB 이하만 열 수 있습니다.");
  const state = JSON.parse(await file.text());
  if (!state || state.format !== "boardcanvas-work" || state.version !== 1 || !Array.isArray(state.pages) || !state.pages.length || state.pages.length > 1000) throw new Error("작업 파일 형식이 올바르지 않습니다.");
  const pages = state.pages.map((page, index) => {
    if (!page || (page.kind !== "pdf" && page.kind !== "blank")) throw new Error("작업 파일의 페이지 정보가 올바르지 않습니다.");
    const view = page.view;
    if (view && (![view.x, view.y, view.scale].every((value) => Number.isFinite(Number(value))) || Number(view.scale) <= 0)) throw new Error("작업 파일의 화면 위치 정보가 올바르지 않습니다.");
    const pdfPage = Number(page.pdfPage);
    if (page.kind === "pdf" && (!Number.isInteger(pdfPage) || pdfPage < 1)) throw new Error("작업 파일의 PDF 페이지 번호가 올바르지 않습니다.");
    const worldSize = page.worldSize && Number.isFinite(Number(page.worldSize.width)) && Number.isFinite(Number(page.worldSize.height)) ? { width: Math.max(1, Number(page.worldSize.width)), height: Math.max(1, Number(page.worldSize.height)) } : null;
    const pdfContentBounds = page.pdfContentBounds && [page.pdfContentBounds.x, page.pdfContentBounds.y, page.pdfContentBounds.width, page.pdfContentBounds.height].every((value) => Number.isFinite(Number(value))) && Number(page.pdfContentBounds.width) > 0 && Number(page.pdfContentBounds.height) > 0
      ? { x: Number(page.pdfContentBounds.x), y: Number(page.pdfContentBounds.y), width: Number(page.pdfContentBounds.width), height: Number(page.pdfContentBounds.height) }
      : null;
    return { id: typeof page.id === "string" ? page.id.slice(0, 80) : `${page.kind}:${index + 1}`, kind: page.kind, ...(page.kind === "pdf" ? { pdfPage, pdfWorldSize: page.pdfWorldSize && Number.isFinite(Number(page.pdfWorldSize.width)) && Number.isFinite(Number(page.pdfWorldSize.height)) ? { width: Math.max(1, Number(page.pdfWorldSize.width)), height: Math.max(1, Number(page.pdfWorldSize.height)) } : null, pdfContentBounds } : { background: normalizeHexColor(page.background) || "#ffffff", worldSize }), strokes: normalizeStrokeCollection(page.strokes), view: view ? { x: Number(view.x), y: Number(view.y), scale: Math.max(0.2, Math.min(6, Number(view.scale))) } : null };
  });
  const pdfPages = pages.filter((page) => page.kind === "pdf");
  if (state.pdfBase64 && !pdfPages.length) throw new Error("작업의 PDF 페이지 구성이 올바르지 않습니다.");
  if (!state.pdfBase64 && pdfPages.length) throw new Error("작업 파일에 연결된 PDF가 없습니다.");
  const rawPageIndex = Number(state.pageIndex);
  if (!Number.isInteger(rawPageIndex) || rawPageIndex < 0 || rawPageIndex >= pages.length) throw new Error("작업 파일의 현재 페이지 번호가 올바르지 않습니다.");
  let pdfBytes = null;
  if (state.pdfBase64) {
    if (!BoardState.isBase64WithinLimit(state.pdfBase64, BoardState.MAX_PDF_BYTES)) throw new Error("작업 파일 안의 PDF가 256 MiB 한도를 초과했거나 손상되었습니다.");
    try { pdfBytes = Uint8Array.from(atob(state.pdfBase64), (char) => char.charCodeAt(0)); }
    catch { throw new Error("작업 파일의 PDF 데이터가 손상되었습니다."); }
    if (!(await configurePdfWorker())) throw new Error("PDF 읽기를 준비하지 못했습니다.");
    let candidate;
    try {
      candidate = await window.pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
      if (pdfPages.some((page) => page.pdfPage > Number(candidate.numPages))) throw new Error("작업에 PDF의 존재하지 않는 페이지가 포함되어 있습니다.");
    } catch (error) { throw new Error(error.message || "작업 파일의 PDF를 확인하지 못했습니다."); }
    finally { if (candidate) await candidate.destroy(); }
  }
  const apply = async () => {
    if (state.pdfBase64) {
      const fileName = `${String(state.name || "작업").replace(/[\\/:*?"<>|]+/g, "_")}.pdf`;
      if (!(await loadPdfFromFile(new File([pdfBytes], fileName, { type: "application/pdf" })))) return false;
      await clearActiveDrivePin();
    } else {
      if (pdfDocument) await unloadPdfDocument(false);
      await clearActiveDrivePin();
    }
    pages.forEach((page) => { if (page.kind === "pdf" && !page.pdfWorldSize) page.pdfWorldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; });
    boardPageSequence = pages;
    boardPageIndex = rawPageIndex;
    pageStructureUndo.length = 0; pageStructureRedo.length = 0; clearAllStrokeHistory();
    renderBoardPage(boardPageIndex); closeDocumentPopup(); scheduleSessionAutosave();
  };
  return requestBoardWorkReplacement(apply);
}
function updateBoardViewport() {
  updatePanFitButton();
  if (!toolbar || !boardWrapper || toolbarLayout.placement === "floating") {
    boardWrapper.style.inset = "0"; setCanvasSize(); return;
  }
  const appRect = app.getBoundingClientRect(), rect = toolbar.getBoundingClientRect();
  if (toolbarLayout.placement === "top") boardWrapper.style.inset = `${Math.ceil(rect.bottom - appRect.top)}px 0 0`;
  else if (toolbarLayout.placement === "bottom") boardWrapper.style.inset = `0 0 ${Math.ceil(appRect.bottom - rect.top)}px`;
  else if (toolbarLayout.placement === "left") boardWrapper.style.inset = `0 0 0 ${Math.ceil(rect.right - appRect.left)}px`;
  else if (toolbarLayout.placement === "right") boardWrapper.style.inset = `0 ${Math.ceil(appRect.right - rect.left)}px 0 0`;
  setCanvasSize();
}
function updatePanFitButton() {
  if (!panFitButton || !pageModeToggleButton) return;
  const visible = panMode && !overlayMousePassthrough;
  panFitButton.hidden = !visible;
  if (!visible) return;
  const toggle = pageModeToggleButton.getBoundingClientRect();
  const rail = toolbar.getBoundingClientRect();
  const size = Math.max(toggle.width, toggle.height);
  const gap = 4;
  let left = toggle.left, top = toggle.top;
  if (toolbarLayout.placement === "right") left = rail.left - size - gap;
  else if (toolbarLayout.placement === "left") left = rail.right + gap;
  else if (toolbarLayout.placement === "bottom") top = rail.top - size - gap;
  else if (toolbarLayout.placement === "floating") {
    left = toggle.right + gap;
    if (left + size > window.innerWidth) left = toggle.left - size - gap;
    top = toggle.top;
  } else top = rail.bottom + gap;
  panFitButton.style.left = `${Math.max(4, Math.min(window.innerWidth - size - 4, left))}px`;
  panFitButton.style.top = `${Math.max(4, Math.min(window.innerHeight - size - 4, top))}px`;
  panFitButton.style.width = `${size}px`;
  panFitButton.style.height = `${size}px`;
}
function setPanMode(enabled) {
  if (Boolean(enabled) !== panMode) finishActiveBoardInput();
  panMode = Boolean(enabled);
  if (panMode) tool = "pen";
  pageModeToggleButton.setAttribute("aria-pressed", String(panMode));
  pageModeToggleButton.classList.toggle("is-active", panMode);
  pageModeToggleButton.setAttribute("aria-label", panMode ? "패닝 모드 (눌러 펜으로 돌아가기)" : "펜 모드 (눌러 패닝 전환)");
  pageModeToggleButton.title = panMode ? "패닝 중 · 눌러 펜으로 돌아가기" : "펜 / 패닝 전환";
  pageModeToggleButton.classList.toggle("is-pan-mode", panMode);
  pageModeToggleButton.innerHTML = panMode
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v8-4a1.5 1.5 0 0 1 3 0v7c0 4-2 6-6 6h-2c-2 0-3.5-1-5-3l-3-4a1.5 1.5 0 0 1 2-2z"></path></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8 4 20z"></path><path d="M14.8 6.1l3.1 3.1"></path></svg>';
  updatePanFitButton();
  updateToolUI();
}
function startPanOrZoomHold(event) {
  if (!panMode || !event.isPrimary || currentInputPointerId !== null) return false;
  currentInputPointerId = event.pointerId;
  activePanPointerId = event.pointerId;
  const start = { x: event.clientX, y: event.clientY, camera: { ...boardCamera }, started: false };
  pendingZoomHold = start;
  canvas.setPointerCapture(event.pointerId);
  devTouch = { x: event.clientX, y: event.clientY, start: performance.now() };
  if (devMode && devSettings.showTouchOverlay) { showDevTouch(); devTicker = window.setInterval(showDevTouch, 50); }
  window.clearTimeout(zoomCueTimer);
  zoomCueTimer = window.setTimeout(() => {
    if (pendingZoomHold === start && !start.started) showZoomHoldCue(boardWrapper, canvasPointFromClient(start.x, start.y), devSettings.zoomCueShrinkMs);
    zoomCueTimer = null;
  }, devSettings.zoomCueDelayMs);
  window.clearTimeout(devTouchTimer);
  devTouchTimer = window.setTimeout(() => {
    if (pendingZoomHold !== start || !BoardState.canActivateZoomHold(performance.now() - devTouch.start, 0, devSettings.movementThreshold, devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs)) return;
    start.started = true;
    zoomGesture = { startY: start.y, lastY: start.y, directionScale: boardCamera.scale, direction: "in", baseScale: boardCamera.scale, baseCamera: { ...boardCamera }, anchor: canvasPointFromClient(start.x, start.y) };
    hideZoomCue();
    canvas.classList.add("is-zooming-in");
    showZoomCue(boardWrapper, canvasPointFromClient(start.x, start.y), undefined);
  }, devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs);
  return true;
}
function canvasPointFromClient(clientX, clientY) {
  const rect = boardWrapper.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
function continuePanOrZoom(event) {
  if (activePanPointerId !== event.pointerId || !pendingZoomHold) return false;
  const dx = event.clientX - pendingZoomHold.x, dy = event.clientY - pendingZoomHold.y;
  if (!pendingZoomHold.started && Math.hypot(dx, dy) > devSettings.movementThreshold) {
    window.clearTimeout(devTouchTimer); window.clearTimeout(zoomCueTimer); devTouchTimer = null; zoomCueTimer = null; pendingZoomHold.started = false;
    hideZoomCue();
  }
  if (pendingZoomHold.started && zoomGesture) {
    const factor = Math.exp((zoomGesture.startY - event.clientY) * devSettings.zoomSensitivity);
    boardCamera = zoomBoardCameraAt(zoomGesture.baseCamera || pendingZoomHold.camera, zoomGesture.anchor, factor);
    const direction = event.clientY === zoomGesture.lastY ? zoomGesture.direction : event.clientY < zoomGesture.lastY ? "in" : "out";
    if (direction !== zoomGesture.direction) { zoomGesture.direction = direction; zoomGesture.directionScale = boardCamera.scale; }
    zoomGesture.lastY = event.clientY;
    canvas.classList.toggle("is-zooming-out", direction === "out");
    canvas.classList.toggle("is-zooming-in", direction === "in");
    showZoomCue(boardWrapper, canvasPointFromClient(event.clientX, event.clientY), direction, Math.abs(Math.log(boardCamera.scale / zoomGesture.directionScale)));
    window.clearTimeout(zoomCueTimer);
    zoomCueTimer = window.setTimeout(() => { if (zoomGesture) showZoomCue(boardWrapper, canvasPointFromClient(event.clientX, event.clientY), undefined); }, 150);
  } else {
    boardCamera = { ...pendingZoomHold.camera, x: pendingZoomHold.camera.x + dx, y: pendingZoomHold.camera.y + dy };
  }
  applyBoardCamera();
  if (devMode) { devTouch.x = event.clientX; devTouch.y = event.clientY; showDevTouch(event.clientX, event.clientY); }
  return true;
}
function endPanOrZoom(event) {
  if (activePanPointerId !== event.pointerId) return false;
  window.clearTimeout(devTouchTimer); window.clearTimeout(zoomCueTimer); devTouchTimer = null; zoomCueTimer = null;
  window.clearInterval(devTicker); devTicker = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  activePanPointerId = null; currentInputPointerId = null; pendingZoomHold = null; zoomGesture = null;
  canvas.classList.remove("is-zooming-in", "is-zooming-out");
  hideZoomCue(); hideDevTouch();
  saveBoardPageView(); scheduleSessionAutosave();
  return true;
}
function getZoomCue(container, id) {
  let cue = document.getElementById(id);
  if (!cue) { cue = document.createElement("div"); cue.id = id; cue.className = "zoom-cue"; container.append(cue); }
  return cue;
}
function showZoomHoldCue(container, point, duration, id = "zoomCue") {
  const cue = getZoomCue(container, id);
  cue.classList.remove("is-zooming", "is-zooming-in", "is-zooming-out"); cue.classList.add("is-holding");
  cue.style.left = `${point.x}px`; cue.style.top = `${point.y}px`; cue.style.setProperty("--zoom-hold-ms", `${duration}ms`); cue.innerHTML = ""; cue.hidden = false;
}
function showZoomCue(container, point, direction, amount = 0, id = "zoomCue") {
  const cue = getZoomCue(container, id);
  cue.classList.remove("is-holding", "is-zooming-in", "is-zooming-out"); cue.classList.add("is-zooming", direction === "out" ? "is-zooming-out" : "is-zooming-in");
  cue.style.left = `${point.x}px`; cue.style.top = `${point.y}px`;
  cue.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="13" cy="13" r="8"></circle><path d="m19 19 8 8"></path><g class="zoom-cue-mark"><path d="M9 13h8"></path><path class="zoom-cue-mark-vertical" d="M13 9v8"></path></g></svg>';
  const mark = cue.querySelector(".zoom-cue-mark");
  if (mark) {
    mark.style.display = direction ? "" : "none";
    mark.setAttribute("transform", `translate(13 13) scale(${Math.min(1, 0.4 + Math.max(0, amount) * 3)}) translate(-13 -13)`);
    const vertical = cue.querySelector(".zoom-cue-mark-vertical");
    if (vertical) vertical.style.display = direction === "in" ? "" : "none";
  }
  cue.hidden = false;
}
function hideZoomCue(id = "zoomCue") { if (id === "zoomCue") { window.clearTimeout(zoomCueTimer); zoomCueTimer = null; } const cue = document.getElementById(id); if (cue) cue.hidden = true; }
function showDevTouch(x = devTouch && devTouch.x, y = devTouch && devTouch.y) {
  if (!devTouch || !devMode || !devSettings.showTouchOverlay) return;
  let mark = document.getElementById("devTouchMark");
  if (!mark) { mark = document.createElement("div"); mark.id = "devTouchMark"; mark.className = "dev-touch-mark"; boardWrapper.append(mark); }
  const rect = boardWrapper.getBoundingClientRect(); mark.style.left = `${x - rect.left}px`; mark.style.top = `${y - rect.top}px`; mark.hidden = false;
  mark.style.setProperty("--dev-radius", `${devSettings.movementThreshold}px`);
  mark.textContent = `${Math.max(0, Math.ceil(devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs - (performance.now() - devTouch.start)))} ms`;
}
function hideDevTouch() { const mark = document.getElementById("devTouchMark"); if (mark) mark.hidden = true; }
function openPageManager(open) {
  pageManagerOpen = open;
  pageManager.classList.toggle("is-hidden", !open);
  renderPageList();
  if (open) closePageManagerButton.focus();
  else if (document.activeElement === closePageManagerButton) pageManagerButton.focus();
}
function placeToolbarPopup(triggerElement, popup) {
  if (popup.classList.contains("is-hidden")) return;
  const rect = triggerElement.getBoundingClientRect();
  const placement = ["top", "bottom", "left", "right"].find((value) => app.classList.contains(`toolbar-placement-${value}`)) || "left";
  popup.style.position = "fixed";
  popup.style.right = "auto";
  const width = popup.offsetWidth, height = popup.offsetHeight;
  const preferredLeft = placement === "right" ? rect.left - width - 8 : placement === "left" ? rect.right + 8 : rect.left;
  const preferredTop = placement === "top" ? rect.bottom + 8 : placement === "bottom" ? rect.top - height - 8 : rect.top;
  popup.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, preferredLeft))}px`;
  popup.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, preferredTop))}px`;
}
function openDeveloperSettings() {
  const panel = document.getElementById("developerSettings");
  if (!panel) return;
  devSettingsReturnFocus = isDocumentPopupOpen() ? openDocumentPopupButton : document.activeElement;
  if (isDocumentPopupOpen()) closeDocumentPopup();
  devSettingsDraft = { ...devSettings };
  const backdrop = document.getElementById("developerSettingsBackdrop");
  if (backdrop) backdrop.hidden = false;
  panel.hidden = false; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-labelledby", "devSettingsTitle"); panel.setAttribute("aria-modal", "true"); devMode = true; renderDeveloperSettings();
  panel.querySelector("[data-dev-close]").focus();
}
function renderDeveloperSettings() {
  const panel = document.getElementById("developerSettings");
  if (!panel) return;
  const draft = devSettingsDraft || { ...devSettings };
  const totalMs = draft.zoomCueDelayMs + draft.zoomCueShrinkMs;
  panel.innerHTML = `<header><strong id="devSettingsTitle">개발자 설정</strong><button type="button" class="dev-close" data-dev-close aria-label="닫기">×</button></header><div class="dev-settings-body"><section class="dev-timing"><h3>터치 줌 타이밍</h3><label>원 표시 지연 <input data-key="zoomCueDelayMs" type="range" min="0" max="1500" step="100" value="${draft.zoomCueDelayMs}"><output>${draft.zoomCueDelayMs}ms</output></label><label>원 축소 시간 <input data-key="zoomCueShrinkMs" type="range" min="500" max="5000" step="100" value="${draft.zoomCueShrinkMs}"><output>${draft.zoomCueShrinkMs}ms</output></label><p class="dev-total">줌 활성화까지 <output data-total>${totalMs}ms</output></p><p class="dev-guidance">시험 영역을 누른 채 기다리세요. 원이 나타나 줄어들고, 움직이거나 놓으면 취소됩니다.</p><div class="dev-test-area" data-dev-test tabindex="0" aria-label="터치 줌 시험 영역"></div></section><section class="dev-other"><label><input data-dev-overlay type="checkbox" ${draft.showTouchOverlay ? "checked" : ""}> 터치 위치·허용 반경·유지 시간 표시</label><label>프리셋 편집 유지 시간 <input data-key="presetHoldMs" type="range" min="1000" max="5000" step="100" value="${draft.presetHoldMs}"><output>${draft.presetHoldMs}ms</output></label><label>움직임 허용 <input data-key="movementThreshold" type="range" min="3" max="40" step="1" value="${draft.movementThreshold}"><output>${draft.movementThreshold}px</output></label><label>줌 민감도 <input data-key="zoomSensitivity" type="range" min="0.002" max="0.02" step="0.001" value="${draft.zoomSensitivity}"><output>${draft.zoomSensitivity}</output></label></section></div><footer><button type="button" data-dev-default>기본값</button><button type="button" data-dev-cancel>취소</button><button type="button" data-dev-save>저장</button></footer>`;
  panel.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); discardDeveloperSettings(); return; }
    if (event.key === "Tab") {
      const controls = [...panel.querySelectorAll("button, input, [tabindex='0']")].filter((element) => !element.disabled);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  panel.querySelector("[data-dev-overlay]").addEventListener("change", (event) => { draft.showTouchOverlay = event.target.checked; });
  panel.querySelectorAll("input[data-key]").forEach((input) => input.addEventListener("input", () => {
    draft[input.dataset.key] = Number(input.value);
    input.nextElementSibling.value = `${input.value}${input.dataset.key === "movementThreshold" ? "px" : "ms"}`;
    panel.querySelector("[data-total]").value = `${draft.zoomCueDelayMs + draft.zoomCueShrinkMs}ms`;
    cancelDeveloperTrial();
  }));
  panel.querySelector("[data-dev-default]").onclick = () => { cancelDeveloperTrial(); devSettingsDraft = { ...DEV_DEFAULTS }; renderDeveloperSettings(); panel.querySelector("[data-dev-default]").focus(); };
  panel.querySelector("[data-dev-cancel]").onclick = discardDeveloperSettings;
  panel.querySelector("[data-dev-save]").onclick = saveDeveloperSettings;
  panel.querySelector("[data-dev-close]").onclick = discardDeveloperSettings;
  initDeveloperTrial(panel.querySelector("[data-dev-test]"), draft);
}
function saveDeveloperSettings() {
  devSettings = { ...devSettingsDraft };
  window.localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(devSettings));
  closeDeveloperSettings(true);
}
function discardDeveloperSettings() { closeDeveloperSettings(false); }
let developerTrial = null;
function initDeveloperTrial(area, settings) {
  const cancel = (event) => { if (!developerTrial || (event && event.pointerId !== developerTrial.id)) return; cancelDeveloperTrial(area); };
  area.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || developerTrial) return;
    event.preventDefault();
    const rect = area.getBoundingClientRect(), trial = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top, lastY: event.clientY, directionY: event.clientY, direction: "in", settings };
    developerTrial = trial;
    area.setPointerCapture(event.pointerId);
    trial.cueTimer = window.setTimeout(() => { if (developerTrial === trial) showZoomHoldCue(area, { x: trial.x, y: trial.y }, settings.zoomCueShrinkMs, "devZoomCue"); }, settings.zoomCueDelayMs);
    trial.zoomTimer = window.setTimeout(() => { if (developerTrial === trial) { trial.activated = true; showZoomCue(area, { x: trial.x, y: trial.y }, undefined, 0, "devZoomCue"); } }, settings.zoomCueDelayMs + settings.zoomCueShrinkMs);
  });
  area.addEventListener("pointermove", (event) => {
    if (!developerTrial || event.pointerId !== developerTrial.id) return;
    const trial = developerTrial, rect = area.getBoundingClientRect();
    if (!trial.activated) {
      if (Math.hypot(event.clientX - (rect.left + trial.x), event.clientY - (rect.top + trial.y)) > settings.movementThreshold) cancel();
      return;
    }
    const direction = event.clientY === trial.lastY ? trial.direction : event.clientY < trial.lastY ? "in" : "out";
    if (direction !== trial.direction) { trial.direction = direction; trial.directionY = event.clientY; }
    trial.lastY = event.clientY;
    window.clearTimeout(trial.idleTimer);
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    showZoomCue(area, point, direction, Math.abs(event.clientY - trial.directionY) * settings.zoomSensitivity, "devZoomCue");
    trial.idleTimer = window.setTimeout(() => { if (developerTrial === trial) showZoomCue(area, point, undefined, 0, "devZoomCue"); }, 150);
  });
  area.addEventListener("pointerup", cancel); area.addEventListener("pointercancel", cancel); area.addEventListener("lostpointercapture", cancel);
}
function cancelDeveloperTrial(area = document.querySelector("[data-dev-test]")) {
  const trial = developerTrial; developerTrial = null;
  if (trial) { window.clearTimeout(trial.cueTimer); window.clearTimeout(trial.zoomTimer); window.clearTimeout(trial.idleTimer); if (area && area.hasPointerCapture(trial.id)) area.releasePointerCapture(trial.id); }
  hideZoomCue("devZoomCue");
}
function normalizeDevSettings(saved) {
  const value = saved && typeof saved === "object" ? { ...saved } : {};
  if (Number.isFinite(value.zoomHoldMs) && value.zoomCueDelayMs == null && value.zoomCueShrinkMs == null) {
    const total = Math.max(1000, value.zoomHoldMs);
    value.zoomCueDelayMs = 500;
    value.zoomCueShrinkMs = total - value.zoomCueDelayMs;
  }
  const number = (key, min, max, step = 1) => {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key])) return DEV_DEFAULTS[key];
    const clamped = Math.max(min, Math.min(max, value[key]));
    return min + Math.round((clamped - min) / step) * step;
  };
  return {
    zoomCueDelayMs: number("zoomCueDelayMs", 0, 1500, 100),
    zoomCueShrinkMs: number("zoomCueShrinkMs", 500, 5000, 100),
    presetHoldMs: number("presetHoldMs", 1000, 5000, 100),
    movementThreshold: number("movementThreshold", 3, 40),
    zoomSensitivity: number("zoomSensitivity", 0.002, 0.02, 0.001),
    showTouchOverlay: typeof value.showTouchOverlay === "boolean" ? value.showTouchOverlay : DEV_DEFAULTS.showTouchOverlay,
  };
}
function loadDevSettings() { try { return normalizeDevSettings(JSON.parse(window.localStorage.getItem(DEV_SETTINGS_KEY) || "{}")); } catch { return { ...DEV_DEFAULTS }; } }
function closeDeveloperSettings(saved) {
  cancelDeveloperTrial();
  const panel = document.getElementById("developerSettings");
  if (panel) { panel.hidden = true; panel.removeAttribute("aria-modal"); }
  const backdrop = document.getElementById("developerSettingsBackdrop"); if (backdrop) backdrop.hidden = true;
  devSettingsDraft = null;
  devMode = false; window.clearInterval(devTicker); devTicker = null; hideDevTouch();
  if (devSettingsReturnFocus && devSettingsReturnFocus.isConnected) devSettingsReturnFocus.focus();
  devSettingsReturnFocus = null;
}
function initVersionTap() {
  let count = 0, timer = null;
  const version = document.getElementById("appVersion"); if (!version) return;
  document.getElementById("checkUpdateButton").addEventListener("click", () => { void runUpdaterCheck(true); });
  version.addEventListener("click", () => { count += 1; window.clearTimeout(timer); timer = window.setTimeout(() => { count = 0; }, 1500); if (count >= 7) { count = 0; openDeveloperSettings(); } });
}
function initBoard201Ui() {
  devSettings = loadDevSettings();
  const allowBelowFit = document.getElementById("allowPdfZoomBelowFit");
  allowBelowFit.checked = isPdfZoomBelowFitAllowed();
  allowBelowFit.addEventListener("change", () => setPdfZoomBelowFitAllowed(allowBelowFit.checked));
  pageManagerButton.addEventListener("click", () => { closeDocumentPopup(); openPageManager(true); });
  closePageManagerButton.addEventListener("click", () => openPageManager(false));
  addBlankPageButton.addEventListener("click", addBoardBlankPage);
  deleteBlankPageButton.addEventListener("click", deleteBoardBlankPage);
  pageStructureUndoButton.addEventListener("click", () => runPageStructureUndo(false));
  pageStructureRedoButton.addEventListener("click", () => runPageStructureUndo(true));
  fitPageButton.addEventListener("click", fitCurrentBoardPage);
  panFitButton.addEventListener("click", fitCurrentBoardPage);
  saveBoardWorkButton.addEventListener("click", () => { void saveBoardWorkFile(); });
  openBoardWorkButton.addEventListener("click", () => { boardWorkInput.value = ""; boardWorkInput.click(); });
  boardWorkInput.addEventListener("change", async () => {
    const file = boardWorkInput.files && boardWorkInput.files[0]; boardWorkInput.value = "";
    if (!file) return;
    try { await openBoardWorkFile(file); } catch (error) { setDocumentStatus(error.message || "작업 파일을 열 수 없습니다.", "error"); }
  });
  saveAndReplaceButton.addEventListener("click", () => { void finishBoardWorkReplacement(true); });
  discardAndReplaceButton.addEventListener("click", () => { void finishBoardWorkReplacement(false); });
  cancelReplaceButton.addEventListener("click", () => { workReplacementManager.cancel(); replaceWorkDialog.classList.add("is-hidden"); documentInput.value = ""; });
  pdfPrevPageButton.addEventListener("click", () => goToBoardPage(-1));
  pdfNextPageButton.addEventListener("click", () => goToBoardPage(1));
  document.querySelectorAll("[data-settings-category]").forEach((button) => button.addEventListener("click", () => selectSettingsCategory(button.dataset.settingsCategory)));
  canvas.addEventListener("pointerdown", (event) => { if (panMode) { event.preventDefault(); startPanOrZoomHold(event); } });
  canvas.addEventListener("pointermove", (event) => { if (panMode && activePanPointerId === event.pointerId) { event.preventDefault(); continuePanOrZoom(event); } });
  canvas.addEventListener("pointerup", (event) => { if (panMode) endPanOrZoom(event); });
  canvas.addEventListener("pointercancel", (event) => { if (panMode) endPanOrZoom(event); });
  window.addEventListener("resize", updateBoardViewport);
  const observer = new ResizeObserver(updateBoardViewport); observer.observe(toolbar);
  initVersionTap();
  if (window.BoardRemote) {
    window.BoardRemote.configure({ actions: [
      { id: "previousPage", label: "이전 페이지", run: () => goToBoardPage(-1) },
      { id: "nextPage", label: "다음 페이지", run: () => goToBoardPage(1) },
      { id: "undoInk", label: "필기 취소", run: undoStrokeAction },
      { id: "redoInk", label: "필기 다시 실행", run: redoStrokeAction },
      { id: "togglePenPan", label: "펜 / 패닝 전환", run: () => setPanMode(!panMode) },
      { id: "addBlankPage", label: "칠판 페이지 추가", run: addBoardBlankPage }
    ], showHint: (message) => setDocumentStatus(message, "warning") });
    window.BoardRemote.setSettingsContext({ open: false, remote: false });
  }
  document.getElementById("driveSettingsButton").addEventListener("click", openDriveDialog);
  document.getElementById("closeDriveDialog").addEventListener("click", () => { document.getElementById("driveDialog").classList.add("is-hidden"); openDocumentPopupButton.focus(); });
  document.getElementById("driveConnectButton").addEventListener("click", async () => {
    const status = document.getElementById("driveStatus"); status.textContent = "Google 계정 연결 중…";
    try { await invokeDrive("drive_authenticate"); driveAuthenticated = true; await loadDrivePdfList(); }
    catch (error) { status.textContent = error.message || "Google Drive에 연결하지 못했습니다."; }
  });
  document.getElementById("driveSignOutButton").addEventListener("click", async () => {
    try { await invokeDrive("drive_sign_out"); driveAuthenticated = false; document.getElementById("driveStatus").textContent = "연결 해제됨"; document.getElementById("driveFileList").replaceChildren(); }
    catch (error) { document.getElementById("driveStatus").textContent = error.message || "연결을 해제하지 못했습니다."; }
  });
  document.getElementById("driveCacheLimit").addEventListener("change", async (event) => {
    try { const status = await invokeDrive("drive_set_cache_limit", { bytes: Number(event.target.value) * 1024 * 1024 }); document.getElementById("driveCacheLabel").textContent = `${formatDriveBytes(status.usedBytes)} 사용 / ${formatDriveBytes(status.limitBytes)} 한도`; }
    catch (error) { document.getElementById("driveStatus").textContent = error.message || "캐시 한도를 변경하지 못했습니다."; void refreshDriveStatus(); }
  });
  exportAnnotatedPdfButton.addEventListener("click", () => { closeDocumentPopup(); document.getElementById("exportDialog").classList.remove("is-hidden"); document.getElementById("cancelExportButton").focus(); });
  document.getElementById("cancelExportButton").addEventListener("click", () => { document.getElementById("exportDialog").classList.add("is-hidden"); openDocumentPopupButton.focus(); });
  document.getElementById("confirmExportButton").addEventListener("click", async () => {
    const options = { includeOutsideInk: document.getElementById("exportOutsideInk").checked, includeBlankPages: document.getElementById("exportBlankPages").checked };
    document.getElementById("exportDialog").classList.add("is-hidden");
    await exportAnnotatedPdf(options);
    openDocumentPopupButton.focus();
  });
if (!document.getElementById("developerSettingsBackdrop")) { const backdrop = document.createElement("div"); backdrop.id = "developerSettingsBackdrop"; backdrop.className = "developer-settings-backdrop"; backdrop.hidden = true; document.body.append(backdrop); }
if (!document.getElementById("developerSettings")) { const panel = document.createElement("section"); panel.id = "developerSettings"; panel.className = "developer-settings"; panel.hidden = true; document.body.append(panel); }
  if (!hasLoadedPdfDocument() && boardPageSequence.length === 1 && boardPageSequence[0].kind === "blank" && !(boardPageSequence[0].strokes || []).length && boardStrokeSnapshot.length) boardPageSequence[0].strokes = cloneStrokeCollection(boardStrokeSnapshot);
  window.requestBoardWorkReplacement = requestBoardWorkReplacement;
  window.loadBoardWorkFile = openBoardWorkFile;
  const restorePromise = window.boardRestorePromise || Promise.resolve();
  void restorePromise.then(() => {
    boardPageSequence.forEach((page) => { if (page.kind === "pdf" && !page.pdfWorldSize) page.pdfWorldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; });
    renderBoardPage(boardPageIndex);
    updateBoardViewport();
    return runUpdaterCheck(false);
  });
  applyBoardCamera(); updateBoardViewport(); renderBoardPage(boardPageIndex);
}
initBoard201Ui();
