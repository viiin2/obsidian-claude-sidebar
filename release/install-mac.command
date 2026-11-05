#!/bin/bash
# Claude Sidebar 설치: 이 파일을 더블클릭하세요.
# (막히면 이 파일을 우클릭 → 열기 → 열기)
cd "$(dirname "$0")"
PLUGIN_SRC="$(pwd)/claude-sidebar"
ok() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
no() { printf "  \033[31m✗\033[0m %s\n" "$1"; }

echo ""
echo "🤖 Claude Sidebar 설치"
echo ""

if [ ! -f "$PLUGIN_SRC/main.js" ]; then
  no "claude-sidebar 폴더가 이 파일 옆에 없어요. zip을 푼 폴더에서 실행해 주세요."
  read -n 1 -s -r -p "아무 키나 누르면 닫혀요"; exit 1
fi

# 1. 설치할 볼트 고르기
if [ -n "$1" ]; then
  VAULT="$1"
else
  CFG="$HOME/Library/Application Support/obsidian/obsidian.json"
  if [ ! -f "$CFG" ]; then
    no "옵시디언을 한 번도 켠 적이 없는 것 같아요. 옵시디언에서 볼트를 만든 뒤 다시 실행해 주세요."
    read -n 1 -s -r -p "아무 키나 누르면 닫혀요"; exit 1
  fi
  VAULTS=$(osascript -l JavaScript -e "
    const s = \$.NSString.stringWithContentsOfFileEncodingError('$CFG', \$.NSUTF8StringEncoding, null).js;
    Object.values(JSON.parse(s).vaults).map(v => v.path).join('\n')")
  IFS=$'\n' read -r -d '' -a LIST <<< "$VAULTS"
  if [ ${#LIST[@]} -eq 0 ]; then
    no "옵시디언 볼트를 찾지 못했어요."
    read -n 1 -s -r -p "아무 키나 누르면 닫혀요"; exit 1
  elif [ ${#LIST[@]} -eq 1 ]; then
    VAULT="${LIST[0]}"
  else
    echo "어느 볼트에 설치할까요?"
    for i in "${!LIST[@]}"; do echo "  $((i+1))) ${LIST[$i]}"; done
    read -r -p "번호: " N
    VAULT="${LIST[$((N-1))]}"
  fi
fi
if [ ! -d "$VAULT/.obsidian" ]; then
  no "볼트가 아니에요: $VAULT"
  read -n 1 -s -r -p "아무 키나 누르면 닫혀요"; exit 1
fi
echo "볼트: $VAULT"
echo ""

# 2. 플러그인 복사 (기존 대화 기록 data.json은 그대로 둠)
DEST="$VAULT/.obsidian/plugins/claude-sidebar"
mkdir -p "$DEST"
cp "$PLUGIN_SRC"/main.js "$PLUGIN_SRC"/manifest.json "$PLUGIN_SRC"/styles.css "$PLUGIN_SRC"/assistant.js "$DEST/"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null
ok "플러그인 복사"

# 3. 켜진 플러그인 목록에 추가
LISTFILE="$VAULT/.obsidian/community-plugins.json"
osascript -l JavaScript -e "
  ObjC.import('Foundation');
  const p = '$LISTFILE';
  let a = [];
  const s = \$.NSString.stringWithContentsOfFileEncodingError(p, \$.NSUTF8StringEncoding, null);
  if (s && s.js) { try { a = JSON.parse(s.js); } catch (e) {} }
  if (!a.includes('claude-sidebar')) a.push('claude-sidebar');
  \$(JSON.stringify(a, null, 2)).writeToFileAtomicallyEncodingError(p, true, \$.NSUTF8StringEncoding, null);
" >/dev/null && ok "플러그인 켜기"

# 4. 필요한 프로그램 확인
echo ""
echo "필요한 것:"
find_bin() { for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin "$HOME/.claude/local"; do [ -x "$d/$1" ] && { echo "$d/$1"; return; }; done; }
C=$(find_bin claude); G=$(find_bin gh); N=$(find_bin node)
[ -n "$C" ] && ok "Claude Code ($C)" || no "Claude Code가 없어요 → https://claude.com/claude-code 에서 설치하고, 터미널에서 claude 를 한 번 실행해 로그인하세요"
[ -n "$G" ] && ok "GitHub CLI" || no "GitHub CLI가 없어요 (선택) → brew install gh 후 gh auth login. 없으면 이 맥의 폴더만 봐요"
[ -n "$N" ] && ok "Node.js" || no "Node.js가 없어요 (아침 자동 브리핑에 필요) → https://nodejs.org"

echo ""
echo "끝! 옵시디언을 완전히 껐다가(Cmd+Q) 다시 켜세요."
echo "· 왼쪽 아이콘 줄의 🤖 를 누르면 사이드바가 열려요."
echo "· 플러그인이 안 보이면: 설정 → 커뮤니티 플러그인 → '제한 모드 끄기' 후 Claude Sidebar 켜기"
echo "· 아침 브리핑: 설정 → Claude Sidebar → 매일 아침 브리핑 켜기"
echo ""
read -n 1 -s -r -p "아무 키나 누르면 닫혀요"
echo ""
