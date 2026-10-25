const NOTES_BY_VERSION = {
  "2.0.1-beta.19": [
    "실행 취소·다시 실행, 도구 전환, 페이지 이동 등 주요 동작 결과를 화면 오른쪽 위에 잠깐 표시합니다.",
    "지우개 위치와 실제 지워지는 크기를 원과 중심점으로 표시하며, 확대·축소에 맞춰 크기가 바뀝니다.",
    "획 지우개는 점선 원으로 구분하고, 손가락으로 지울 때는 손가락 위에 모드와 크기를 함께 표시합니다.",
  ],
  "2.0.1-beta.18": [
    "두 손가락으로 두 번 탭하면 현재 페이지의 판서·지우개 작업을 실행 취소하고, 세 번 탭하면 다시 실행합니다.",
    "더블 탭은 세 번째 탭을 구분하기 위해 약 0.3초 뒤 실행됩니다. 손가락을 움직이면 패닝·줌으로 이어집니다.",
    "줌·패닝 뒤 실행 취소와 다시 실행 버튼이 비활성 상태로 남던 문제를 수정했습니다.",
  ],
  "2.0.1-beta.17": [
    "줌·패닝 잠금을 켜면 화면 확대·축소와 이동을 막고 펜과 지우개는 계속 사용할 수 있습니다.",
    "펜, 지우개, 현재 페이지 전체 지우기 버튼을 연속해서 배치했습니다.",
    "줌·패닝 잠금 버튼을 설정 바로 앞에 옮겼습니다.",
  ],
  "2.0.1-beta.16": [
    "다음 페이지를 준비하는 동안 현재 PDF와 판서를 유지해 화면이 흰색으로 깜박이지 않습니다.",
    "방문한 PDF 페이지를 메모리 한도 안에서 재사용해 이전 페이지로 빠르게 돌아갑니다.",
    "인접 페이지를 백그라운드에서 차례로 준비하며, 캐시는 최대 96MiB·8페이지로 제한됩니다.",
  ],
  "2.0.1-beta.15": [
    "새로 그리는 획은 화면 확대 배율과 관계없이 같은 굵기로 표시되며, 기존 획은 그대로 유지됩니다.",
    "탐색 모드를 잠그면 한 손으로 화면을 이동하고 길게 눌러 확대·축소할 수 있으며, 잠금을 풀면 펜으로 돌아옵니다.",
    "페이지 맞춤을 도구 모음 맨 위로 옮기고, 펜 프리셋을 최대 여섯 개까지 바로 표시합니다.",
  ],
  "2.0.1-beta.14": [
    "Google Drive PDF를 열 때 현재 작업 저장 또는 교체 확인 창이 Drive 화면 앞에 표시됩니다.",
    "취소하면 현재 판서와 Drive 폴더 위치를 유지하고 PDF 다운로드를 시작하지 않습니다.",
    "확인 창을 닫으면 사용할 수 있는 원래 버튼으로 키보드 초점을 돌려줍니다.",
  ],
  "2.0.1-beta.13": [
    "현재 폴더와 주변 폴더를 왼쪽 경로에서 확인하고, 같은 깊이의 폴더로 이동할 수 있습니다.",
    "폴더 제목을 눈에 띄게 표시하고 긴 전체 경로는 별도 스크롤해 파일 목록 공간을 유지합니다.",
    "내 드라이브와 공유 문서함을 탐색할 수 있으며 PDF만 칠판에서 열 수 있습니다.",
  ],
  "2.0.1-beta.12": [
    "Google Drive에서 내 드라이브 폴더를 열고 경로를 따라 이동할 수 있습니다.",
    "공유 문서함에서도 폴더를 탐색하고 상위 폴더로 돌아갈 수 있습니다.",
    "폴더와 파일을 한 줄씩 표시하며, 긴 이름은 줄바꿈합니다. PDF만 칠판에서 열 수 있습니다.",
  ],
  "2.0.1-beta.11": [
    "Google Drive 데스크톱 로그인과 저장된 로그인 갱신에 설정된 OAuth 클라이언트 자격 증명을 함께 전달하도록 수정했습니다.",
    "OAuth 오류는 HTTP 상태와 안전한 안내를 표시하고, 응답에 포함된 임의 값은 화면에 노출하지 않습니다.",
    "브라우저 콜백은 권한 코드 수신만 알리고, 연결 완료 여부는 BoardCanvas 앱에서 확인하도록 문구를 바로잡았습니다.",
  ],
  "2.0.1-beta.10": [
    "두 손가락 합류 판정에 입력 시각을 사용해 렌더링 지연이 판단에 섞이는 경우를 줄였습니다.",
    "Google Drive 브라우저 로그인 설정을 데스크톱 빌드에 연결했습니다.",
    "전체 화면 버튼을 설정 뒤로 옮겼습니다.",
    "세로 도구 모음에서 페이지 화살표를 위·아래로 돌리고 페이지 수 표시를 간결하게 정리했습니다.",
  ],
  "2.0.1-beta.9": [
    "새 판서는 보정 없이 입력한 경로를 그대로 그려 화면에 보이는 획과 저장된 획이 일치합니다.",
    "화면 크기나 배율이 바뀔 때 진행 중인 획을 먼저 보존해 위치가 튀는 문제를 수정했습니다.",
    "카메라 이동과 확대·축소 상태에서도 실시간 잉크의 위치를 맞췄습니다.",
  ],
  "2.0.1-beta.8": [
    "펜 하나로 바로 판서하고, 한 손의 검지·중지로 패닝하며 두 손으로 확대·축소할 수 있습니다.",
    "두 손가락 간격으로 패닝과 핀치 줌을 자동 선택하며 회전은 적용하지 않습니다.",
    "설정에서 두 번째 손가락 합류 시간(기본 120ms), 필기 고정 이동 거리(8px), 패닝·줌 구분 간격(90px)을 조정할 수 있습니다.",
  ],
  "2.0.1-beta.7": [
    "페이지 맞춤 버튼을 도구 모음에 통합해 펜 모드와 패닝 모드 어디서나 같은 방식으로 사용할 수 있습니다.",
    "색상 선택에 색상 스펙트럼, 투명도 배경, 실시간 미리보기와 끊김 없는 드래그 조작을 추가했습니다.",
    "업데이트 후 개선 사항을 한 번에 확인하고, 설정의 앱 정보에서 다시 열 수 있습니다.",
    "앱 정보에서 베타 업데이트를 선택할 수 있고, 설치된 베타 버전은 최신 정식 버전으로 돌아갈 수 있습니다.",
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
