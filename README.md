# Claude Sidebar for Obsidian

옵시디언 오른쪽 사이드바에서 Claude와 대화하는 플러그인입니다.
이미 설치된 **Claude Code(구독)** 를 그대로 쓰기 때문에 API 키나 추가 요금이 필요 없습니다.

| 버튼 | 하는 일 |
|---|---|
| 입력창 | 볼트 전체를 뒤져서 답하고, 근거 노트를 `[[링크]]`로 달아 줍니다 |
| 📅 오늘 | 오늘 데일리 노트를 열고, 최근 3일 요약과 이어서 할 일을 맨 위에 붙입니다 |
| ✨ 다듬기 | 열린 노트의 맞춤법과 구조를 정리합니다 (내용은 그대로) |
| 💾 저장 | 지금까지 나눈 대화를 노트로 정리해 `Claude/` 폴더에 저장합니다 |
| ✎ 새 대화 | 대화를 처음부터 다시 시작합니다 |

- 열린 노트와 선택한 부분을 자동으로 함께 보냅니다. 입력창 위 칩을 누르면 끌 수 있어요.
- Claude는 **읽기만** 합니다. 노트를 고치는 건 항상 제안 카드의 **[적용]** 버튼으로 하고, 바뀐 줄(+/−)을 미리 보여 주며, **되돌리기**도 됩니다.

## 필요한 것

- macOS 데스크톱 옵시디언 (모바일은 안 됨)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) 설치 + 로그인 (터미널에서 `claude` 를 한 번 실행해 로그인)
- Node.js 18 이상 (빌드할 때만)

## 설치

```bash
npm install
npm run install-vault          # 옵시디언에 등록된 볼트에 설치
# 또는 ./install.sh "/볼트/경로"
```

그다음 옵시디언 → 설정 → 커뮤니티 플러그인에서 **Claude Sidebar** 를 켜고, 왼쪽 리본의 🤖 아이콘을 누르세요.

## 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| Claude Code 경로 | 자동으로 찾음 | 못 찾으면 `which claude` 결과를 넣으세요 |
| 모델 | Sonnet | Haiku는 더 빠르고, Opus는 더 똑똑하지만 사용량을 많이 씁니다 |
| 생각 깊이 | 낮음 | 낮을수록 빨리 답합니다 |
| 대화 저장 폴더 | `Claude` | 💾 버튼으로 저장한 노트가 들어갑니다 |

## iCloud 볼트라면

iCloud에서 아직 맥으로 받지 않은 첨부파일이 있으면 검색이 그 파일을 열다가 멈춥니다.
`install.sh` 가 볼트에 `.rgignore` 를 만들어서 노트(`.md`, `.canvas`)만 검색하게 합니다.

## 개발

```bash
npm run dev      # 고칠 때마다 main.js 다시 빌드
npm test         # 응답 해석, 줄 비교, 스트림 읽기 테스트
npm run e2e      # 임시 볼트로 실제 Claude에 물어보는 테스트 (사용량을 조금 씀)
```

## 동작 방식

메시지를 보낼 때마다 볼트 폴더에서 아래처럼 Claude Code를 실행하고, 출력되는 내용을 실시간으로 그립니다.
두 번째 메시지부터는 `--resume` 으로 같은 대화를 이어 갑니다.

```
claude -p --output-format stream-json --include-partial-messages \
       --tools Read,Glob,Grep --permission-prompts none ...
```

노트를 고칠 때 Claude는 아래 형식으로 제안하고, 플러그인이 이것을 카드로 보여 줍니다.

```
<note path="폴더/노트.md" mode="replace|prepend|append|create">
내용
</note>
```

## 라이선스

MIT
