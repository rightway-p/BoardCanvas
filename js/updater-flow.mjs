export function createUpdaterFlow({ getStatus, checkUpdate, prepareUpdate, authorizePrepared, launchUpdate, checkPromotion, preparePromotion, launchPromotion, getRecoveryStatus, rollback, cancelPrepared, acknowledgeRecovery, openRecovery, finishInput, persistSession, confirmInstall, confirmRollback, confirmPromotion, setStatus, onRecoveryStatus }) {
  let pending;
  let pendingKind;

  function errorMessage(error, fallback) {
    return typeof error === "string" ? error : (error?.message || fallback);
  }

  function runExclusive(kind, action) {
    if (pending) {
      if (pendingKind === kind) return pending;
      setStatus("다른 업데이트 작업이 진행 중이어서 요청한 작업을 실행하지 않았습니다. 현재 작업이 끝난 뒤 다시 시도해 주세요.");
      return Promise.resolve(false);
    }
    pendingKind = kind;
    pending = action().finally(() => { pending = undefined; });
    return pending;
  }

  async function refreshRecovery() {
    try {
      const result = await getRecoveryStatus();
      onRecoveryStatus?.(result);
      return result;
    } catch (error) {
      setStatus(errorMessage(error, "복구 상태를 확인하지 못했습니다."));
      return null;
    }
  }

  async function cancelPreparedOperation() {
    if (typeof cancelPrepared !== "function") throw new Error("준비된 업데이트를 되돌리는 기능이 이 앱에서 아직 준비되지 않았습니다.");
    await cancelPrepared();
  }

  async function stageAndLaunch(prepare, authorize, launch, failureMessage) {
    let prepared = false;
    let authorized = false;
    try {
      await prepare();
      prepared = true;
      finishInput();
      if (!(await persistSession())) throw new Error(failureMessage);
      if (typeof authorize !== "function") throw new Error("저장 확인 후 업데이트를 승인하는 기능이 이 앱에서 아직 준비되지 않았습니다.");
      if ((await authorize({ workSaved: true, pdfsSaved: true })) === false) throw new Error(failureMessage);
      authorized = true;
      await launch();
      return true;
    } catch (error) {
      if (prepared && !authorized) {
        try { await cancelPreparedOperation(); }
        catch { throw new Error(`${errorMessage(error, failureMessage)} 준비된 업데이트도 안전하게 되돌리지 못했습니다.`); }
      }
      throw error;
    }
  }

  async function check(userInitiated) {
    const capability = await getStatus();
    if (!capability.configured) {
      if (userInitiated) setStatus(capability.message || "업데이트 배포 설정이 아직 준비되지 않았습니다.");
      return false;
    }

    setStatus("업데이트 확인 중…");
    const result = await checkUpdate();
    if (!result.shouldUpdate) {
      if (result.blocked) {
        setStatus(result.blocked);
        return false;
      }
      setStatus(result.message || "최신 버전을 사용 중입니다.");
      return true;
    }

    const version = result.manifest?.version || "새 버전";
    if (!capability.recoveryReady) {
      setStatus(capability.message || `${version} 업데이트를 찾았지만 직전 버전 복구 준비가 끝나지 않아 설치할 수 없습니다.`);
      return false;
    }

    if ((await confirmInstall(`${version} 업데이트를 내려받아 검증한 뒤 설치할까요? 설치 전 취소할 수 있습니다.`)) !== true) {
      setStatus("업데이트를 나중으로 미뤘습니다. 설정에서 다시 확인할 수 있습니다.");
      return true;
    }

    setStatus(`${version} 업데이트를 확인하고 준비하는 중…`);
    await stageAndLaunch(prepareUpdate, authorizePrepared, launchUpdate, "작업 복구 데이터를 안전하게 저장하지 못해 설치를 중단했습니다.");
    setStatus("업데이트를 설치하고 앱을 종료합니다. 설치가 끝나면 앱을 다시 실행해 주세요.");
    return true;
  }

  async function restorePrevious() {
    const status = await getRecoveryStatus();
    onRecoveryStatus?.(status);
    if (!status.canRollback) {
      setStatus(status.message || "복구할 수 있는 직전 버전이 없습니다.");
      return false;
    }
    const version = status.previousVersion || "직전 버전";
    if ((await confirmRollback(`${version}(으)로 복구할까요? 현재 작업은 먼저 저장하고, 복구 후 다시 시작합니다.`)) !== true) {
      setStatus("버전 복구를 취소했습니다.");
      return true;
    }
    finishInput();
    if (!(await persistSession())) throw new Error("현재 작업을 저장하지 못해 버전 복구를 중단했습니다.");
    setStatus(`${version} 복구를 시작합니다. 앱이 종료됩니다.`);
    await rollback({ confirmed: true });
    return true;
  }

  async function promoteToStable() {
    const capability = await getStatus();
    if (capability.channel !== "beta") {
      setStatus(capability.message || "베타 버전에서만 정식 버전 전환을 요청할 수 있습니다.");
      return false;
    }
    setStatus("정식 버전 배포를 확인 중…");
    const result = await checkPromotion();
    if (result.blocked) {
      setStatus(result.blocked);
      return false;
    }
    if (!result.shouldUpdate) {
      setStatus(result.message || "전환할 정식 버전이 아직 준비되지 않았습니다.");
      return false;
    }
    const version = result.manifest?.version || "정식 버전";
    if ((await confirmPromotion(`${version} 정식 버전으로 전환할까요? 서명된 설치본을 먼저 확인한 뒤 현재 작업을 저장하고 앱을 다시 시작합니다.`)) !== true) {
      setStatus("정식 버전 전환을 취소했습니다.");
      return true;
    }
    setStatus(`${version} 정식 버전을 확인하고 준비하는 중…`);
    await stageAndLaunch(preparePromotion, authorizePrepared, launchPromotion, "현재 작업을 저장하지 못해 정식 버전 전환을 중단했습니다.");
    setStatus("정식 버전으로 전환을 시작합니다. 앱이 종료됩니다.");
    return true;
  }

  async function acknowledgeRestoredSession(restoreResult) {
    if (!restoreResult?.success || !restoreResult?.pdfSuccess || restoreResult?.hadSnapshot !== true) {
      setStatus("작업 또는 PDF 복구 확인에 실패해 버전 확정을 보류했습니다.");
      return false;
    }
    if (typeof acknowledgeRecovery !== "function") {
      setStatus("복구 완료를 기록하는 기능이 이 앱에서 아직 준비되지 않았습니다.");
      return false;
    }
    try {
      await acknowledgeRecovery({ restoreSucceeded: true, pdfRestoreSucceeded: true });
      await refreshRecovery();
      return true;
    } catch (error) {
      setStatus(errorMessage(error, "복구 완료를 기록하지 못했습니다."));
      return false;
    }
  }

  return {
    run(userInitiated = false) {
      return runExclusive("check", async () => {
        try { return await check(userInitiated); }
          catch (error) { setStatus(errorMessage(error, "업데이트를 확인하지 못했습니다.")); return false; }
      });
    },
    refreshRecovery,
    acknowledgeRestoredSession,
    rollback() {
      return runExclusive("rollback", async () => {
        try { return await restorePrevious(); }
          catch (error) { setStatus(errorMessage(error, "직전 버전으로 복구하지 못했습니다.")); return false; }
      });
    },
    promote() {
      return runExclusive("promote", async () => {
        try { return await promoteToStable(); }
          catch (error) { setStatus(errorMessage(error, "정식 버전으로 전환하지 못했습니다.")); return false; }
      });
    },
    openRecovery() {
      return runExclusive("openRecovery", async () => {
        try { await openRecovery(); return true; }
          catch (error) { setStatus(errorMessage(error, "복구 도구를 열지 못했습니다.")); return false; }
      });
    },
  };
}
