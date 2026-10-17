export function createDriveLoginFlow({ invoke, onState }) {
  let generation = 0;
  let pending;
  let connected = false;
  let files = [];
  let path = [];
  let sharedWithMe = false;
  let warning;
  const toError = (error) => error instanceof Error ? error : new Error(typeof error === "string" ? error : "Google Drive 요청을 완료하지 못했습니다.");
  const snapshot = () => ({ files, path, sharedWithMe, warning });

  async function listFiles(target, isCurrent) {
    const result = [];
    let pageToken;
    do {
      const response = await invoke("drive_list_pdfs", {
        ...(target.path.length ? { folderId: target.path.at(-1).id } : { folderId: "root" }),
        ...(target.sharedWithMe && target.path.length === 0 ? { sharedWithMe: true } : {}),
        ...(pageToken ? { pageToken } : {}),
      });
      if (!isCurrent()) return null;
      result.push(...(response.files || []));
      pageToken = response.nextPageToken || null;
    } while (pageToken);
    return result;
  }

  function run(action, target) {
    if (pending) return pending;
    const requestGeneration = ++generation;
    const isCurrent = () => requestGeneration === generation;
    const task = (async () => {
      if (action === "status") {
        onState({ phase: "checking-auth", ...snapshot() });
        let status;
        try { status = await invoke("drive_get_auth_status"); }
        catch (error) {
          if (isCurrent()) onState({ phase: "status-error", error: toError(error), ...snapshot() });
          return false;
        }
        if (!isCurrent()) return false;
        if (!status.connected) {
          connected = false;
          files = []; path = []; sharedWithMe = false;
          onState({ phase: "needs-login", message: status.message, ...snapshot() });
          return false;
        }
        connected = true;
        files = []; path = []; sharedWithMe = false;
        warning = status.warning;
      } else if (action === "signin") {
        onState({ phase: "authenticating", ...snapshot() });
        let auth;
        try { auth = await invoke("drive_authenticate"); }
        catch (error) {
          if (isCurrent()) onState({ phase: "login-error", error: toError(error), ...snapshot() });
          return false;
        }
        if (!isCurrent()) return false;
        connected = true;
        files = []; path = []; sharedWithMe = false;
        warning = auth.warning;
      }

      const next = target || { path: [], sharedWithMe: false };
      onState({ phase: "loading", ...snapshot() });
      try {
        const nextFiles = await listFiles(next, isCurrent);
        if (!isCurrent()) return false;
        files = nextFiles;
        path = next.path;
        sharedWithMe = next.sharedWithMe;
        onState({ phase: "connected", ...snapshot() });
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        try {
          const status = await invoke("drive_get_auth_status");
          if (isCurrent() && status.connected === false) {
            connected = false; files = []; path = []; sharedWithMe = false;
            onState({ phase: "needs-login", message: status.message, ...snapshot() });
            return false;
          }
          if (isCurrent() && status.connected === true) connected = true;
        } catch {}
        if (isCurrent()) onState({ phase: action === "signin" || action === "status" || !connected ? "connected-error" : "list-error", error: toError(error), ...snapshot() });
        return false;
      }
    })();
    const currentPending = task.finally(() => { if (pending === currentPending) pending = undefined; });
    pending = currentPending;
    return currentPending;
  }

  const currentTarget = () => ({ path, sharedWithMe });
  return {
    checkStatus: () => run("status"),
    signIn: () => run("signin"),
    refresh: () => run("refresh", currentTarget()),
    openFolder: (id, name) => run("navigate", { path: [...path, { id, name }], sharedWithMe }),
    goToPath: (index) => run("navigate", { path: path.slice(0, index + 1), sharedWithMe }),
    goToParent: () => run("navigate", { path: path.slice(0, -1), sharedWithMe }),
    showMyDrive: () => run("navigate", { path: [], sharedWithMe: false }),
    showSharedWithMe: () => run("navigate", { path: [], sharedWithMe: true }),
    isBusy: () => Boolean(pending),
    waitForIdle: () => pending ? pending.then(() => undefined) : Promise.resolve(),
    invalidate: () => { generation += 1; },
    reset: () => { generation += 1; connected = false; files = []; path = []; sharedWithMe = false; warning = undefined; onState({ phase: "needs-login", ...snapshot() }); },
  };
}
