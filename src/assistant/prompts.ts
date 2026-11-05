// 비서가 Claude에게 보내는 지시문.

import type { Project } from "./collect";
import { relDay } from "./datefmt";
import type { Progress } from "./projects";

function commitLines(p: Project, max: number): string {
  if (!p.commits.length) return "(최근 커밋 없음)";
  return p.commits
    .slice(0, max)
    .map((c) => `- ${c.date.slice(5)} ${c.msg}${c.mine ? "" : ` (${c.author})`}`)
    .join("\n");
}

function issueLines(p: Project): string {
  return p.issues.map((i) => `- ${i.pr ? "PR" : "이슈"} #${i.number} ${i.title}`).join("\n");
}

export function draftPrompt(p: Project, notePath: string): string {
  return `[할 일: 프로젝트 체크리스트 초안]
프로젝트: ${p.id}
${p.repo ? `저장소: ${p.repo}\n` : ""}${p.localPath ? `폴더: ${p.localPath}\n` : ""}${p.description ? `설명: ${p.description}\n` : ""}${p.language ? `언어: ${p.language}\n` : ""}
최근 커밋 (최신순):
${commitLines(p, 20)}
${p.issues.length ? `\n열린 이슈/PR:\n${issueLines(p)}\n` : ""}
1. 폴더가 있으면 README와 기획·할 일 문서를 Read로 읽어. 볼트에서도 프로젝트 이름과 설명 속 낱말로 Grep 해서 기획서나 회의 노트가 있으면 참고해.
2. 이 프로젝트를 끝내기까지의 큰 할 일을 8~15개 체크리스트로 만들어. 커밋으로 보아 이미 끝난 건 [x], 남은 건 [ ].
   - 한 항목은 한 줄, "~하기"로 끝내 (예: 로비 화면 만들기).
   - 하루에서 며칠 단위로. 너무 잘게 쪼개지 마.

출력은 아래 블록 하나만. 블록 밖에는 아무것도 쓰지 마.
<note path="${notePath}" mode="create">
# ${p.id}
(한 줄 소개)

## 할 일
- [x] ...
- [ ] ...

## 메모
</note>`;
}

export interface BriefProject {
  p: Project;
  progress: Progress;
}

export function briefingPrompt(o: {
  today: string;
  todayPath: string;
  days: number;
  projects: BriefProject[];
  dailies: { path: string; content: string }[];
}): string {
  const ymdToday = o.today.slice(0, 10);
  const projects = o.projects
    .map(({ p, progress }) => {
      const meta = [
        progress.total ? `진행 ${progress.done}/${progress.total}` : "",
        `마지막 ${relDay(p.lastActivity, ymdToday)}`,
        `이번 주 커밋 ${p.weekCommits}`,
        p.team ? "팀" : "",
        p.unpushed ? `안 올린 커밋 ${p.unpushed}` : "",
        p.dirty ? `저장 안 한 파일 ${p.dirty}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const open = progress.open.slice(0, 8).map((t) => `- [ ] ${t}`).join("\n");
      return `## ${p.id} — ${meta}
${p.description ?? ""}
남은 할 일:
${open || "(없음)"}
최근 커밋:
${commitLines(p, 8)}${p.issues.length ? `\n열린 이슈/PR:\n${issueLines(p)}` : ""}`;
    })
    .join("\n\n");
  const dailies = o.dailies.map((d) => `=== ${d.path} ===\n${d.content.trim() || "(빈 노트)"}`).join("\n\n");

  return `[할 일: 아침 브리핑]
오늘: ${o.today}

# 프로젝트 (최근 ${o.days}일 안에 손댄 것)
${projects || "(없음)"}

# 최근 데일리 노트
${dailies || "(없음)"}

볼트에서 다가오는 일정(마감, 제출, 발표, 시험, 면접, 해커톤, 대회, D-, "까지")도 Grep으로 찾아봐. 오늘부터 2주 안의 일정만 반영해.

출력은 아래 두 블록만. 블록 밖에는 아무것도 쓰지 마.
<notify>맥 알림에 띄울 한 줄. 오늘 가장 중요한 일, 30자 이내</notify>
<note path="${o.todayPath}" mode="prepend">
> [!todo] 오늘 할 일
> 1. [[프로젝트 이름]] 할 일 — 왜 오늘인지 짧게
> 2. ...

> [!warning] 다가오는 일정
> - MM/DD (요일) 일정 — D-n

> [!check]- 끝난 것 같아요
> - [[프로젝트 이름]] 남은 할 일 문구 그대로 — 근거 커밋
</note>

규칙:
- 오늘 할 일은 3~5개, 중요한 순서. 기준: 다가오는 마감 > 어제까지 하던 흐름 이어가기 > 오래 멈춘 것 깨우기. 남은 할 일에서 고르고, 마땅한 게 없으면 새로 제안해.
- 데일리 노트에 적힌 숙제, 준비할 것도 할 일 후보야.
- [[프로젝트 이름]]은 위 ## 제목의 이름 그대로.
- "다가오는 일정"이 없으면 그 블록을 통째로 빼.
- "끝난 것 같아요"는 최근 커밋으로 보아 끝난 듯한 남은 할 일만. 없으면 통째로 빼.`;
}
