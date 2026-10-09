const NOTES_BY_VERSION = {
  "2.0.1-beta.7": [
    "페이지 맞춤 버튼을 도구 모음에 통합해 펜 모드와 패닝 모드 어디서나 같은 방식으로 사용할 수 있습니다.",
    "색상 선택에 색상 스펙트럼, 투명도 배경, 실시간 미리보기와 끊김 없는 드래그 조작을 추가했습니다.",
    "업데이트 후 개선 사항을 한 번에 확인하고, 설정의 앱 정보에서 다시 열 수 있습니다.",
  ],
};

export function releaseNotesFor(version) {
  return NOTES_BY_VERSION[version] || null;
}

function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value || "");
    return match && { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") || null };
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  if (!a.pre || !b.pre) return a.pre ? -1 : b.pre ? 1 : 0;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (a.pre[index] == null) return -1;
    if (b.pre[index] == null) return 1;
    const aNumeric = /^\d+$/.test(a.pre[index]), bNumeric = /^\d+$/.test(b.pre[index]);
    if (aNumeric && bNumeric && Number(a.pre[index]) !== Number(b.pre[index])) return Number(a.pre[index]) > Number(b.pre[index]) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a.pre[index] !== b.pre[index]) return a.pre[index] > b.pre[index] ? 1 : -1;
  }
  return 0;
}

export function releaseNotesSeenKey(version) {
  return `board.release-notes.shown.v1.${encodeURIComponent(version)}`;
}

export function recordReleaseNotesRunningVersion(version, storage) {
  try {
    storage.setItem("board.release-notes.last-running-version.v1", version);
    return true;
  } catch {
    return false;
  }
}

export function recordReleaseNotesShown(version, storage) {
  try {
    storage.setItem(releaseNotesSeenKey(version), "true");
  } catch {
    return false;
  }
  return recordReleaseNotesRunningVersion(version, storage);
}

export function shouldShowReleaseNotes({ version, previousVersion, lastRunningVersion, versionShown }) {
  const upgraded = compareVersions(version, previousVersion) > 0 || compareVersions(version, lastRunningVersion) > 0;
  return Boolean(releaseNotesFor(version) && upgraded && !versionShown);
}
