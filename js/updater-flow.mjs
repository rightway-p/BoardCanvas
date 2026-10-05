export function createUpdaterFlow({ getStatus, getUpdater, finishInput, persistSession, confirmInstall, setStatus }) {
  let pending;

  async function check(userInitiated) {
    try {
      const capability = await getStatus();
      if (!capability.configured) {
        if (userInitiated) setStatus("업데이트 배포 설정이 아직 준비되지 않았습니다.");
        return false;
      }

      const updater = getUpdater();
      if (!updater || typeof updater.checkUpdate !== "function" || typeof updater.installUpdate !== "function") {
        throw new Error("업데이트 기능을 이 앱에서 사용할 수 없습니다.");
      }

      setStatus("업데이트 확인 중…");
      const result = await updater.checkUpdate();
      if (!result.shouldUpdate) {
        setStatus("최신 버전을 사용 중입니다.");
        return true;
      }

      const version = result.manifest?.version || "새 버전";
      if (!capability.recoveryReady) {
        setStatus(`${version} 업데이트를 찾았지만 직전 버전 복구 준비가 끝나지 않아 설치할 수 없습니다. 복구 준비 후 다시 확인해 주세요.`);
        return false;
      }

      if (!confirmInstall(`${version} 업데이트를 지금 설치하고 앱을 다시 시작할까요? 취소하면 현재 작업을 유지하며 설정에서 나중에 다시 확인할 수 있습니다.`)) {
        setStatus("업데이트를 나중으로 미뤘습니다. 설정에서 다시 확인할 수 있습니다.");
        return true;
      }

      finishInput();
      if (!(await persistSession())) throw new Error("작업 복구 데이터를 안전하게 저장하지 못해 설치를 중단했습니다.");
      setStatus("업데이트를 설치하고 앱을 종료합니다. 설치가 끝나면 앱을 다시 실행해 주세요.");
      await updater.installUpdate();
      return true;
    } catch (error) {
      setStatus(error?.message || "업데이트를 확인하지 못했습니다.");
      return false;
    }
  }

  return {
    run(userInitiated = false) {
      if (pending) return pending;
      pending = check(userInitiated).finally(() => { pending = undefined; });
      return pending;
    },
  };
}
