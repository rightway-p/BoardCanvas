(function () {
  const STORAGE_KEY = "board.remote.mappings.v1";
  let actions = [];
  let mappings = loadMappings();
  let showHint = () => {};
  let pendingAction = "";
  let testPage = 1;
  let dialog = null;
  let message = null;
  const settingsEvents = new WeakSet();

  function loadMappings() {
    try {
      const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value.filter((item) => item && typeof item.actionId === "string" && typeof item.code === "string")
        .map((item) => ({ actionId: item.actionId, code: item.code, ctrlKey: Boolean(item.ctrlKey), altKey: Boolean(item.altKey), metaKey: Boolean(item.metaKey), shiftKey: Boolean(item.shiftKey) })) : [];
    } catch {
      return [];
    }
  }

  function saveMappings() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings)); } catch { showHint("원격 입력 설정을 이 기기에 저장하지 못했습니다."); }
  }

  function actionFor(id) { return actions.find((action) => action.id === id); }
  function keyName(mapping) {
    if (!mapping || !mapping.code) return "미설정";
    return [...(mapping.ctrlKey ? ["Ctrl"] : []), ...(mapping.altKey ? ["Alt"] : []), ...(mapping.shiftKey ? ["Shift"] : []), ...(mapping.metaKey ? ["Meta"] : []), mapping.code].join("+");
  }
  function chord(event) {
    return { code: String(event.code || ""), ctrlKey: Boolean(event.ctrlKey), altKey: Boolean(event.altKey), metaKey: Boolean(event.metaKey), shiftKey: Boolean(event.shiftKey) };
  }
  function sameChord(left, right) {
    return left.code === right.code && left.ctrlKey === right.ctrlKey && left.altKey === right.altKey
      && left.metaKey === right.metaKey && left.shiftKey === right.shiftKey;
  }
  function isModifierCode(code) { return /^(Control|Alt|Shift|Meta)(Left|Right)$/.test(code); }
  function isEditable(target) {
    return Boolean(target && (target.isContentEditable
      || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "")
      || (target.closest && target.closest('[contenteditable="true"], [contenteditable=""]'))));
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function beginKeyRegistration(actionId) {
    if (!actionFor(actionId)) return false;
    pendingAction = actionId;
    renderSettings();
    if (message) message.textContent = `${actionFor(actionId).label} 동작을 지정합니다. 실제 키를 눌러 주세요. Ctrl, Alt, Shift, Meta 조합도 가능합니다. Esc는 취소입니다.`;
    return true;
  }

  function setMappings(value) {
    const ids = new Set(actions.map((action) => action.id));
    mappings = Array.isArray(value) ? value.filter((item) => item && ids.has(item.actionId)
      && typeof item.code === "string" && item.code.length > 0 && item.code.length <= 64 && !isModifierCode(item.code))
      .map((item) => ({ actionId: item.actionId, code: item.code, ctrlKey: Boolean(item.ctrlKey), altKey: Boolean(item.altKey), metaKey: Boolean(item.metaKey), shiftKey: Boolean(item.shiftKey) })) : [];
    saveMappings();
    renderSettings();
    return getMappings();
  }

  function getMappings() { return mappings.map((item) => ({ ...item })); }

  function registerKey(chosen) {
    const actionId = pendingAction;
    if (!actionId || !chosen.code || chosen.code.length > 64) return false;
    if (isModifierCode(chosen.code)) {
      if (message) message.textContent = "Modifier key 단독 지정은 지원하지 않습니다. 다른 키와 함께 누르거나 Esc로 취소하세요.";
      return false;
    }
    const conflicts = mappings.filter((item) => item.actionId !== actionId && sameChord(item, chosen));
    pendingAction = "";
    setMappings([...mappings.filter((item) => item.actionId !== actionId), { actionId, ...chosen }]);
    if (conflicts.length) showHint(`${keyName(chosen)}에 동작이 여러 개 연결되어 모두 실행됩니다.`);
    renderSettings();
    if (message) message.textContent = `${actionFor(actionId).label}: ${keyName(chosen)} 등록 완료`;
    return true;
  }

  function updateTestPage(delta) {
    testPage = Math.max(1, Math.min(5, testPage + delta));
    renderTestPage();
  }

  function renderTestPage() {
    if (!dialog) return;
    const label = dialog.querySelector("[data-remote-test-page]");
    if (label) label.textContent = `시험 페이지 ${testPage} / 5`;
    dialog.querySelectorAll("[data-remote-test-number]").forEach((button) => {
      button.setAttribute("aria-current", String(Number(button.dataset.remoteTestNumber) === testPage));
    });
  }

  function runTestActions(matches) {
    for (const action of matches) {
      if (action.id === "previousPage") updateTestPage(-1);
      else if (action.id === "nextPage") updateTestPage(1);
      else if (message) message.textContent = `시험 입력 확인: ${action.label}`;
    }
  }

  function handleKeyEvent(event) {
    const pressed = chord(event);
    const code = pressed.code;
    const inSettings = Boolean(dialog && dialog.open);
    if (pendingAction) {
      if (event.repeat) { consume(event); return true; }
      consume(event);
      if (code === "Escape") {
        pendingAction = "";
        if (message) message.textContent = "키 등록을 취소했습니다.";
        renderSettings();
      } else registerKey(pressed);
      return true;
    }

    if (inSettings && code === "Escape" && !pressed.ctrlKey && !pressed.altKey && !pressed.metaKey && !pressed.shiftKey) {
      consume(event);
      closeSettings();
      return true;
    }

    if (inSettings) {
      if (!code || event.repeat || isEditable(event.target) || isModifierCode(code)) {
        settingsEvents.add(event);
        return false;
      }
      const matches = mappings.filter((item) => sameChord(item, pressed));
      if (!matches.length) {
        settingsEvents.add(event);
        return false;
      }
      runTestActions(matches.map((item) => actionFor(item.actionId)).filter(Boolean));
      consume(event);
      return true;
    }

    if (!code || isEditable(event.target) || isModifierCode(code)) return false;
    const matches = mappings.filter((item) => sameChord(item, pressed)).map((item) => actionFor(item.actionId)).filter(Boolean);
    if (!matches.length) return false;
    consume(event);
    if (event.repeat) return true;
    for (const action of matches) {
      try {
        const result = action.run();
        if (result && typeof result.catch === "function") result.catch((error) => showHint(error && error.message ? error.message : "원격 입력 동작에 실패했습니다."));
      } catch (error) {
        showHint(error && error.message ? error.message : "원격 입력 동작에 실패했습니다.");
      }
    }
    return true;
  }

  function button(label, click, attributes = {}) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    element.addEventListener("click", click);
    return element;
  }

  function openSettings() {
    if (!document) return;
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.setAttribute("aria-labelledby", "remoteSettingsTitle");
      Object.assign(dialog.style, { width: "min(560px, calc(100vw - 24px))", maxHeight: "85vh", overflow: "auto", border: "0", borderRadius: "12px", padding: "20px", color: "#17202a", boxShadow: "0 12px 48px #0005" });
      dialog.addEventListener("close", () => { pendingAction = ""; });
      document.body.appendChild(dialog);
    }
    renderSettings();
    if (!dialog.open) dialog.showModal();
  }

  function closeSettings() {
    if (dialog && dialog.open) dialog.close();
    pendingAction = "";
  }

  function isolateSettingsKey(event) {
    if (settingsEvents.has(event)) event.stopImmediatePropagation();
  }

  function renderSettings() {
    if (!dialog) return;
    dialog.replaceChildren();
    const heading = document.createElement("h2");
    heading.id = "remoteSettingsTitle";
    heading.textContent = "원격 입력 설정";
    const intro = document.createElement("p");
    intro.textContent = "동작마다 키를 지정하세요. 같은 키를 여러 동작에 지정할 수 있으며, 누르면 모두 실행됩니다.";
    const close = button("닫기", closeSettings, { "aria-label": "원격 입력 설정 닫기" });
    const header = document.createElement("header");
    header.append(heading, close);
    dialog.append(header, intro);

    for (const action of actions) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = action.label;
      const assigned = mappings.find((item) => item.actionId === action.id);
      const key = document.createElement("code");
      key.textContent = keyName(assigned);
      const register = button(pendingAction === action.id ? "키 입력 대기 중…" : "키 지정", () => beginKeyRegistration(action.id));
      row.append(label, key, register);
      Object.assign(row.style, { display: "grid", gridTemplateColumns: "1fr auto auto", gap: "10px", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #ddd" });
      dialog.appendChild(row);
    }

    const test = document.createElement("section");
    const testTitle = document.createElement("h3");
    testTitle.textContent = "시험 입력 · 설정 창이 열린 동안 실제 작업은 실행되지 않습니다";
    const page = document.createElement("p");
    page.dataset.remoteTestPage = "";
    const pageButtons = document.createElement("div");
    for (let number = 1; number <= 5; number += 1) {
      pageButtons.appendChild(button(String(number), () => { testPage = number; renderTestPage(); }, { "data-remote-test-number": String(number) }));
    }
    Object.assign(test.style, { marginTop: "18px", padding: "12px", background: "#f1f4f7", borderRadius: "8px" });
    test.append(testTitle, page, pageButtons);
    dialog.appendChild(test);

    message = document.createElement("p");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    dialog.appendChild(message);
    renderTestPage();
  }

  function configure(options = {}) {
    actions = Array.isArray(options.actions) ? options.actions.filter((item) => item && typeof item.id === "string" && typeof item.label === "string" && typeof item.run === "function") : [];
    showHint = typeof options.showHint === "function" ? options.showHint : () => {};
    const ids = new Set(actions.map((action) => action.id));
    mappings = mappings.filter((item) => ids.has(item.actionId) && item.code.length <= 64);
    saveMappings();
    return getMappings();
  }

  function getTestPage() { return testPage; }

  window.BoardRemote = { configure, openSettings, closeSettings, beginKeyRegistration, getMappings, setMappings, handleKeyEvent, getTestPage };
  window.addEventListener("keydown", handleKeyEvent, true);
  document.addEventListener("keydown", isolateSettingsKey);
})();
