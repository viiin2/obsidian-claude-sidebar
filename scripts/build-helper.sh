#!/bin/bash
# 애플 캘린더 도우미 앱 빌드 (맥 + Xcode 명령줄 도구 필요). Swift 코드를 바꿨을 때만 다시 돌리면 됩니다.
#   native/calendar-helper.swift → ClaudeCalendar.app (Intel + Apple 실리콘, 임시 서명)
#   → src/assistant/calhelper-bundle.ts (앱 파일을 글자로 담아 플러그인에 넣음. 실행할 때 지원 폴더에 풀어 씀)
# 앱이 바뀌면 사용자가 캘린더 허용을 한 번 더 해야 하므로 자주 바꾸지 마세요.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
APP="$TMP/ClaudeCalendar.app"
mkdir -p "$APP/Contents/MacOS"
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos11" native/calendar-helper.swift -o "$TMP/helper-$arch"
done
lipo -create "$TMP/helper-arm64" "$TMP/helper-x86_64" -output "$APP/Contents/MacOS/ClaudeCalendar"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>local.obsidian-claude-assistant.calendar</string>
  <key>CFBundleName</key><string>Claude 비서 캘린더</string>
  <key>CFBundleDisplayName</key><string>Claude 비서 캘린더</string>
  <key>CFBundleExecutable</key><string>ClaudeCalendar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSCalendarsUsageDescription</key><string>옵시디언 비서가 오늘 일정을 할 일에 붙이고, 말한 일정을 캘린더에 넣어요.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>옵시디언 비서가 오늘 일정을 할 일에 붙이고, 말한 일정을 캘린더에 넣어요.</string>
</dict>
</plist>
PLIST
codesign --force --sign - --identifier local.obsidian-claude-assistant.calendar "$APP"
codesign --verify --strict "$APP"
OUT=src/assistant/calhelper-bundle.ts
{
  echo "// 자동 생성 파일 (scripts/build-helper.sh). 직접 고치지 마세요."
  echo "// 애플 캘린더 도우미 앱(ClaudeCalendar.app)의 파일들. 실행할 때 지원 폴더에 그대로 풀어 씁니다."
  echo "export const HELPER_FILES: Record<string, string> = {"
  (cd "$TMP" && find ClaudeCalendar.app -type f | sort) | while read -r f; do
    printf '  "%s": "%s",\n' "${f#ClaudeCalendar.app/}" "$(base64 -i "$TMP/$f" | tr -d '\n')"
  done
  echo "};"
} > "$OUT"
echo "만듦 → $OUT ($(du -h "$OUT" | cut -f1))"
