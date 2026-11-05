#!/bin/bash
# 남에게 줄 zip 만들기: 바로 설치하는 플러그인 폴더 + 설치 프로그램(윈도우·맥) + 안내 문서 + 소스코드
# 사용법: npm run package   →  ~/Desktop/claude-sidebar-<버전>.zip
# zip 안 파일 이름은 영어로만 (맥에서 만든 zip의 한글 파일 이름은 윈도우에서 깨짐)
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p 'require("./manifest.json").version')
NAME="claude-sidebar-$VER"
OUT="${1:-$HOME/Desktop}/$NAME.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

npm run build >/dev/null
npm test >/dev/null
D="$TMP/$NAME"
mkdir -p "$D/claude-sidebar" "$D/source"
cp main.js manifest.json styles.css assistant.js "$D/claude-sidebar/"
cp release/START-HERE.md release/CUSTOMIZE.md release/install-windows.bat release/install.ps1 release/install-mac.command "$D/"
chmod +x "$D/install-mac.command"
# 소스코드: git이 관리하는 파일만 (node_modules, 빌드 결과, 내 대화 기록 data.json, git 기록 제외)
git ls-files -z --cached --others --exclude-standard | xargs -0 -I{} rsync -R "{}" "$D/source/"

# 한글 이름 파일이 섞이면 윈도우에서 깨지므로 확인
if (cd "$D" && find . | LC_ALL=C grep -q '[^ -~]'); then
  echo "zip 안에 영어가 아닌 파일 이름이 있어요:"; (cd "$D" && find . | LC_ALL=C grep '[^ -~]'); exit 1
fi

rm -f "$OUT"
(cd "$TMP" && zip -qry "$OUT" "$NAME" -x '*.DS_Store')
echo "만듦 → $OUT ($(du -h "$OUT" | cut -f1))"
