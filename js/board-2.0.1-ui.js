const DEV_SETTINGS_KEY = "board.v2.dev-settings.v1";
const PDF_ZOOM_SETTING_KEY = "board.settings.allowPdfZoomBelowFit.v1";
const BOARD_INTERACTION_MODE_KEY = "board.settings.interactionMode.v1";
const DEV_DEFAULTS = { zoomCueDelayMs: 500, zoomCueShrinkMs: 1500, presetHoldMs: 3000, movementThreshold: 12, zoomSensitivity: 0.008, panVectorTolerance: 12, pinchActivationDistance: 12, pinchMinimumSeparation: 40, showTouchOverlay: true };
let devSettings = { ...DEV_DEFAULTS };
let devSettingsDraft = null;
let touchSettingsTab = "single";
let developerCalibrationIntent = "pan";
let developerCalibration = null;
let developerCalibrationFrame = 0;
let developerCalibrationArmed = false;
let developerCalibrationRecords = [];
let boardInteractionMode = "single";
let multiTouchGesture = null;
let multiTouchSuppressed = new Set();
let multiTouchFrame = 0;
let devTouchTimer = null;
let zoomCueTimer = null;
const workReplacementManager = BoardState.createReplacementManager();
let activeDriveFileId = null;
let driveAuthenticated = false;
let driveDialogOpen = false;
let driveAuthStatusError = false;
let driveLoginFlow;
let driveLoginFlowPromise;

async function invokeDrive(command, args = {}) {
  const invoke = getTauriInvoke();
  if (!invoke) throw new Error("Google Drive는 데스크톱 앱에서 사용할 수 있습니다.");
  return invoke(command, args);
}
function formatDriveBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}
function setDriveElementHidden(element, hidden) {
  element.hidden = hidden;
  element.style.display = hidden ? "none" : "";
}
async function refreshDriveStatus() {
  const limit = document.getElementById("driveCacheLimit");
  try {
    const cache = await invokeDrive("drive_get_cache_status");
    limit.value = Math.round(cache.limitBytes / (1024 * 1024));
    document.getElementById("driveCacheLabel").textContent = `${formatDriveBytes(cache.usedBytes)} 사용 / ${formatDriveBytes(cache.limitBytes)} 한도`;
    return true;
  } catch (error) { if (driveAuthenticated) document.getElementById("driveStatus").textContent = error.message || "Drive 상태를 불러오지 못했습니다."; return false; }
}
function setDriveLoginView(message = "Google 계정으로 로그인하면 Drive PDF를 불러올 수 있습니다. 로그인 버튼을 누르면 기본 브라우저가 열립니다.", retryStatus = false, busy = false) {
  driveAuthenticated = false;
  driveAuthStatusError = retryStatus;
  const intro = document.querySelector("#driveDialog .work-dialog-card > p");
  intro.textContent = "Google 계정에 로그인하면 Google Drive의 PDF를 불러올 수 있습니다.";
  const connect = document.getElementById("driveConnectButton");
  setDriveElementHidden(connect, false);
  connect.textContent = retryStatus ? "연결 상태 다시 확인" : "Google로 로그인";
  connect.disabled = busy;
  setDriveElementHidden(document.getElementById("driveSignOutButton"), true);
  const list = document.getElementById("driveFileList");
  setDriveElementHidden(list, true);
  list.replaceChildren();
  document.getElementById("driveStatus").textContent = message;
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
    if (imported) { status.textContent = `${file.name} 가져옴`; driveDialogOpen = false; if (driveLoginFlow) driveLoginFlow.invalidate(); document.getElementById("driveDialog").classList.add("is-hidden"); closeDocumentPopup(); }
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
  driveDialogOpen = true;
  document.getElementById("closeDriveDialog").focus();
  if (!getTauriInvoke()) {
    setDriveLoginView("Google Drive 로그인은 Windows 설치형 앱에서 사용할 수 있습니다.");
    const connect = document.getElementById("driveConnectButton");
    connect.disabled = true;
    connect.textContent = "설치형 앱에서 사용";
    return;
  }
  setDriveLoginView("Google Drive 로그인 상태를 확인하는 중…");
  void getDriveLoginFlow().then((flow) => {
    const check = () => { if (driveDialogOpen) return flow.checkStatus(); };
    return flow.isBusy() ? flow.waitForIdle().then(check) : check();
  }).catch((error) => {
    if (driveDialogOpen) setDriveLoginView(error.message || "Google Drive 로그인 상태를 확인하지 못했습니다. 다시 확인해 주세요.", true);
  });
  void refreshDriveStatus();
}

function renderDriveFiles(files, message) {
  driveAuthenticated = true;
  driveAuthStatusError = false;
  const intro = document.querySelector("#driveDialog .work-dialog-card > p");
  intro.textContent = "로그인된 Google 계정의 PDF입니다. 파일을 선택하면 칠판에서 엽니다.";
  const connect = document.getElementById("driveConnectButton");
  setDriveElementHidden(connect, false);
  connect.textContent = "PDF 목록 새로고침";
  connect.disabled = false;
  const signOut = document.getElementById("driveSignOutButton");
  setDriveElementHidden(signOut, false);
  signOut.disabled = false;
  const list = document.getElementById("driveFileList");
  setDriveElementHidden(list, false);
  list.replaceChildren();
  for (const file of files || []) {
    const button = document.createElement("button"); button.type = "button"; button.textContent = `${file.name} · ${formatDriveBytes(file.size)}`;
    button.addEventListener("click", () => { void importDrivePdf(file); }); list.appendChild(button);
  }
  document.getElementById("driveStatus").textContent = message
    ? message
    : files.length ? `연결됨 · PDF ${files.length}개` : "연결됨 · Google Drive에 PDF가 없습니다.";
  void refreshDriveStatus();
}

function getDriveLoginFlow() {
  if (!driveLoginFlowPromise) {
    driveLoginFlowPromise = import("./drive-login-flow.mjs?v=2.0.1-drive-login-r1").then(({ createDriveLoginFlow }) => {
      driveLoginFlow = createDriveLoginFlow({ invoke: invokeDrive, onState: (state) => {
        if (!driveDialogOpen) return;
        if (state.phase === "authenticating") setDriveLoginView("Google 로그인을 기다리는 중…", false, true);
        else if (state.phase === "checking-auth") setDriveLoginView("저장된 Google 로그인 정보를 확인하는 중…", false, true);
        else if (state.phase === "loading") {
          document.getElementById("driveConnectButton").disabled = true;
          document.getElementById("driveSignOutButton").disabled = true;
          document.getElementById("driveStatus").textContent = "Google Drive PDF 목록을 불러오는 중…";
        }
        else if (state.phase === "needs-login") setDriveLoginView(state.message || "Google Drive에 로그인해 주세요.");
        else if (state.phase === "status-error") setDriveLoginView(`${state.error?.message || "로그인 상태를 확인하지 못했습니다."} 다시 시도해 주세요.`, true);
        else if (state.phase === "login-error") setDriveLoginView(`${state.error?.message || "Google에 로그인하지 못했습니다."} 다시 로그인할 수 있습니다.`);
        else if (state.phase === "connected") renderDriveFiles(state.files, state.warning ? `연결됨 · 저장된 로그인을 갱신하지 못했습니다. ${state.warning}` : null);
        else if (state.phase === "connected-error" || state.phase === "list-error") {
          if (state.phase === "connected-error") driveAuthenticated = true;
          if (driveAuthenticated) renderDriveFiles([], state.error?.message || "PDF 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
          else setDriveLoginView(state.error?.message || "PDF 목록을 불러오지 못했습니다. 다시 시도해 주세요.", true);
        }
      } });
      return driveLoginFlow;
    }).catch((error) => { driveLoginFlowPromise = undefined; throw error; });
  }
  return driveLoginFlowPromise;
}

let boardPagePendingInitialFit = null;
function currentBoardPage() { return boardPageSequence[boardPageIndex] || null; }
function fitBoardPageAfterPdfRender(page) {
  if (boardPagePendingInitialFit !== page || currentBoardPage() !== page) return false;
  boardPagePendingInitialFit = null;
  return fitCurrentBoardPage(false);
}
function finishActiveBoardInput() {
  if (multiTouchGesture) endMultiTouchGesture(null);
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
  let pageRender = null;
  if (page.kind === "pdf") {
    if (!page.view) boardPagePendingInitialFit = page;
    else if (boardPagePendingInitialFit !== page) boardPagePendingInitialFit = null;
    pageRender = renderPdfPage(page.pdfPage);
  }
  else { boardPagePendingInitialFit = null; renderBoardBackground(); }
  applyBoardCamera();
  updateBoardSequenceUI();
  updateUndoRedoUI();
  scheduleSessionAutosave();
  return pageRender;
}
function updateBoardSequenceUI() {
  updatePageIndicator(pdfPageIndicator, boardPageIndex + 1, boardPageSequence.length);
  if (toolbarPdfPageIndicator) {
    toolbarPdfPageIndicator.textContent = `${boardPageIndex + 1} / ${boardPageSequence.length}`;
    toolbarPdfPageIndicator.classList.toggle("is-empty", boardPageSequence.length <= 1);
  }
  pdfPrevPageButton.disabled = boardPageIndex <= 0 || pdfExportInProgress || sessionRestoreInProgress;
  pdfNextPageButton.disabled = boardPageIndex >= boardPageSequence.length - 1 || pdfExportInProgress || sessionRestoreInProgress;
  removeDocumentButton.disabled = !hasLoadedPdfDocument() || pdfExportInProgress || sessionRestoreInProgress;
  if (pageManager) pageManager.classList.toggle("is-hidden", !pageManagerOpen);
  renderPageList();
}
let selectedSettingsCategory = "documents";
function selectSettingsCategory(category) {
  const allowed = new Set(["documents", "screen", "remote", "about"]);
  if (!allowed.has(category)) return;
  if (selectedSettingsCategory === "screen" && category !== "screen") discardTouchSettingsDraft();
  selectedSettingsCategory = category;
  if (category === "screen") ensureTouchSettingsDraft();
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
let updaterFlow;
async function getUpdaterFlow(invoke, setStatus) {
  if (!updaterFlow) {
    updaterFlow = import("./updater-flow.mjs?v=2.0.1-recovery-r1").then(({ createUpdaterFlow }) => createUpdaterFlow({
      getStatus: () => invoke("get_updater_status"),
      checkUpdate: () => invoke("check_board_update"),
      prepareUpdate: () => invoke("prepare_board_update"),
      authorizePrepared: ({ workSaved, pdfsSaved }) => invoke("authorize_prepared_operation", { workSaved, pdfsSaved }),
      launchUpdate: () => invoke("launch_board_update"),
      checkPromotion: () => invoke("check_stable_release"),
      preparePromotion: () => invoke("prepare_board_promotion"),
      launchPromotion: () => invoke("launch_board_promotion"),
      getRecoveryStatus: () => invoke("get_recovery_status"),
      rollback: () => invoke("rollback_board_update"),
      cancelPrepared: () => invoke("cancel_prepared_operation"),
      acknowledgeRecovery: ({ restoreSucceeded, pdfRestoreSucceeded }) => invoke("acknowledge_recovery", { restoreSucceeded, pdfRestoreSucceeded }),
      openRecovery: () => invoke("open_recovery_tool"),
      finishInput: finishActiveBoardInput,
      persistSession: persistSessionState,
      confirmInstall: (message) => window.confirm(message),
      confirmRollback: (message) => window.confirm(message),
      confirmPromotion: (message) => window.confirm(message),
      setStatus,
      onRecoveryStatus: updateRecoveryUi,
    })).catch((error) => { updaterFlow = undefined; throw error; });
  }
  return updaterFlow;
}
async function runUpdaterCheck(userInitiated) {
  const invoke = getTauriInvoke();
  const status = document.getElementById("updateStatus");
  const setStatus = (message) => { status.textContent = message; };
  if (!invoke) { if (userInitiated) setStatus("데스크톱 앱에서만 업데이트를 확인할 수 있습니다."); return false; }
  try { return (await getUpdaterFlow(invoke, setStatus)).run(userInitiated); }
  catch (error) { setStatus(error?.message || "업데이트를 확인하지 못했습니다."); return false; }
}
function updateRecoveryUi(info) {
  const version = document.getElementById("appVersion");
  const previous = document.getElementById("previousVersion");
  const rollback = document.getElementById("rollbackUpdateButton");
  const openTool = document.getElementById("openRecoveryToolButton");
  const promote = document.getElementById("promoteStableButton");
  if (info?.currentVersion && version) version.textContent = `버전 ${info.currentVersion}`;
  if (previous) previous.textContent = info?.canRollback ? `직전 버전: ${info.previousVersion}` : (info?.message || "복구 가능한 직전 버전 없음");
  if (rollback) rollback.hidden = !info?.canRollback;
  if (openTool) openTool.hidden = !info?.recoveryToolAvailable;
  if (promote) promote.hidden = info?.channel !== "beta";
}
async function refreshUpdaterRecovery() {
  const invoke = getTauriInvoke();
  if (!invoke) {
    document.getElementById("updateStatus").textContent = "데스크톱 앱에서만 업데이트와 버전 복구를 사용할 수 있습니다.";
    return null;
  }
  try {
    const status = await invoke("get_updater_status");
    updateRecoveryUi(status);
    return (await getUpdaterFlow(invoke, (message) => { document.getElementById("updateStatus").textContent = message; })).refreshRecovery();
  } catch (error) {
    document.getElementById("updateStatus").textContent = error?.message || "복구 상태를 확인하지 못했습니다.";
    return null;
  }
}
async function acknowledgeUpdaterRecovery(invoke, restoreResult) {
  const status = await invoke("get_recovery_status");
  if (status?.state !== "needs-verification") return Boolean(restoreResult?.success);
  const flow = await getUpdaterFlow(invoke, (message) => { document.getElementById("updateStatus").textContent = message; });
  return flow.acknowledgeRestoredSession(restoreResult);
}
async function runUpdaterAction(name) {
  const invoke = getTauriInvoke();
  const status = document.getElementById("updateStatus");
  if (!invoke) { status.textContent = "데스크톱 앱에서만 업데이트와 버전 복구를 사용할 수 있습니다."; return false; }
  try {
    const flow = await getUpdaterFlow(invoke, (message) => { status.textContent = message; });
    if (name === "rollback") return await flow.rollback();
    if (name === "promote") return await flow.promote();
    return await flow.openRecovery();
  } catch (error) { status.textContent = error?.message || "요청을 처리하지 못했습니다."; return false; }
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
    return { id: typeof page.id === "string" ? page.id.slice(0, 80) : `${page.kind}:${index + 1}`, kind: page.kind, ...(page.kind === "pdf" ? { pdfPage, pdfWorldSize: page.pdfWorldSize && Number.isFinite(Number(page.pdfWorldSize.width)) && Number.isFinite(Number(page.pdfWorldSize.height)) ? { width: Math.max(1, Number(page.pdfWorldSize.width)), height: Math.max(1, Number(page.pdfWorldSize.height)) } : null, pdfContentBounds } : { background: normalizeHexColor(page.background) || "#ffffff", worldSize }), strokes: normalizeStrokeCollection(page.strokes), view: null };
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
    await renderBoardPage(boardPageIndex); closeDocumentPopup(); scheduleSessionAutosave();
  };
  return requestBoardWorkReplacement(apply);
}
function updateBoardViewport() {
  if (!toolbar || !boardWrapper) return;
  updatePanFitButton();
  if (toolbarLayout.placement === "floating") {
    setToolbarFloatingPosition(toolbarLayout.floatX, toolbarLayout.floatY, false);
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
function setBoardInteractionMode(mode) {
  const next = mode === "multi" ? "multi" : "single";
  if (next === boardInteractionMode) return;
  finishActiveBoardInput();
  boardInteractionMode = next;
  window.localStorage.setItem(BOARD_INTERACTION_MODE_KEY, next);
  const select = document.getElementById("boardInteractionMode");
  if (select) select.value = next;
}
function startPanOrZoomHold(event) {
  if (!panMode || !event.isPrimary || currentInputPointerId !== null) return false;
  currentInputPointerId = event.pointerId;
  activePanPointerId = event.pointerId;
  const start = { x: event.clientX, y: event.clientY, camera: { ...boardCamera }, started: false };
  start.startedAt = performance.now();
  pendingZoomHold = start;
  canvas.setPointerCapture(event.pointerId);
  window.clearTimeout(zoomCueTimer);
  zoomCueTimer = window.setTimeout(() => {
    if (pendingZoomHold === start && !start.started) showZoomHoldCue(boardWrapper, canvasPointFromClient(start.x, start.y), devSettings.zoomCueShrinkMs);
    zoomCueTimer = null;
  }, devSettings.zoomCueDelayMs);
  window.clearTimeout(devTouchTimer);
  devTouchTimer = window.setTimeout(() => {
    if (pendingZoomHold !== start || !BoardState.canActivateZoomHold(performance.now() - start.startedAt, 0, devSettings.movementThreshold, devSettings.zoomCueDelayMs + devSettings.zoomCueShrinkMs)) return;
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
  return true;
}
function endPanOrZoom(event) {
  if (activePanPointerId !== event.pointerId) return false;
  window.clearTimeout(devTouchTimer); window.clearTimeout(zoomCueTimer); devTouchTimer = null; zoomCueTimer = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  activePanPointerId = null; currentInputPointerId = null; pendingZoomHold = null; zoomGesture = null;
  canvas.classList.remove("is-zooming-in", "is-zooming-out");
  hideZoomCue();
  saveBoardPageView(); scheduleSessionAutosave();
  return true;
}
function startMultiTouchGesture(event) {
  if (!panMode || boardInteractionMode !== "multi" || event.pointerType !== "touch") return false;
  event.preventDefault();
  if (multiTouchSuppressed.has(event.pointerId)) return false;
  if (!multiTouchGesture) multiTouchGesture = { pointers: new Map(), pair: null, changed: false };
  const gesture = multiTouchGesture;
  if (gesture.pointers.size >= 2 || gesture.pointers.has(event.pointerId)) return false;
  gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  canvas.setPointerCapture(event.pointerId);
  if (gesture.pointers.size === 2) {
    const ids = [...gesture.pointers.keys()], initial = ids.map((id) => ({ ...gesture.pointers.get(id) }));
    const anchor = canvasPointFromClient((initial[0].x + initial[1].x) / 2, (initial[0].y + initial[1].y) / 2);
    gesture.pair = { ids, initial, initialCentroid: { x: anchor.x, y: anchor.y }, anchor, initialSpan: Math.hypot(initial[0].x - initial[1].x, initial[0].y - initial[1].y), startCamera: { ...boardCamera } };
  }
  return true;
}
function queueMultiTouchFrame() {
  if (!multiTouchGesture || !multiTouchGesture.pair || multiTouchFrame) return;
  multiTouchFrame = window.requestAnimationFrame(flushMultiTouchFrame);
}
function flushMultiTouchFrame() {
  multiTouchFrame = 0;
  const gesture = multiTouchGesture;
  if (!gesture || !gesture.pair || gesture.pointers.size !== 2) return;
  const pair = gesture.pair, [first, second] = pair.ids.map((id) => gesture.pointers.get(id));
  const rect = boardWrapper.getBoundingClientRect();
  const metrics = BoardState.measureTouchPair(pair.initial, [first, second], "auto", devSettings);
  const currentCentroid = { x: metrics.midpoint.x - rect.left, y: metrics.midpoint.y - rect.top };
  const span = metrics.currentSeparation;
  const phase = metrics.classification === "pan" || metrics.classification === "zoom-in" || metrics.classification === "zoom-out" ? metrics.classification : null;
  if (phase !== gesture.phase) {
    if (phase && !gesture.hasPhase) { gesture.phaseCamera = { ...pair.startCamera }; gesture.phaseCentroid = pair.initialCentroid; gesture.phaseSpan = pair.initialSpan; gesture.hasPhase = true; }
    else { gesture.phaseCamera = { ...boardCamera }; gesture.phaseCentroid = currentCentroid; gesture.phaseSpan = span; }
    gesture.phase = phase;
  }
  if (!phase) return;
  if (phase === "pan") boardCamera = { ...gesture.phaseCamera, x: gesture.phaseCamera.x + currentCentroid.x - gesture.phaseCentroid.x, y: gesture.phaseCamera.y + currentCentroid.y - gesture.phaseCentroid.y };
  else boardCamera = zoomBoardCameraAt(gesture.phaseCamera, pair.anchor, span / Math.max(1, gesture.phaseSpan));
  if (boardCamera.x !== gesture.phaseCamera.x || boardCamera.y !== gesture.phaseCamera.y || boardCamera.scale !== gesture.phaseCamera.scale) {
    gesture.changed = true; applyBoardCamera();
  }
}
function moveMultiTouchGesture(event) {
  if (boardInteractionMode !== "multi" || !multiTouchGesture || !multiTouchGesture.pointers.has(event.pointerId)) return false;
  event.preventDefault(); multiTouchGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); queueMultiTouchFrame(); return true;
}
function endMultiTouchGesture(releasedPointerId, cancelled = false) {
  const gesture = multiTouchGesture;
  if (!gesture) return false;
  if (multiTouchFrame) window.cancelAnimationFrame(multiTouchFrame);
  multiTouchFrame = 0;
  if (!cancelled) flushMultiTouchFrame();
  multiTouchGesture = null;
  for (const id of gesture.pointers.keys()) {
    multiTouchSuppressed.add(id);
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  if (releasedPointerId !== null) multiTouchSuppressed.delete(releasedPointerId);
  if (gesture.changed) { saveBoardPageView(); scheduleSessionAutosave(); }
  return true;
}
function endSuppressedMultiTouchPointer(pointerId) { multiTouchSuppressed.delete(pointerId); }
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
function ensureTouchSettingsDraft() {
  if (devSettingsDraft) return;
  touchSettingsTab = boardInteractionMode;
  developerCalibrationIntent = "pan";
  developerCalibrationRecords = [];
  devSettingsDraft = { ...devSettings };
  renderTouchSettings();
}
function renderTouchSettings() {
  const panel = document.getElementById("touchSettingsContent");
  if (!panel) return;
  cancelDeveloperTrial();
  cancelDeveloperCalibration();
  const draft = devSettingsDraft || { ...devSettings };
  const totalMs = draft.zoomCueDelayMs + draft.zoomCueShrinkMs;
  const thresholds = BoardState.normalizeTouchCalibration(draft);
  panel.innerHTML = `<div class="dev-settings-body"><nav class="dev-tabs" role="tablist" aria-label="터치 조작 방식"><button type="button" role="tab" id="devSingleTab" aria-controls="devSinglePanel" data-dev-tab="single">한 손가락</button><button type="button" role="tab" id="devMultiTab" aria-controls="devMultiPanel" data-dev-tab="multi">두 손가락</button></nav><p class="dev-calibration-note">펜 그리기는 그대로 유지되며, 패닝에서 선택한 탐색 방식 하나만 사용합니다. 탭 변경과 시험은 초안에만 반영되고 저장할 때 적용됩니다.</p><section id="devSinglePanel" class="dev-tab-panel" role="tabpanel" aria-labelledby="devSingleTab" data-dev-tab-panel="single"><div class="dev-timing"><h3>한 손가락: 패닝·줌</h3><p class="dev-definition">한 손가락으로 끌면 화면을 패닝합니다. 기본값은 500ms 대기 후 1500ms 동안 원이 줄어들며, 총 2000ms가 지나면 줌이 시작됩니다. 그 뒤 세로로 위로 끌면 화면 확대, 아래로 끌면 화면 축소입니다.</p><label>원 표시 지연 <input data-key="zoomCueDelayMs" type="range" min="0" max="1500" step="100" value="${draft.zoomCueDelayMs}"><output>${formatTouchSettingValue("zoomCueDelayMs", draft.zoomCueDelayMs)}</output></label><label>원 축소 시간 <input data-key="zoomCueShrinkMs" type="range" min="500" max="5000" step="100" value="${draft.zoomCueShrinkMs}"><output>${formatTouchSettingValue("zoomCueShrinkMs", draft.zoomCueShrinkMs)}</output></label><p class="dev-total">줌 활성화까지 <output data-total>${totalMs}ms</output></p><p class="dev-guidance">시험 영역을 누른 채 기다린 뒤, 위·아래로 움직여도 실제 칠판·PDF·카메라는 변하지 않습니다.</p><div class="dev-test-area" data-dev-test tabindex="0" aria-label="한 손가락 패닝과 줌 시험 영역">한 손가락 시험 영역</div></div><div class="dev-other"><label><input data-dev-overlay type="checkbox" ${draft.showTouchOverlay ? "checked" : ""}> 터치 위치·허용 반경·유지 시간 표시</label><label>프리셋 편집 유지 시간 <input data-key="presetHoldMs" type="range" min="1000" max="5000" step="100" value="${draft.presetHoldMs}"><output>${formatTouchSettingValue("presetHoldMs", draft.presetHoldMs)}</output></label><label>움직임 허용 <input data-key="movementThreshold" type="range" min="3" max="40" step="1" value="${draft.movementThreshold}"><output>${formatTouchSettingValue("movementThreshold", draft.movementThreshold)}</output></label><label>줌 민감도 <input data-key="zoomSensitivity" type="range" min="0.002" max="0.02" step="0.001" value="${draft.zoomSensitivity}"><output>${formatTouchSettingValue("zoomSensitivity", draft.zoomSensitivity)}</output></label></div></section><section id="devMultiPanel" class="dev-tab-panel" role="tabpanel" aria-labelledby="devMultiTab" data-dev-tab-panel="multi" hidden><section class="dev-calibration"><div class="dev-calibration-workspace" data-calibration-workspace><div class="dev-calibration-action-strip"><div class="dev-calibration-heading"><h3>두 손가락: 패닝·핀치 줌</h3></div><label class="dev-calibration-intent">측정할 동작<select data-calibration-intent><option value="pan" ${developerCalibrationIntent === "pan" ? "selected" : ""}>같은 방향으로 이동 · 패닝</option><option value="zoom-in" ${developerCalibrationIntent === "zoom-in" ? "selected" : ""}>모으기 · 화면 축소</option><option value="zoom-out" ${developerCalibrationIntent === "zoom-out" ? "selected" : ""}>벌리기 · 화면 확대</option></select></label><p class="dev-calibration-hint" data-calibration-hint></p><div class="dev-calibration-actions"><button type="button" data-calibration-start>측정 시작</button><button type="button" data-calibration-cancel disabled>측정 취소</button></div><p class="dev-calibration-status" data-calibration-status role="status" aria-live="polite">측정을 시작하고 시험 영역에서 두 손가락을 움직이세요.</p></div><div class="dev-calibration-main"><div class="dev-calibration-area" data-calibration-area tabindex="0" aria-label="두 손가락 보정 시험 영역"><span class="dev-calibration-anchor" data-calibration-anchor hidden>기준점</span><span class="dev-calibration-point" data-calibration-point="0" hidden>1</span><span class="dev-calibration-point" data-calibration-point="1" hidden>2</span><span class="dev-calibration-empty">두 손가락 시험 영역</span></div><dl class="dev-calibration-readout"><dt>손가락 1 / 2</dt><dd data-calibration-positions>—</dd><dt>고정 기준점</dt><dd data-calibration-anchor-value>—</dd><dt>이동 벡터 차이</dt><dd data-calibration-vector>—</dd><dt>처음 간격</dt><dd data-calibration-initial>—</dd><dt>현재 간격 / 변화</dt><dd data-calibration-span>—</dd><dt>분류</dt><dd data-calibration-classification>대기</dd></dl></div><div class="dev-calibration-secondary"><p class="dev-calibration-note">두 손가락을 같은 방향으로 움직이면 패닝, 벌리면 화면 확대(줌 IN), 모으면 화면 축소(줌 OUT)입니다. 처음 두 손가락의 중심은 고정 기준점으로 사용됩니다. 기본값은 이동 차이 12px, 줌 시작 12px, 최소 간격 40px이며 측정 기록은 최근 10개만 남습니다.</p><div class="dev-calibration-fields">${[["panVectorTolerance","이동 차이 허용","1","200"],["pinchActivationDistance","줌 거리 변화 시작","1","200"],["pinchMinimumSeparation","최소 손가락 간격","8","500"]].map(([key,label,min,max]) => `<label>${label}<input data-calibration-key="${key}" type="number" min="${min}" max="${max}" step="1" value="${thresholds[key]}"><input data-calibration-range="${key}" type="range" aria-label="${label} 슬라이더" min="${min}" max="${max}" step="1" value="${thresholds[key]}"><output data-calibration-output="${key}">${thresholds[key]}px</output></label>`).join("")}</div><section class="dev-calibration-history"><div class="dev-calibration-history-header"><h4>최근 측정 <span data-calibration-count>(0/10)</span></h4><div class="dev-calibration-actions"><button type="button" data-calibration-reset>기록 초기화</button></div></div><ol class="dev-calibration-records" data-calibration-records></ol></section></div></section></section></div><footer><button type="button" data-dev-default>기본값</button><button type="button" data-dev-cancel>취소</button><button type="button" data-dev-save>저장</button></footer><p class="touch-settings-status" data-touch-status role="status" aria-live="polite">변경 사항은 저장할 때 적용됩니다.</p>`;
  const tab = touchSettingsTab === "multi" ? "multi" : "single";
  panel.querySelectorAll("[data-dev-tab]").forEach((button) => { const selected = button.dataset.devTab === tab; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
  panel.querySelectorAll("[data-dev-tab-panel]").forEach((section) => { section.hidden = section.dataset.devTabPanel !== tab; });
  panel.querySelectorAll("input[data-key]").forEach((input) => input.addEventListener("input", () => {
    draft[input.dataset.key] = Number(input.value);
    input.nextElementSibling.value = formatTouchSettingValue(input.dataset.key, input.value);
    panel.querySelector("[data-total]").value = `${draft.zoomCueDelayMs + draft.zoomCueShrinkMs}ms`;
    cancelDeveloperTrial();
  }));
  panel.querySelector("[data-dev-overlay]").addEventListener("change", (event) => {
    draft.showTouchOverlay = event.target.checked;
    syncDeveloperTrialFeedback(developerTrial);
  });
  const syncCalibrationFields = (key, raw) => {
    const field = panel.querySelector(`[data-calibration-key="${key}"]`), range = panel.querySelector(`[data-calibration-range="${key}"]`), output = panel.querySelector(`[data-calibration-output="${key}"]`);
    const bounds = { panVectorTolerance: [1, 200], pinchActivationDistance: [1, 200], pinchMinimumSeparation: [8, 500] }[key];
    if (!bounds || raw === "" || !Number.isFinite(Number(raw))) return;
    const value = Math.max(bounds[0], Math.min(bounds[1], Math.round(Number(raw))));
    draft[key] = value;
    field.value = String(value); range.value = String(value); output.value = `${value}px`;
  };
  panel.querySelectorAll("[data-calibration-key]").forEach((input) => {
    input.addEventListener("input", () => { syncCalibrationFields(input.dataset.calibrationKey, input.value); cancelDeveloperCalibration(); });
    input.addEventListener("change", () => { syncCalibrationFields(input.dataset.calibrationKey, input.value); });
  });
  panel.querySelectorAll("[data-calibration-range]").forEach((input) => input.addEventListener("input", () => { syncCalibrationFields(input.dataset.calibrationRange, input.value); cancelDeveloperCalibration(); }));
  panel.querySelector("[data-dev-default]").onclick = () => { cancelDeveloperTrial(); devSettingsDraft = { ...DEV_DEFAULTS }; renderTouchSettings(); panel.querySelector("[data-dev-default]").focus(); };
  panel.querySelector("[data-dev-cancel]").onclick = discardDeveloperSettings;
  panel.querySelector("[data-dev-save]").onclick = saveDeveloperSettings;
  panel.querySelectorAll("[data-dev-tab]").forEach((button) => button.addEventListener("click", () => {
    cancelDeveloperTrial(); cancelDeveloperCalibration(); touchSettingsTab = button.dataset.devTab; renderTouchSettings(); panel.querySelector(`[data-dev-tab="${touchSettingsTab}"]`).focus();
  }));
  panel.querySelectorAll("[role='tab']").forEach((button) => button.addEventListener("keydown", (event) => {
    const tabs = [...panel.querySelectorAll("[role='tab']")];
    const index = tabs.indexOf(button);
    const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
    if (next) { event.preventDefault(); next.click(); }
  }));
  initDeveloperTrial(panel.querySelector("[data-dev-test]"), draft);
  initDeveloperCalibration(panel, draft);
}
function formatTouchSettingValue(key, value) {
  const unit = key === "zoomSensitivity" ? "" : key === "movementThreshold" ? "px" : "ms";
  const numeric = Number(value);
  const display = key === "zoomSensitivity" && Number.isFinite(numeric) ? numeric.toFixed(3) : String(value);
  return `${display}${unit}`;
}
function saveDeveloperSettings() {
  cancelDeveloperTrial();
  cancelDeveloperCalibration();
  if (typeof finishActiveBoardInput === "function") finishActiveBoardInput();
  const saved = normalizeDevSettings(devSettingsDraft || devSettings);
  devSettings = saved;
  window.localStorage.setItem(DEV_SETTINGS_KEY, JSON.stringify(devSettings));
  setBoardInteractionMode(touchSettingsTab);
  if (devSettingsDraft) Object.assign(devSettingsDraft, saved);
  else devSettingsDraft = { ...saved };
  const status = document.querySelector("[data-touch-status]");
  if (status) status.textContent = "터치 조작 설정을 저장했습니다.";
}
function discardDeveloperSettings() {
  if (typeof finishActiveBoardInput === "function") finishActiveBoardInput();
  cancelDeveloperTrial();
  cancelDeveloperCalibration();
  developerCalibrationRecords = [];
  touchSettingsTab = boardInteractionMode;
  devSettingsDraft = { ...devSettings };
  renderTouchSettings();
  const status = document.querySelector("[data-touch-status]");
  if (status) status.textContent = "변경 사항을 취소했습니다. 현재 터치 방식은 유지됩니다.";
}
function discardTouchSettingsDraft() {
  if (!devSettingsDraft) return;
  if (typeof finishActiveBoardInput === "function") finishActiveBoardInput();
  cancelDeveloperTrial();
  cancelDeveloperCalibration();
  developerCalibrationRecords = [];
  devSettingsDraft = null;
  touchSettingsTab = boardInteractionMode;
}
let developerTrial = null;
function getDeveloperTouchFeedback(area) {
  if (!area || typeof area.querySelector !== "function") return null;
  let feedback = area.querySelector("[data-dev-touch-feedback]");
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.className = "dev-touch-feedback";
    feedback.setAttribute("data-dev-touch-feedback", "");
    feedback.setAttribute("aria-hidden", "true");
    feedback.innerHTML = '<span class="dev-touch-feedback-point"></span><span class="dev-touch-feedback-readout"></span>';
    area.append(feedback);
  }
  return feedback;
}
function renderDeveloperTouchFeedback(trial) {
  if (!trial || !trial.settings.showTouchOverlay) return;
  const feedback = getDeveloperTouchFeedback(trial.area);
  if (!feedback) return;
  const point = trial.point || { x: trial.x, y: trial.y };
  const radius = trial.settings.movementThreshold;
  const elapsed = Math.max(0, Math.round(performance.now() - trial.startedAt));
  const currentPoint = feedback.querySelector(".dev-touch-feedback-point"), readout = feedback.querySelector(".dev-touch-feedback-readout");
  feedback.style.left = `${trial.x}px`; feedback.style.top = `${trial.y}px`;
  feedback.style.width = `${radius * 2}px`; feedback.style.height = `${radius * 2}px`;
  currentPoint.style.left = `${radius + point.x - trial.x}px`; currentPoint.style.top = `${radius + point.y - trial.y}px`;
  readout.textContent = `허용 반경 ${radius}px · 유지 ${elapsed}ms`;
  feedback.hidden = false;
  trial.feedback = feedback;
}
function syncDeveloperTrialFeedback(trial) {
  if (!trial) return;
  if (!trial.settings.showTouchOverlay) {
    window.clearInterval(trial.feedbackTimer); trial.feedbackTimer = null;
    if (trial.feedback) { trial.feedback.remove(); trial.feedback = null; }
    return;
  }
  renderDeveloperTouchFeedback(trial);
  if (!trial.feedbackTimer) trial.feedbackTimer = window.setInterval(() => { if (developerTrial === trial) renderDeveloperTouchFeedback(trial); }, 50);
}
function initDeveloperTrial(area, settings) {
  const cancel = (event) => { if (!developerTrial || (event && event.pointerId !== developerTrial.id)) return; cancelDeveloperTrial(area); };
  area.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || developerTrial) return;
    event.preventDefault();
    const rect = area.getBoundingClientRect(), trial = { id: event.pointerId, area, x: event.clientX - rect.left, y: event.clientY - rect.top, point: { x: event.clientX - rect.left, y: event.clientY - rect.top }, startedAt: performance.now(), lastY: event.clientY, directionY: event.clientY, direction: "in", settings };
    developerTrial = trial;
    area.setPointerCapture(event.pointerId);
    syncDeveloperTrialFeedback(trial);
    trial.cueTimer = window.setTimeout(() => { if (developerTrial === trial) showZoomHoldCue(area, { x: trial.x, y: trial.y }, settings.zoomCueShrinkMs, "devZoomCue"); }, settings.zoomCueDelayMs);
    trial.zoomTimer = window.setTimeout(() => { if (developerTrial === trial) { trial.activated = true; showZoomCue(area, { x: trial.x, y: trial.y }, undefined, 0, "devZoomCue"); } }, settings.zoomCueDelayMs + settings.zoomCueShrinkMs);
  });
  area.addEventListener("pointermove", (event) => {
    if (!developerTrial || event.pointerId !== developerTrial.id) return;
    const trial = developerTrial, rect = area.getBoundingClientRect();
    trial.point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    renderDeveloperTouchFeedback(trial);
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
  if (trial) { window.clearTimeout(trial.cueTimer); window.clearTimeout(trial.zoomTimer); window.clearTimeout(trial.idleTimer); window.clearInterval(trial.feedbackTimer); if (trial.feedback) { trial.feedback.remove(); trial.feedback = null; } const trialArea = trial.area || area; if (trialArea && trialArea.hasPointerCapture(trial.id)) trialArea.releasePointerCapture(trial.id); }
  hideZoomCue("devZoomCue");
}
function initDeveloperCalibration(panel, settings) {
  const area = panel.querySelector("[data-calibration-area]"), status = panel.querySelector("[data-calibration-status]"), list = panel.querySelector("[data-calibration-records]");
  const intent = panel.querySelector("[data-calibration-intent]"), hint = panel.querySelector("[data-calibration-hint]");
  const workspace = panel.querySelector("[data-calibration-workspace]"), startButton = panel.querySelector("[data-calibration-start]"), cancelButton = panel.querySelector("[data-calibration-cancel]");
  const syncActions = () => { cancelButton.disabled = !(developerCalibrationArmed || developerCalibration); };
  const updateHint = () => { hint.textContent = (intent.value === "pan" ? "같은 방향으로 자연스럽게 이동해 이동 차이를 측정하세요." : "줌이 시작되길 원하는 거리만큼만 손가락을 움직인 뒤 떼세요. 기록의 최대 거리 변화가 줌 시작 기준값으로 적용됩니다.") + " 손가락을 떼면 결과가 기록됩니다."; };
  updateHint();
  const readout = (selector, value) => { panel.querySelector(selector).textContent = value; };
  const renderMetrics = (metrics) => {
    const point = (value) => `${Math.round(value.x)}, ${Math.round(value.y)}px`;
    readout("[data-calibration-positions]", metrics ? metrics.positions.map(point).join(" · ") : "—");
    readout("[data-calibration-anchor-value]", metrics ? point(metrics.anchor) : "—");
    readout("[data-calibration-vector]", metrics ? `${metrics.vectorDifference.toFixed(1)}px (최대 ${metrics.maxVectorDifference.toFixed(1)}px)` : "—");
    readout("[data-calibration-initial]", metrics ? `${metrics.initialSeparation.toFixed(1)}px` : "—");
    readout("[data-calibration-span]", metrics ? `${metrics.currentSeparation.toFixed(1)}px / ${metrics.spanDelta >= 0 ? "+" : ""}${metrics.spanDelta.toFixed(1)}px (최대 변화 ${metrics.maxAbsoluteSpanChange.toFixed(1)}px)` : "—");
    readout("[data-calibration-classification]", metrics ? metrics.classification : "대기");
    [0, 1].forEach((index) => { const element = panel.querySelector(`[data-calibration-point="${index}"]`); element.hidden = !metrics; if (metrics) { element.style.left = `${metrics.positions[index].x}px`; element.style.top = `${metrics.positions[index].y}px`; } });
    const anchor = panel.querySelector("[data-calibration-anchor]"); anchor.hidden = !metrics;
    if (metrics) { anchor.style.left = `${metrics.anchor.x}px`; anchor.style.top = `${metrics.anchor.y}px`; }
  };
  const renderRecords = () => {
    list.replaceChildren(); readout("[data-calibration-count]", `(${developerCalibrationRecords.length}/10)`);
    developerCalibrationRecords.forEach((record) => {
      const item = document.createElement("li"), text = document.createElement("p"), apply = document.createElement("button");
      const proposed = BoardState.applyTouchCalibrationRecord(settings, record);
      const appliedValues = record.intent === "pan" ? `이동 차이 허용 ${proposed.panVectorTolerance}px` : `줌 시작 ${proposed.pinchActivationDistance}px · 최소 간격 ${proposed.pinchMinimumSeparation}px`;
      text.textContent = `${record.label} · ${record.elapsedMs}ms · 이동 ${record.maxVectorDifference.toFixed(1)}px · 줌 변화 ${record.maxAbsoluteSpanChange.toFixed(1)}px · 처음 간격 ${record.initialSeparation.toFixed(1)}px · 적용값 ${appliedValues}`;
      apply.type = "button"; apply.textContent = "이 결과를 초안에 적용";
      apply.addEventListener("click", () => {
        cancelDeveloperCalibration(); syncActions();
        Object.assign(settings, BoardState.applyTouchCalibrationRecord(settings, record));
        for (const [key, value] of Object.entries(BoardState.normalizeTouchCalibration(settings))) {
          settings[key] = value;
          const input = panel.querySelector(`[data-calibration-key="${key}"]`), range = panel.querySelector(`[data-calibration-range="${key}"]`), output = panel.querySelector(`[data-calibration-output="${key}"]`);
          input.value = range.value = String(value); output.value = `${value}px`;
        }
        status.textContent = "측정값을 임시 설정에 적용했습니다. 저장을 눌러야 유지됩니다.";
      });
      item.append(text, apply); list.append(item);
    });
  };
  const release = (calibration) => {
    const ids = calibration.tracker.getActivePointerIds();
    ids.forEach((id) => { if (area.hasPointerCapture(id)) area.releasePointerCapture(id); });
  };
  const finish = (calibration, summary) => {
    if (developerCalibration !== calibration) return;
    if (developerCalibrationFrame) window.cancelAnimationFrame(developerCalibrationFrame);
    developerCalibrationFrame = 0;
    developerCalibration = null; developerCalibrationArmed = false; release(calibration); syncActions();
    if (!summary) calibration.tracker.cancel();
    if (summary) {
      const labels = { pan: "같은 방향 이동 · 패닝", "zoom-in": "모으기 · 화면 축소", "zoom-out": "벌리기 · 화면 확대" };
      developerCalibrationRecords = BoardState.appendTouchCalibrationRecord(developerCalibrationRecords, { intent: summary.intent, label: labels[summary.intent], elapsedMs: Math.round(summary.elapsedMs), maxVectorDifference: summary.maxVectorDifference, maxAbsoluteSpanChange: summary.maxAbsoluteSpanChange, initialSeparation: summary.initialSeparation }); renderRecords();
      status.textContent = "결과를 임시 목록에 추가했습니다. 선택한 측정값을 초안에 적용할 수 있습니다.";
    } else status.textContent = "측정이 취소되어 결과를 기록하지 않았습니다.";
  };
  startButton.addEventListener("click", () => {
    cancelDeveloperCalibration(); renderMetrics(null);
    developerCalibrationArmed = true; syncActions(); status.textContent = "측정 준비 완료. 시험 영역을 두 손가락으로 누르세요.";
    workspace.scrollIntoView({ block: "start" }); area.focus({ preventScroll: true });
  });
  cancelButton.addEventListener("click", () => { cancelDeveloperCalibration(); renderMetrics(null); status.textContent = "측정이 취소되어 결과를 기록하지 않았습니다."; syncActions(); });
  panel.querySelector("[data-calibration-reset]").addEventListener("click", () => { cancelDeveloperCalibration(); developerCalibrationRecords = []; renderRecords(); renderMetrics(null); status.textContent = "임시 측정 기록을 비웠습니다."; syncActions(); });
  intent.addEventListener("change", (event) => { developerCalibrationIntent = event.target.value; cancelDeveloperCalibration(); updateHint(); syncActions(); });
  area.addEventListener("pointerdown", (event) => {
    if (!developerCalibrationArmed || event.pointerType !== "touch") return;
    event.preventDefault(); const rect = area.getBoundingClientRect();
    const calibration = developerCalibration || { tracker: BoardState.createTouchCalibrationTracker(panel.querySelector("[data-calibration-intent]").value, BoardState.normalizeTouchCalibration(settings), performance.now()) };
    if (!calibration.tracker.pointerDown(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top })) return;
    calibration.area = area; developerCalibration = calibration; area.setPointerCapture(event.pointerId);
    status.textContent = calibration.tracker.getActivePointerIds().length === 2 ? "두 손가락을 추적하고 있습니다." : "첫 손가락을 받았습니다. 두 번째 손가락을 누르세요.";
    renderMetrics(calibration.tracker.getMetrics());
  });
  area.addEventListener("pointermove", (event) => {
    if (!developerCalibration || developerCalibration.area !== area) return;
    const rect = area.getBoundingClientRect(), metrics = developerCalibration.tracker.pointerMove(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    if (!metrics || developerCalibrationFrame) return;
    developerCalibrationFrame = window.requestAnimationFrame(() => {
      developerCalibrationFrame = 0;
      if (developerCalibration && developerCalibration.area === area) renderMetrics(developerCalibration.tracker.sample());
    });
  });
  area.addEventListener("pointerup", (event) => {
    if (!developerCalibration || developerCalibration.area !== area || !developerCalibration.tracker.getActivePointerIds().includes(event.pointerId)) return;
    const rect = area.getBoundingClientRect();
    developerCalibration.tracker.pointerMove(event.pointerId, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    const summary = developerCalibration.tracker.pointerUp(event.pointerId, performance.now()); finish(developerCalibration, summary);
    if (!summary) status.textContent = "두 손가락이 함께 닿지 않아 결과를 만들지 않았습니다.";
  });
  const cancel = (event) => { if (developerCalibration && developerCalibration.tracker.getActivePointerIds().includes(event.pointerId)) finish(developerCalibration, null); };
  area.addEventListener("pointercancel", cancel); area.addEventListener("lostpointercapture", cancel);
  renderRecords(); syncActions();
}
function cancelDeveloperCalibration() {
  developerCalibrationArmed = false;
  const cancelButton = document.querySelector("[data-calibration-cancel]");
  if (cancelButton) cancelButton.disabled = true;
  if (developerCalibrationFrame) window.cancelAnimationFrame(developerCalibrationFrame);
  developerCalibrationFrame = 0;
  if (!developerCalibration) return;
  const calibration = developerCalibration, ids = calibration.tracker.getActivePointerIds();
  developerCalibration = null; calibration.tracker.cancel();
  ids.forEach((id) => { if (calibration.area.hasPointerCapture(id)) calibration.area.releasePointerCapture(id); });
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
    ...BoardState.normalizeTouchCalibration(value),
    showTouchOverlay: typeof value.showTouchOverlay === "boolean" ? value.showTouchOverlay : DEV_DEFAULTS.showTouchOverlay,
  };
}
function loadDevSettings() { try { return normalizeDevSettings(JSON.parse(window.localStorage.getItem(DEV_SETTINGS_KEY) || "{}")); } catch { return { ...DEV_DEFAULTS }; } }
function initUpdaterWiring() {
  if (!document.getElementById("appVersion")) return;
  document.getElementById("checkUpdateButton").addEventListener("click", () => { void runUpdaterCheck(true); });
  document.getElementById("rollbackUpdateButton").addEventListener("click", () => { void runUpdaterAction("rollback"); });
  document.getElementById("promoteStableButton").addEventListener("click", () => { void runUpdaterAction("promote"); });
  document.getElementById("openRecoveryToolButton").addEventListener("click", () => { void runUpdaterAction("openRecovery"); });
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
  document.querySelectorAll("[data-settings-category]").forEach((button) => button.addEventListener("click", () => { selectSettingsCategory(button.dataset.settingsCategory); if (button.dataset.settingsCategory === "about") void refreshUpdaterRecovery(); }));
  try { boardInteractionMode = window.localStorage.getItem(BOARD_INTERACTION_MODE_KEY) === "multi" ? "multi" : "single"; } catch { boardInteractionMode = "single"; }
  canvas.addEventListener("pointerdown", (event) => { if (panMode) { if (boardInteractionMode === "multi") startMultiTouchGesture(event); else { event.preventDefault(); startPanOrZoomHold(event); } } });
  canvas.addEventListener("pointermove", (event) => { if (boardInteractionMode === "multi") moveMultiTouchGesture(event); else if (panMode && activePanPointerId === event.pointerId) { event.preventDefault(); continuePanOrZoom(event); } });
  canvas.addEventListener("pointerup", (event) => {
    if (multiTouchGesture && multiTouchGesture.pointers.has(event.pointerId)) { multiTouchGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); endMultiTouchGesture(event.pointerId); }
    else endSuppressedMultiTouchPointer(event.pointerId);
    if (boardInteractionMode === "single" && panMode) endPanOrZoom(event);
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (multiTouchGesture && multiTouchGesture.pointers.has(event.pointerId)) endMultiTouchGesture(event.pointerId, true);
    else endSuppressedMultiTouchPointer(event.pointerId);
    if (boardInteractionMode === "single" && panMode) endPanOrZoom(event);
  });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (multiTouchGesture && multiTouchGesture.pointers.has(event.pointerId)) endMultiTouchGesture(null, true);
  });
  window.addEventListener("pointerup", (event) => endSuppressedMultiTouchPointer(event.pointerId));
  window.addEventListener("pointercancel", (event) => endSuppressedMultiTouchPointer(event.pointerId));
  window.addEventListener("resize", updateBoardViewport);
  const observer = new ResizeObserver(updateBoardViewport); observer.observe(toolbar);
  initUpdaterWiring();
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
  const driveCacheLimit = document.getElementById("driveCacheLimit");
  const driveCacheDetails = document.createElement("details");
  driveCacheDetails.className = "drive-cache-details";
  const driveCacheSummary = document.createElement("summary");
  driveCacheSummary.textContent = "PDF 캐시 설정";
  driveCacheLimit.closest("label").before(driveCacheDetails);
  driveCacheDetails.append(driveCacheSummary, driveCacheLimit.closest("label"));
  document.getElementById("driveSettingsButton").addEventListener("click", openDriveDialog);
  document.getElementById("closeDriveDialog").addEventListener("click", () => {
    driveDialogOpen = false;
    if (driveLoginFlow) driveLoginFlow.invalidate();
    document.getElementById("driveDialog").classList.add("is-hidden");
    openDocumentPopupButton.focus();
  });
  document.getElementById("driveConnectButton").addEventListener("click", async () => {
    try {
      const flow = await getDriveLoginFlow();
      if (driveAuthenticated) await flow.refresh();
      else if (driveAuthStatusError) await flow.checkStatus();
      else await flow.signIn();
    } catch (error) { if (driveDialogOpen) setDriveLoginView(error.message || "Google Drive에 연결하지 못했습니다."); }
  });
  document.getElementById("driveSignOutButton").addEventListener("click", async () => {
    if (driveLoginFlow) driveLoginFlow.invalidate();
    try { await invokeDrive("drive_sign_out"); setDriveLoginView("Google Drive 연결을 해제했습니다."); }
    catch (error) { if (driveDialogOpen) document.getElementById("driveStatus").textContent = error.message || "연결을 해제하지 못했습니다."; }
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
  if (!hasLoadedPdfDocument() && boardPageSequence.length === 1 && boardPageSequence[0].kind === "blank" && !(boardPageSequence[0].strokes || []).length && boardStrokeSnapshot.length) boardPageSequence[0].strokes = cloneStrokeCollection(boardStrokeSnapshot);
  window.requestBoardWorkReplacement = requestBoardWorkReplacement;
  window.loadBoardWorkFile = openBoardWorkFile;
  const restorePromise = window.boardRestorePromise || Promise.resolve();
  void restorePromise.then((restoreResult) => {
    boardPageSequence.forEach((page) => { if (page.kind === "pdf" && !page.pdfWorldSize) page.pdfWorldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; if (page.kind === "blank" && !page.worldSize) page.worldSize = { width: backgroundCanvas.width, height: backgroundCanvas.height }; });
    renderBoardPage(boardPageIndex);
    updateBoardViewport();
    const invoke = getTauriInvoke();
    if (!invoke) {
      if (!restoreResult?.success) return false;
      setSessionPersistenceHeld(false);
      return runUpdaterCheck(false);
    }
    return acknowledgeUpdaterRecovery(invoke, restoreResult)
      .then((acknowledged) => {
        if (!acknowledged) return false;
        setSessionPersistenceHeld(false);
        return runUpdaterCheck(false);
      })
      .catch((error) => { document.getElementById("updateStatus").textContent = error?.message || "복구 완료를 확인하지 못해 업데이트 확인을 보류했습니다."; return false; });
  });
  applyBoardCamera(); updateBoardViewport(); renderBoardPage(boardPageIndex);
}
initBoard201Ui();
