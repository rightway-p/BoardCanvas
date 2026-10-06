(() => {
  "use strict";

  const COMPLETE_KEY = "board.setup-wizard.completed.v1";
  const find = (root, selectors) => selectors.map((selector) => root.querySelector(selector)).find(Boolean) || null;
  const safeGet = (key) => { try { return window.localStorage.getItem(key); } catch { return null; } };
  const safeSet = (key, value) => { try { window.localStorage.setItem(key, value); } catch {} };
  const isComplete = () => safeGet(COMPLETE_KEY) === "true";
  const normalizeMode = (value) => value === "multi" || value === "two" ? "multi" : "single";
  const normalizeColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : "#111111";

  function createController(root) {
    const panel = find(root, ["#setupWizardPanel", "#wizardPanel", "[data-wizard-panel]"]);
    const next = find(root, ["#setupWizardNext", "#wizardNext", "[data-wizard-next]"]);
    const back = find(root, ["#setupWizardBack", "#wizardBack", "[data-wizard-back]"]);
    const skip = find(root, ["#setupWizardSkip", "#wizardSkip", "[data-wizard-skip]"]);
    const steps = [...root.querySelectorAll("[data-wizard-step], .step")];
    const labels = ["입력 방식", "펜·팔레트", "Google Drive", "동작 시험", "완료"];
    let step = 1;
    let mode = normalizeMode(safeGet("board.settings.interactionMode.v1"));
    let penDraft = readPenDraft();
    let paletteDraft = readPalette();
    let driveReturn = false;
    let trialReturn = false;
    let settingsReturn = false;
    let pickerReturn = false;
    let externalBaseline = null;
    let bound = false;
    let previousFocus = null;
    let inertSiblings = [];

    function readPenDraft() {
      const color = typeof penColorInput !== "undefined" ? normalizeColor(penColorInput.value) : "#111111";
      const width = typeof lineWidthInput !== "undefined" ? Number(lineWidthInput.value) || 2 : 2;
      const opacityValue = typeof penOpacity !== "undefined" ? Number(penOpacity) : 1;
      const opacity = Number.isFinite(opacityValue) ? Math.round(Math.max(0, Math.min(1, opacityValue)) * 100) : 100;
      return { color, width: Math.max(1, Math.min(40, width)), opacity };
    }

    function readPalette() {
      if (window.BoardSetupPalette?.read) return window.BoardSetupPalette.read() || [];
      if (typeof penPresets !== "undefined" && Array.isArray(penPresets)) return penPresets.map((item) => ({ ...item }));
      return [];
    }

    function applyMode() {
      if (typeof setBoardInteractionMode === "function") setBoardInteractionMode(mode);
      else safeSet("board.settings.interactionMode.v1", mode);
    }

    function applyPen() {
      if (typeof applyPenPreset === "function") applyPenPreset({ color: penDraft.color, width: penDraft.width, opacity: penDraft.opacity / 100, type: "basic" }, true);
      else {
        if (typeof applyPenColor === "function") applyPenColor(penDraft.color, true);
        if (typeof applyPenWidth === "function") applyPenWidth(penDraft.width, true);
      }
    }

    function setVisible(open, { preserveFocus = false } = {}) {
      if (open && !previousFocus) previousFocus = document.activeElement;
      root.classList.toggle("is-hidden", !open);
      root.hidden = !open;
      if (open) {
        root.removeAttribute("aria-hidden");
        root.setAttribute("role", "dialog");
        root.setAttribute("aria-modal", "true");
        const parent = root.parentElement;
        const picker = document.getElementById("penColorPicker");
        const candidates = parent ? [...parent.children].filter((element) => element !== root) : [];
        if (picker && !candidates.includes(picker)) candidates.push(picker);
        inertSiblings = candidates.map((element) => ({ element, inert: element.inert }));
        inertSiblings.forEach(({ element }) => { element.inert = true; });
      } else {
        root.setAttribute("aria-hidden", "true");
        inertSiblings.forEach(({ element, inert }) => { element.inert = inert; });
        inertSiblings = [];
        if (!preserveFocus) {
          const focus = previousFocus;
          previousFocus = null;
          if (focus && typeof focus.focus === "function" && document.contains(focus)) focus.focus();
        }
      }
    }

    function renderRail() {
      steps.forEach((item, index) => {
        const current = index + 1 === step;
        item.classList.toggle("active", current);
        item.classList.toggle("done", index + 1 < step);
        if (item.dataset) item.dataset.wizardState = current ? "active" : index + 1 < step ? "done" : "pending";
      });
      const progress = find(root, ["#mobileProgress", "[data-wizard-progress]"]);
      if (progress) progress.textContent = step > 5 ? "완료" : `${step} / 5 · ${labels[step - 1]}`;
      if (back) back.hidden = step === 1 || step === 6;
      if (skip) skip.hidden = step === 6;
      if (next) { next.hidden = step === 6; next.textContent = step === 5 ? "시작하기" : "다음"; }
    }

    function render() {
      renderRail();
      if (!panel) return;
      if (step === 1) {
        panel.innerHTML = `<p class="eyebrow">01 / 입력 방식</p><h1>칠판을 어떻게 조작할까요?</h1><p class="intro">선택 사항입니다. 나중에 화면 설정에서 다시 바꿀 수 있습니다.</p><div class="choices" role="radiogroup" aria-label="입력 방식 선택"><button class="choice ${mode === "single" ? "selected" : ""}" data-wizard-mode="single" role="radio" aria-checked="${mode === "single"}" type="button"><strong>단일 터치</strong><span>한 손가락 패닝과 길게 누르는 확대·축소를 사용합니다.</span></button><button class="choice ${mode === "multi" ? "selected" : ""}" data-wizard-mode="multi" role="radio" aria-checked="${mode === "multi"}" type="button"><strong>두 손가락</strong><span>두 손가락으로 패닝과 핀치 확대·축소를 사용합니다.</span></button></div>`;
      } else if (step === 2) {
        const paletteCards = paletteDraft.length ? paletteDraft.map((item, index) => `<span class="pen-palette-item" aria-label="팔레트 ${index + 1} ${normalizeColor(item.color)}"><span class="pen-palette-swatch" style="background:${normalizeColor(item.color)}"></span></span>`).join("") : `<span class="inline-note">팔레트가 없습니다.</span>`;
        panel.innerHTML = `<p class="eyebrow">02 / 펜·팔레트</p><h1>처음 사용할 펜을 정해 보세요</h1><p class="intro">현재 펜과 팔레트를 확인하고 필요한 항목만 조정합니다.</p><section class="control-card"><div class="control-row"><span>현재 펜 색</span><button type="button" class="btn" data-wizard-pen-picker>색 선택</button></div><label class="control-row">굵기 <input data-wizard-pen-width type="range" min="1" max="40" value="${penDraft.width}"><output data-wizard-pen-width-value>${penDraft.width}px</output></label><div class="pen-palette-list" aria-label="현재 팔레트">${paletteCards}</div><button type="button" class="btn" data-wizard-palette-open>팔레트 관리</button></section>`;
      } else if (step === 3) {
        const driveConnected = typeof driveAuthenticated !== "undefined" && driveAuthenticated;
        const driveStatus = driveConnected ? (document.getElementById("driveStatus")?.textContent || "연결됨") : "연결하지 않음 · 선택 사항";
        panel.innerHTML = `<p class="eyebrow">03 / Google Drive</p><h1>Drive에서 PDF를 가져올까요?</h1><p class="intro">Drive에 저장한 PDF를 불러올 수 있습니다. 연결하지 않아도 사용할 수 있습니다.</p><section class="drive-card"><h2>Google Drive 연결</h2><p>로그인하면 Drive의 PDF를 불러올 수 있습니다.</p><button class="btn primary" type="button" data-wizard-drive-open>Google Drive 로그인</button><p class="drive-status" data-wizard-drive-status>${driveStatus}</p></section>`;
      } else if (step === 4) {
        panel.innerHTML = `<p class="eyebrow">04 / 동작 시험</p><h1>화면 동작을 확인해 보세요</h1><p class="intro">선택 사항입니다. 기존 화면 설정의 실제 시험 영역을 엽니다. 시험하지 않아도 계속할 수 있습니다.</p><button class="btn primary" type="button" data-wizard-trial-open>화면 설정에서 동작 시험 열기</button><p class="inline-note" data-wizard-trial-status>아직 시험하지 않았습니다.</p>`;
      } else if (step === 5) {
        const driveConnected = typeof driveAuthenticated !== "undefined" && driveAuthenticated;
        const driveStatus = driveConnected ? (document.getElementById("driveStatus")?.textContent || "연결됨") : "연결하지 않음 · 선택 사항";
        panel.innerHTML = `<p class="eyebrow">05 / 최종 확인</p><h1>이 설정으로 시작할까요?</h1><p class="intro">선택한 항목만 적용하고 Board를 시작합니다.</p><div class="summary"><div class="summary-row"><strong>입력 방식</strong><span>${mode === "single" ? "단일 터치" : "두 손가락"}</span></div><div class="summary-row"><strong>현재 펜</strong><span>${penDraft.color} · ${penDraft.width}px</span></div><div class="summary-row"><strong>Google Drive</strong><span>선택 사항 · ${driveStatus}</span></div></div>`;
      } else {
        panel.innerHTML = `<div class="done"><div><div class="done-mark" aria-hidden="true">✓</div><h1>준비됐습니다</h1><p class="intro">초기 설정을 마쳤습니다. 설정에서 언제든 다시 열 수 있습니다.</p></div></div>`;
      }
      bindPanel();
    }

    function bindPanel() {
      panel.querySelectorAll("[data-wizard-mode]").forEach((button) => button.addEventListener("click", () => { mode = normalizeMode(button.dataset.wizardMode); render(); }));
      panel.querySelector("[data-wizard-pen-picker]")?.addEventListener("click", () => {
        pickerReturn = true;
        setVisible(false, { preserveFocus: true });
        if (window.BoardPenColorPicker?.open) {
          window.BoardPenColorPicker.open({ color: penDraft.color, opacity: penDraft.opacity / 100,
            onApply: ({ color, opacity }) => { penDraft.color = normalizeColor(color); penDraft.opacity = Math.round(Math.max(0, Math.min(1, Number(opacity))) * 100); },
            onClose: returnFromPicker });
        } else { pickerReturn = false; setVisible(true); render(); focusWizard(); }
      });
      panel.querySelector("[data-wizard-pen-width]")?.addEventListener("input", (event) => { penDraft.width = Number(event.target.value); const output = panel.querySelector("[data-wizard-pen-width-value]"); if (output) output.value = `${penDraft.width}px`; });
      panel.querySelector("[data-wizard-palette-open]")?.addEventListener("click", () => {
        settingsReturn = true;
        externalBaseline = readPenDraft();
        setVisible(false, { preserveFocus: true });
        if (window.BoardSetupPalette?.open) window.BoardSetupPalette.open({ draft: paletteDraft, onChange: (nextPalette) => { paletteDraft = nextPalette || []; render(); } });
        else if (typeof openDocumentPopupButton !== "undefined") {
          openDocumentPopupButton.click();
          if (typeof selectSettingsCategory === "function") selectSettingsCategory("documents");
          window.setTimeout(() => document.getElementById("penPaletteSettingsContent")?.scrollIntoView({ block: "nearest" }), 0);
        }
      });
      panel.querySelector("[data-wizard-drive-open]")?.addEventListener("click", () => {
        driveReturn = true;
        if (typeof openDriveDialog === "function") openDriveDialog();
        else panel.querySelector("[data-wizard-drive-status]").textContent = "Drive 기능을 사용할 수 없습니다.";
        setVisible(false, { preserveFocus: true });
      });
      panel.querySelector("[data-wizard-trial-open]")?.addEventListener("click", openTrial);
    }

    function openTrial() {
      trialReturn = true; externalBaseline = readPenDraft(); setVisible(false, { preserveFocus: true });
      if (typeof openDocumentPopupButton !== "undefined") openDocumentPopupButton.click();
      if (typeof selectSettingsCategory === "function") selectSettingsCategory("screen");
      window.setTimeout(() => {
        const tab = document.getElementById(mode === "multi" ? "devMultiTab" : "devSingleTab");
        tab?.click();
        document.querySelector(mode === "multi" ? "[data-calibration-area]" : "[data-dev-test]")?.focus();
      }, 0);
    }

    function refreshExternalSettings() {
      const current = readPenDraft();
      if (!externalBaseline || current.color !== externalBaseline.color) penDraft.color = current.color;
      if (!externalBaseline || current.width !== externalBaseline.width) penDraft.width = current.width;
      if (!externalBaseline || current.opacity !== externalBaseline.opacity) penDraft.opacity = current.opacity;
      paletteDraft = readPalette();
      externalBaseline = null;
    }

    function focusWizard() { panel?.querySelector("button, input, select, textarea")?.focus(); }

    function returnFromSettings() {
      if (!trialReturn && !settingsReturn) return;
      trialReturn = false;
      settingsReturn = false;
      refreshExternalSettings();
      setVisible(true);
      render();
      focusWizard();
    }

    function returnFromDrive() {
      if (!driveReturn) return;
      driveReturn = false;
      setVisible(true);
      render();
      focusWizard();
    }

    function returnFromPicker() {
      if (!pickerReturn) return;
      pickerReturn = false;
      setVisible(true);
      render();
      focusWizard();
    }

    function complete(applyChanges = false) { if (applyChanges && step === 5) { applyMode(); applyPen(); } safeSet(COMPLETE_KEY, "true"); step = 6; render(); setVisible(false); }
    function handleNext() { if (step < 5) { step += 1; render(); } else complete(true); }
    function handleBack() { if (step > 1 && step < 6) { step -= 1; render(); } }
    function bind() {
      if (bound) return; bound = true;
      next?.addEventListener("click", handleNext); back?.addEventListener("click", handleBack); skip?.addEventListener("click", () => complete(false));
      document.getElementById("closeDriveDialog")?.addEventListener("click", returnFromDrive);
      document.getElementById("closeSettingsButton")?.addEventListener("click", returnFromSettings);
      document.getElementById("penColorPicker")?.addEventListener("close", returnFromPicker);
      const driveDialog = document.getElementById("driveDialog");
      const settingsDialog = document.getElementById("documentPopup");
      if (typeof MutationObserver === "function") {
        if (driveDialog) new MutationObserver(() => { if (driveDialog.classList.contains("is-hidden")) returnFromDrive(); }).observe(driveDialog, { attributes: true, attributeFilter: ["class"] });
        if (settingsDialog) new MutationObserver(() => { if (settingsDialog.classList.contains("is-hidden")) returnFromSettings(); }).observe(settingsDialog, { attributes: true, attributeFilter: ["class"] });
      }
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.getElementById("penColorPicker")?.open) return;
        if (event.key === "Escape" && (driveReturn || trialReturn || settingsReturn || pickerReturn)) {
          event.preventDefault();
          window.setTimeout(() => {
            if (pickerReturn) {
              document.getElementById("cancelPenPicker")?.click();
              return;
            }
            if (driveReturn) document.getElementById("closeDriveDialog")?.click();
            if (trialReturn || settingsReturn) document.getElementById("closeSettingsButton")?.click();
          }, 0);
          return;
        }
        if (root.hidden) return;
        if (event.key === "Tab") {
          const focusable = [...root.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
          if (focusable.length) {
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); return; }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); return; }
          }
        }
      }, true);
    }
    function open() { penDraft = readPenDraft(); paletteDraft = readPalette(); mode = normalizeMode(safeGet("board.settings.interactionMode.v1")); step = 1; setVisible(true); render(); focusWizard(); }
    function init(options = {}) { bind(); if (options.restored && options.recoveryAcknowledged && !isComplete()) open(); return api; }
    const api = { init, open, isComplete, markComplete: complete, get step() { return step; } };
    api.ready = Promise.resolve(api);
    bind();
    return api;
  }

  let controllerRoot = null;
  let controllerApi = null;
  function initGlobal(options) {
    const root = document.querySelector("#setupWizard, [data-setup-wizard]");
    if (!root) return null;
    if (root === controllerRoot && controllerApi) {
      if (options) controllerApi.init(options);
      return controllerApi;
    }
    const api = createController(root);
    controllerRoot = root;
    controllerApi = api;
    window.BoardSetupWizard = api;
    window.BoardSetupWizardReady = Promise.resolve(api);
    if (options) api.init(options);
    return api;
  }

  window.BoardSetupWizard = window.BoardSetupWizard || { init: initGlobal, open: () => initGlobal()?.open(), isComplete };
  window.BoardSetupWizard.init = initGlobal;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initGlobal()); else initGlobal();
})();
