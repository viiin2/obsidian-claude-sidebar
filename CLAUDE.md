# Claude Sidebar (Obsidian plugin)

옵시디언 사이드바 비서. 사용자의 **Claude Code CLI(`claude -p`)를 자식 프로세스로 실행**해서 구독으로 돌아간다 (API 키 없음). macOS와 Windows 데스크톱 전용.

사용자는 대부분 코드를 모르는 사람이다. 부탁을 받으면 바로 고치고 → 테스트 → 볼트에 설치까지 해 주고, 무엇이 바뀌었는지 짧고 쉬운 한국어로 알려 준다.

## 명령

```bash
npm install            # 처음 한 번
npm run build          # 타입 검사 + main.js(플러그인) + assistant.js(아침 작업) 빌드
npm test               # 단위 테스트 (빠름, Claude 안 씀)
npm run install-vault  # 빌드 후 옵시디언 볼트에 복사·켜기. 다른 볼트: npm run install-vault -- "볼트 경로"
npm run e2e            # 임시 볼트로 실제 Claude 호출 (구독 사용량을 조금 씀, 필요할 때만)
```

고친 뒤에는 항상 `npm test` → `npm run install-vault` 를 하고, 사용자에게 **옵시디언을 완전히 껐다 켜라**고 알려 준다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/main.ts` | 플러그인 진입점, 설정 화면, 명령, 받은자료 감시(`vault.on("create")`, 레이아웃 준비 뒤 등록) |
| `src/view.ts` | 사이드바 화면: 메시지 그리기, 보내기, 제안 카드(적용·되돌리기), 브리핑·자료 작업 표시 |
| `src/claude.ts` | `claude -p --output-format stream-json` 실행. 허용 도구와 git·gh 조회 규칙이 여기 있다 |
| `src/stream.ts` | stream-json 출력 해석 → text/tool/result 이벤트 |
| `src/segments.ts` | 응답 속 `<note path="…" mode="…">` 제안 블록, `<todo date time>` 일정, `<routine days time>` 루틴 해석 |
| `src/apply.ts` | 제안 블록을 볼트에 적용 (replace/prepend/append/create) + 되돌리기 |
| `src/diff.ts` | 줄 단위 비교 (카드의 +/−) |
| `src/prompts.ts` | 대화 시스템 프롬프트, 다듬기, 대화 저장 지시문 |
| `src/exec.ts` | OS별 실행 파일 찾기(`findBin`), PATH, `exec` |
| `src/assistant/config.ts` | 볼트 밖 설정·상태 파일 위치 (맥: ~/Library/Application Support, 윈도우: %APPDATA%) |
| `src/assistant/collect.ts` | GitHub(`gh api`) + 로컬 git 폴더 → 최근 프로젝트 스냅샷 |
| `src/assistant/projects.ts` | 체크리스트 진행도, 프로퍼티 갱신, 현황표, 데일리 노트 브리핑 칸 아침·점심·저녁 (순수 함수) |
| `src/assistant/briefing.ts` | 아침 브리핑·점심 점검·저녁 회고·새로고침 순서, 일정·루틴 노트 읽고 쓰기, 데일리 노트와 맞추기 |
| `src/assistant/slots.ts` | 10분마다 깨어날 때 무엇을 할지 고르기 (순수 함수, 늦게 켜졌을 때 규칙) |
| `src/assistant/agenda.ts` | `일정.md` 줄(`- [ ] 14:00 치과 📅 2026-11-07`), 📌 줄, 체크 맞추기, 알림 시각 (순수 함수) |
| `src/assistant/routines.ts` | `루틴.md` 줄(`- 07:00 영어 🔁 매일`), 🔁 줄, 연속 기록·이번 주 달성 (순수 함수) |
| `src/assistant/daily.ts` | 데일리 노트 위치 (설정 → 없으면 최근 데일리 노트 폴더) |
| `src/assistant/calendar.ts` | 애플 캘린더 일정 → 📆 줄, 지시문용 줄, 넣을 일정 시작·끝 (순수 함수) |
| `src/assistant/maccal.ts` | 캘린더 도우미 앱을 지원 폴더에 풀고 `open -W` 로 부름 (auth/calendars/list/add/remove), `calendar.json` 캐시 |
| `native/calendar-helper.swift` | 캘린더 도우미 앱 (EventKit). `npm run build-helper` 가 빌드해서 `src/assistant/calhelper-bundle.ts` (자동 생성) 로 넣음 |
| `src/assistant/inbox.ts` | 받은자료 → `자료/<분류>/` 노트. 문서 글자 뽑기는 `officetext.ts` |
| `src/assistant/schedule.ts` | 10분마다 자동 실행 등록: 맥 launchd / 윈도우 작업 스케줄러(+wscript로 창 숨김) |
| `src/assistant/cli.ts` | `assistant.js` 진입점 (예약 실행이 `node assistant.js tick` 으로 부름: 알림 → 맞추기 → 할 일 고르기) |

## 꼭 지킬 것

- **대화 중 Claude는 읽기 전용.** `--tools` 는 Read/Glob/Grep(+조회용 Bash 규칙, 자료 정리 때만 WebFetch). Write/Edit/넓은 Bash를 허용하지 말 것. 노트 수정은 반드시 `<note>` 제안 블록 → 사용자가 [적용] 하는 흐름으로.
- `<note>`·`<todo>`·`<routine>` 블록 형식은 `src/prompts.ts`(약속)와 `src/segments.ts`(해석)가 맞물린다. 하나를 바꾸면 다른 쪽과 테스트도 같이 바꾼다. `<todo>`·`<routine>`은 확인 없이 바로 노트에 들어가므로(카드에서 빼기 가능) 일정·루틴 노트 말고 다른 곳에 쓰게 하지 말 것.
- git·gh 허용 규칙(`GIT_READ_RULES`)은 **조회 명령만**. 쓰기 명령이 통과하지 않게 할 것.
- 비서가 직접 쓰는 곳은 프로젝트 폴더, 자료 폴더, 받은자료 폴더, `일정.md`, `루틴.md`, 데일리 노트의 `%% 비서 … %%` 칸(아침·점심·저녁)뿐. 사용자의 다른 노트를 덮어쓰지 말 것.
- 루틴 체크 기록은 따로 저장하지 않고 지난 데일리 노트의 🔁 줄을 읽어서 센다. 🔁·📌 줄 형식을 바꾸면 `agenda.ts`의 `pinText`/`insertPinRows` 와 `routines.ts` 를 같이 바꾼다.
- 경로는 `path.join` 과 `findBin` 을 쓰고, `/` 나 맥 경로를 하드코딩하지 말 것 (윈도우 지원).
- 화면 글자는 적게: 아이콘, 숫자, 짧은 한국어. 설명은 툴팁(`aria-label`)으로.

## 알아 두면 좋은 함정

- 옵시디언은 켜질 때 모든 파일에 `create` 이벤트를 보낸다 → 감시는 `onLayoutReady` 안에서 등록.
- iCloud·OneDrive에서 안 받은 파일을 ripgrep이 열면 멈춘다 → 볼트의 `.rgignore` 로 노트만 검색 (플러그인이 자동 생성).
- `tsconfig` 에 `esModuleInterop` 을 켜면 obsidian의 `moment` 타입이 깨진다. 테스트는 `import { strict as assert } from "node:assert"`.
- 윈도우 npm 설치판 `claude.cmd` 는 바로 spawn 못 한다 → `claude.ts` 의 `command()` 가 node + cli.js 로 실행.
- `--append-system-prompt` 는 대화 세션 첫 요청 때 고정된다. 지시문을 바꾸면 사이드바에서 **새 대화**를 시작해야 반영된다.
- 비서를 실제로 돌려 볼 땐 `CLAUDE_ASSISTANT_HOME=<임시 폴더>` 를 주면 진짜 설정·상태 대신 그 폴더를 쓰고 알림 대신 기록만 남긴다 (그 폴더에 `config.json` 을 만들고 `vault` 를 볼트 복사본으로).
- 맥은 캘린더 권한을 "앱"에 준다. 옵시디언 확장이나 예약 실행(node)은 직접 못 받으므로 도우미 앱이 대신 한다. 도우미 앱 파일이 바뀌면(다시 빌드하면) 사용자가 허용을 다시 해야 하니, Swift 코드는 꼭 필요할 때만 고칠 것. 빌드엔 Xcode 명령줄 도구가 필요하다.
- 시각 있는 `<todo>`는 캘린더가 켜져 있으면 캘린더로, 아니면 `일정.md`로 간다 (`briefing.ts` 의 `addTodo`). 캘린더 일정 알림은 캘린더 앱이 하므로 비서는 📆 일정을 따로 알리지 않는다.
- Tasks 플러그인은 체크할 때 줄 끝에 `✅ 날짜`를 붙인다. 📌·🔁 줄을 읽을 땐 항상 `pinText` 로 지운 뒤 비교.
