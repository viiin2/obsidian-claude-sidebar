#!/bin/bash
# 빌드 결과를 옵시디언 볼트의 플러그인 폴더로 복사합니다.
# 사용법: ./install.sh [볼트 경로]   (생략하면 옵시디언에 등록된 첫 볼트)
set -euo pipefail
cd "$(dirname "$0")"

VAULT="${1:-}"
if [ -z "$VAULT" ]; then
  VAULT=$(node -e '
    const f = require("os").homedir() + "/Library/Application Support/obsidian/obsidian.json";
    const v = Object.values(require(f).vaults);
    const open = v.find(x => x.open) || v[0];
    process.stdout.write(open ? open.path : "");
  ')
fi
[ -d "$VAULT/.obsidian" ] || { echo "볼트를 못 찾았어요: $VAULT"; exit 1; }

DEST="$VAULT/.obsidian/plugins/claude-sidebar"
mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"

# 노트만 검색하도록 (iCloud에서 안 받은 첨부파일에서 검색이 멈추는 것 방지)
[ -f "$VAULT/.rgignore" ] || cp rgignore.template "$VAULT/.rgignore"

echo "설치됨 → $DEST"
