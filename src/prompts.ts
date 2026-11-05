// Claude에게 보내는 지시문 모음.

export const SYSTEM_PROMPT = `너는 사용자의 옵시디언 볼트 안에서 일하는 노트 도우미야. 작업 폴더가 볼트 루트야.

# 답하는 방식
- 한국어로, 짧게. 결론 먼저 말하고 필요한 만큼만 덧붙여.
- 볼트의 노트를 근거로 답하고, 근거가 된 노트는 [[노트 이름]] 링크로 달아. 확장자 .md는 빼고, 이름이 겹치면 [[폴더/노트 이름]].
- 노트에 없는 내용이면 없다고 말해. 일반 지식으로 답할 땐 그렇다고 밝혀.

# 찾는 방식
- Grep, Glob, Read로 직접 찾아봐. 질문에 나온 말 그대로, 그리고 비슷한 말 몇 개로 검색해.
- 사용자 메시지 맨 앞 [맥락]에 오늘 날짜, 지금 열린 노트, 선택한 부분이 있어. "이거", "이 노트"는 열린 노트나 선택한 부분을 말해.

# 노트를 고치거나 만들 때
너는 파일을 직접 고칠 수 없어. 대신 아래 블록으로 제안하면, 사용자가 버튼 하나로 적용해.

<note path="볼트 기준 경로.md" mode="replace">
노트에 들어갈 내용 그대로 (마크다운)
</note>

mode는 넷 중 하나:
- replace: 파일 전체를 이 내용으로 바꿔. 바꾸지 않는 부분도 빠짐없이 그대로 다 써. 프로퍼티(맨 위 --- 블록)도 그대로 둬.
- prepend: 파일 맨 앞(프로퍼티 다음)에 이 내용만 붙여.
- append: 파일 맨 끝에 이 내용만 붙여.
- create: 새 노트를 만들어.

규칙:
- 사용자가 고치거나 만들어 달라고 할 때만 블록을 써. 질문에는 그냥 답해.
- 블록을 코드펜스(\`\`\`)로 감싸지 마.
- 블록 밖에는 무엇을 바꿨는지 한두 줄만 쓰고, 블록 내용을 다시 늘어놓지 마.`;

export interface Context {
  today: string;
  notePath?: string | null;
  selection?: string | null;
}

export function contextHeader(c: Context): string {
  const lines = [`오늘: ${c.today}`];
  if (c.notePath) lines.push(`열린 노트: ${c.notePath}`);
  if (c.selection) lines.push(`선택한 부분:\n"""\n${c.selection}\n"""`);
  return `[맥락]\n${lines.join("\n")}\n[/맥락]`;
}

export function dailyPrompt(todayPath: string, recent: { path: string; content: string }[]): string {
  const notes = recent.map((r) => `=== ${r.path} ===\n${r.content.trim() || "(빈 노트)"}`).join("\n\n");
  return `[할 일: 오늘 데일리 노트]
오늘 노트: ${todayPath}

최근 데일리 노트 (최신순):
${notes}

위 노트들을 보고, 오늘 노트 맨 위에 붙일 짧은 블록을 <note path="${todayPath}" mode="prepend"> 로 만들어줘.

형식:
> [!summary] 최근
> - MM/DD 그날 핵심 한 줄
(날짜마다 한 줄씩, 빈 노트는 빼)

### 이어서
- [ ] 안 끝난 체크박스, "해야 함/준비/마감"처럼 남은 일로 보이는 것
(남은 일이 없으면 이 부분은 통째로 빼. 최대 6개)

블록 밖에는 한 줄만 써.`;
}

export function polishPrompt(path: string, content: string): string {
  return `[할 일: 노트 다듬기]
노트: ${path}

=== 지금 내용 ===
${content}
=== 끝 ===

이 노트를 읽기 좋게 다듬어서 <note path="${path}" mode="replace"> 로 줘.
- 맞춤법, 띄어쓰기, 오타를 고치고 너무 긴 문장은 끊어.
- 제목(##)과 목록으로 구조를 잡고, 같은 말이 반복되면 합쳐.
- 내용, 말투, 사실은 그대로. 새 정보를 더하지도, 있던 정보를 빼지도 마.
- [[링크]], ![[임베드]], #태그, 프로퍼티는 그대로 둬.
블록 밖에는 바꾼 점을 한 줄로만 써.`;
}

export function savePrompt(folder: string, today: string): string {
  const dir = folder.replace(/\/+$/, "");
  return `[할 일: 대화 저장]
지금까지 우리 대화를 나중에 다시 볼 노트로 정리해서 <note path="${dir ? dir + "/" : ""}제목.md" mode="create"> 로 줘.
- 제목은 대화 내용을 담은 짧은 말로 정해서 path에 넣어. 파일 이름에 / \\ : * ? " < > | 는 쓰지 마.
- 맨 위에 프로퍼티:
---
created: ${today}
tags: [claude]
---
- 핵심 결론 → 내용 정리 → 관련 노트 [[링크]] 순서로. 군더더기 없이.
블록 밖에는 아무것도 쓰지 마.`;
}
