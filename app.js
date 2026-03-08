const APP_CHUNK_SCRIPTS = [
  "./js/globals.js",
  "./js/runtime-overlay.js",
  "./js/session-pdf-toolbar.js",
  "./js/presets-strokes.js",
  "./js/render-doc-draw.js",
  "./js/events-init.js"
];

function loadScriptSequentially(source) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${source}`));
    document.head.appendChild(script);
  });
}

async function bootstrapAppChunks() {
  for (const source of APP_CHUNK_SCRIPTS) {
    await loadScriptSequentially(source);
  }
}

void bootstrapAppChunks().catch((error) => {
  console.error(error);

  const statusElement = document.getElementById("documentStatus");
  if (statusElement) {
    statusElement.textContent = "앱 스크립트 로드에 실패했습니다. 새로고침 후 다시 시도하세요.";
    statusElement.dataset.tone = "error";
  }
});
