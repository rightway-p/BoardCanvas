export function createDriveLoginFlow({ invoke, onState }) {
  let generation = 0;
  let pending;

  async function listPdfs(isCurrent) {
    const files = [];
    let pageToken;
    do {
      const response = await invoke("drive_list_pdfs", pageToken ? { pageToken } : {});
      if (!isCurrent()) return null;
      files.push(...(response.files || []));
      pageToken = response.nextPageToken || null;
    } while (pageToken);
    return files;
  }

  function run(action) {
    if (pending) return pending;
    const requestGeneration = ++generation;
    const isCurrent = () => requestGeneration === generation;
    const loadFiles = async (warning) => {
      onState({ phase: "loading" });
      try {
        const files = await listPdfs(isCurrent);
        if (!isCurrent()) return false;
        onState({ phase: "connected", files, warning });
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        try {
          const status = await invoke("drive_get_auth_status");
          if (isCurrent() && !status.connected) {
            onState({ phase: "needs-login", message: status.message });
            return false;
          }
        } catch {}
        if (isCurrent()) onState({ phase: action === "signin" || action === "status" ? "connected-error" : "list-error", error });
        return false;
      }
    };
    const task = (async () => {
      if (action === "status") {
        onState({ phase: "checking-auth" });
        let status;
        try {
          status = await invoke("drive_get_auth_status");
        } catch (error) {
          if (isCurrent()) onState({ phase: "status-error", error });
          return false;
        }
        if (!isCurrent()) return false;
        if (!status.connected) {
          onState({ phase: "needs-login", message: status.message });
          return false;
        }
        return loadFiles(status.warning);
      } else if (action === "signin") {
        onState({ phase: "authenticating" });
        try {
          const auth = await invoke("drive_authenticate");
          if (!isCurrent()) return false;
          return loadFiles(auth.warning);
        } catch (error) {
          if (isCurrent()) onState({ phase: "login-error", error });
          return false;
        }
      }

      return loadFiles();
    })();
    const currentPending = task.finally(() => { if (pending === currentPending) pending = undefined; });
    pending = currentPending;
    return currentPending;
  }

  return {
    checkStatus: () => run("status"),
    signIn: () => run("signin"),
    refresh: () => run("refresh"),
    isBusy: () => Boolean(pending),
    waitForIdle: () => pending ? pending.then(() => undefined) : Promise.resolve(),
    invalidate: () => { generation += 1; },
  };
}
