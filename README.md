# Claude Sidebar for Obsidian

옵시디언 사이드바에 붙는 개인 비서입니다. 이미 설치된 **Claude Code(구독)** 로 돌아가서 API 키나 추가 요금이 필요 없습니다. **macOS·Windows** 데스크톱용.

> 남에게 줄 때: `npm run package` → 바탕화면에 zip이 생깁니다. zip 안의 `START-HERE.md`(설치·사용법)와 `CUSTOMIZE.md`(내 Claude로 고치기)를 보면 됩니다.

- 노트와 프로젝트(GitHub, 이 맥의 폴더)를 보고 질문에 답합니다.
- 매일 아침 오늘 할 일을 정리해 데일리 노트에 쓰고 맥 알림을 띄웁니다.
- 넣어 준 자료(파일, 글, 링크)를 읽고 요약해서 분류 폴더에 저장합니다.

## 사이드바

| 버튼 | 하는 일 |
|---|---|
| 입력창 | 볼트, 프로젝트 폴더, git 기록, GitHub 이슈·PR을 찾아 답하고 근거를 `[[링크]]`로 답니다 |
| 📅 오늘 | 지금 바로 아침 브리핑을 만듭니다 (아래 참고) |
| 📥 자료 | 입력창의 글·링크, 또는 고른 파일을 정리합니다. 파일을 사이드바에 **끌어다 놓아도** 됩니다 |
| ✨ 다듬기 | 열린 노트의 맞춤법과 구조를 정리합니다 (내용은 그대로) |
| 💾 저장 | 지금까지의 대화를 노트로 정리해 저장합니다 |
| ✎ 새 대화 | 대화를 처음부터 다시 시작합니다 |

- 열린 노트와 선택한 부분을 자동으로 함께 보냅니다. 입력창 위의 칩을 누르면 끌 수 있어요.
- 대화 중에 Claude는 **읽기만** 합니다. 노트를 고치는 건 제안 카드의 **[적용]** 버튼으로만 하고, 바뀐 줄(+/−)을 미리 보여 주며 되돌릴 수도 있어요.
- git과 GitHub은 조회 명령만 허용합니다 (`git -C <폴더> log/status/diff/show`, `gh issue/pr list·view`, `gh repo view/list`). 그 밖의 명령은 자동으로 거부돼요.

## 아침 브리핑

설정에서 **매일 아침 브리핑**을 켜면, 정한 시각(기본 08:30)에 운영체제가 대신 실행합니다(맥은 launchd, 윈도우는 작업 스케줄러). 옵시디언이 꺼져 있어도 돌아요.

1. **받은자료 정리:** 밤사이 `받은자료` 폴더에 들어온 자료를 정리합니다.
2. **프로젝트 찾기:** GitHub과 `~/Desktop`에서 최근 30일 안에 손댄 프로젝트를 찾습니다. 팀 저장소는 내 커밋이 있거나 이번 주에 활동이 있을 때만 넣어요.
3. **프로젝트 노트:** 프로젝트마다 `프로젝트/<이름>.md` 노트를 둡니다. 처음엔 Claude가 README, 커밋, 기획 노트를 보고 **할 일 체크리스트** 초안을 씁니다. 체크한 비율이 진행도(예: 7/12)가 돼요.
4. **현황표:** `프로젝트/현황.md` 를 새로 씁니다 (진행 막대, 마지막 작업일, 이번 주 커밋 수).
5. **오늘 할 일:** 데일리 노트 맨 위에 씁니다.
   - 오늘 할 일 3~5개 (마감 > 하던 흐름 > 멈춘 것 순서)
   - 다가오는 일정
   - 끝난 것 같은 체크 항목
6. **알림:** 맥·윈도우 알림을 띄웁니다.

알아 두면 좋은 것:
- **git 없는 프로젝트:** 영어 공부처럼 git이 없는 일도 `프로젝트/` 폴더에 노트를 만들고 `## 할 일` 체크리스트를 적으면 같이 챙겨요.
- **끝난 프로젝트:** 노트 프로퍼티에 `상태: 완료` 라고 적으면 브리핑에서 빠져요.
- **컴퓨터가 꺼져 있었다면:** 그 시각에 잠자고 있었으면 깨어날 때, 꺼져 있었으면 로그인할 때 실행돼요. 하루에 한 번만 돌아요.

## 자료 정리

정리할 자료를 넣는 방법은 네 가지예요.

- 사이드바에 파일을 끌어다 놓기
- 📥 버튼 누르기
- 볼트의 `받은자료` 폴더에 넣기 (폰에서 iCloud로 넣어도 돼요)
- 입력창에 글이나 링크를 쓰고 📥 누르기

넣은 자료는 이렇게 정리돼요.

- **새 노트:** Claude가 읽고 `자료/<분류>/<제목>.md` 노트를 만듭니다. 노트에는 한 줄 요약, 핵심, 내용, 관련 노트·프로젝트 링크가 들어가요.
- **분류:** 이미 있는 분류에 맞으면 그걸 쓰고, 없으면 새로 만듭니다 (창업, 개발, 영어 등).
- **읽을 수 있는 자료:** 글, PDF, 이미지, HTML, 워드(docx), 파워포인트(pptx), 한글(hwpx). 맥은 doc·rtf·odt도 읽어요. 링크는 웹 페이지를 읽어 정리해요.
- **원본 파일:** 첨부파일 폴더로 옮겨 노트 안에 넣습니다.
- **글 원본:** 노트 맨 아래에 접힌 인용으로 남깁니다.

## 필요한 것

- macOS 또는 Windows의 데스크톱 옵시디언 (모바일은 안 됨)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) 설치 + 로그인 (터미널에서 `claude` 를 한 번 실행). 윈도우는 Git도 필요해요.
- [GitHub CLI](https://cli.github.com) 로그인 (`gh auth login`). 없으면 이 컴퓨터의 폴더만 봐요.
- Node.js 18 이상 (빌드, 아침 자동 실행)

## 설치

```bash
npm install
npm run install-vault                    # 옵시디언에 등록된 볼트에 설치
npm run install-vault -- "/볼트/경로"     # 다른 볼트에
```

옵시디언 → 설정 → 커뮤니티 플러그인에서 **Claude Sidebar** 를 켜고, 왼쪽 리본의 🤖 아이콘을 누르세요.
아침 브리핑은 설정 → Claude Sidebar → **매일 아침 브리핑** 을 켜면 등록됩니다.

## iCloud 볼트라면

iCloud·OneDrive에서 아직 받지 않은 첨부파일이 있으면 검색이 그 파일을 열다가 멈춥니다.
플러그인이 볼트에 `.rgignore` 를 만들어서 노트(`.md`, `.canvas`)만 검색하게 합니다.

## 파일 위치

| 무엇 | macOS | Windows |
|---|---|---|
| 비서 설정·상태·현황(JSON) | `~/Library/Application Support/obsidian-claude-assistant/` | `%APPDATA%\obsidian-claude-assistant\` |
| 아침 자동 실행 | `~/Library/LaunchAgents/local.obsidian-claude-assistant.plist` | 작업 스케줄러 `ObsidianClaudeAssistant` |
| 기록 | `~/Library/Logs/obsidian-claude-assistant.log` | `%APPDATA%\obsidian-claude-assistant\assistant.log` |

터미널에서 직접 돌릴 수도 있어요.

```bash
node assistant.js morning --force   # 지금 브리핑
node assistant.js inbox             # 받은자료 정리
node assistant.js collect           # 모은 프로젝트 현황 보기
node assistant.js install|uninstall # 아침 자동 실행 등록·해제
```

## 개발

```bash
npm run dev      # 고칠 때마다 다시 빌드
npm test         # 응답 해석, 줄 비교, 스트림 읽기, 체크리스트·현황표, 문서 글자 뽑기 테스트
npm run e2e      # 임시 볼트로 실제 Claude에 물어보는 테스트 (사용량을 조금 씀)
npm run package  # 남에게 줄 zip 만들기 (맥에서)
```

## 라이선스

MIT
