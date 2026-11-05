// 비서가 Claude에게 보내는 지시문.

import { AgendaItem, itemKey, shortDate } from "./agenda";
import type { Project } from "./collect";
import { relDay } from "./datefmt";
import type { Progress } from "./projects";
import { Routine } from "./routines";

const agendaLines = (items: AgendaItem[], withDate = false) =>
  items.map((x) => `- ${withDate ? shortDate(x.date) + " " : ""}${itemKey(x)}${x.done ? " (끝냄)" : ""}`).join("\n");

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
  /** 프로그램이 오늘 할 일 맨 위에 넣는 📌 일정 (오늘 일정 + 밀린 일) */
  pinned: AgendaItem[];
  /** 앞으로 2주 일정 */
  upcoming: AgendaItem[];
  /** 오늘 할 루틴 (프로그램이 🔁로 넣음) */
  routines: Routine[];
  /** 애플 캘린더: 오늘 (프로그램이 📆로 넣음), 앞으로 2주 */
  todayEvents: string[];
  upcomingEvents: string[];
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
지금: ${o.today}

# 오늘 일정 (📌, 프로그램이 오늘 할 일 맨 위에 따로 넣음)
${agendaLines(o.pinned, true) || "(없음)"}

# 오늘 루틴 (🔁, 프로그램이 따로 넣음)
${o.routines.map((r) => `- ${itemKey(r)}`).join("\n") || "(없음)"}
${o.todayEvents.length || o.upcomingEvents.length ? `
# 오늘 캘린더 (📆, 프로그램이 따로 넣음)
${o.todayEvents.map((x) => `- ${x}`).join("\n") || "(없음)"}

# 앞으로 2주 캘린더
${o.upcomingEvents.map((x) => `- ${x}`).join("\n") || "(없음)"}
` : ""}

# 앞으로 2주 일정 (일정 목록)
${agendaLines(o.upcoming, true) || "(없음)"}

# 프로젝트 (최근 ${o.days}일 안에 손댄 것)
${projects || "(없음)"}

# 최근 데일리 노트
${dailies || "(없음)"}

볼트에서 다가오는 일정(마감, 제출, 발표, 시험, 면접, 해커톤, 대회, D-, "까지")도 Grep으로 찾아봐. 오늘부터 2주 안의 일정만 반영해.

출력은 아래 두 블록만. 블록 밖에는 아무것도 쓰지 마.
<notify>알림에 띄울 한 줄. 오늘 가장 중요한 일, 30자 이내</notify>
<note path="${o.todayPath}" mode="prepend">
> [!todo] 오늘 할 일
> - [ ] [[프로젝트 이름]] 할 일 — 왜 오늘인지 짧게
> - [ ] ...

> [!warning] 다가오는 일정
> - MM/DD (요일) 일정 — D-n

> [!check]- 끝난 것 같아요
> - [[프로젝트 이름]] 남은 할 일 문구 그대로 — 근거 커밋
</note>

규칙:
- 오늘 할 일은 3~5개, 중요한 순서. 기준: 다가오는 마감 > 어제 저녁 회고의 "내일 이어갈 것" > 어제까지 하던 흐름 > 오래 멈춘 것 깨우기. 남은 할 일에서 고르고, 마땅한 게 없으면 새로 제안해.
- 📌 오늘 일정(밀린 일 포함), 🔁 루틴, 📆 캘린더 일정은 프로그램이 이미 맨 위에 넣어. 같은 일을 할 일로 다시 쓰지 마. 캘린더 일정 사이 빈 시간을 보고, 그 시간에 끝낼 만한 크기로 골라 (예: "11:30~15:00 빈 시간에"). 대신 일정 시각을 생각해서 나머지를 골라 (예: 오후에 약속이 있으면 오전에 끝낼 만한 일). 이미 지난 시각은 기준으로 쓰지 마 (늦게 만든 브리핑일 수 있어).
- 데일리 노트에 적힌 숙제, 준비할 것도 할 일 후보야.
- [[프로젝트 이름]]은 위 ## 제목의 이름 그대로. 프로젝트와 상관없는 일은 링크 없이.
- "다가오는 일정"에는 일정 목록, 캘린더, 볼트에서 찾은 것을 날짜순으로 (같은 일은 한 번만). 없으면 그 블록을 통째로 빼.
- "끝난 것 같아요"는 최근 커밋으로 보아 끝난 듯한 남은 할 일만. 없으면 통째로 빼.`;
}

export interface DayCommits {
  id: string;
  msgs: string[];
}

const commitBlock = (c: DayCommits[]) => c.map((x) => `## ${x.id}\n${x.msgs.map((m) => `- ${m}`).join("\n")}`).join("\n");

export function middayPrompt(o: { now: string; todayPath: string; daily: string; commits: DayCommits[]; left: AgendaItem[] }): string {
  return `[할 일: 점심 점검]
지금: ${o.now}

# 오늘 데일리 노트 (${o.todayPath})
${o.daily.trim() || "(비어 있음)"}

# 오늘 커밋
${commitBlock(o.commits) || "(없음)"}

# 오늘 남은 일정
${agendaLines(o.left) || "(없음)"}

출력은 아래 두 블록만. 블록 밖에는 아무것도 쓰지 마.
<notify>알림에 띄울 한 줄. 오후에 가장 먼저 할 일, 30자 이내</notify>
<note path="${o.todayPath}" mode="append">
> [!tip] 오후 점검
> 오전: 한 줄 요약 (커밋·체크한 것 근거)
> - [ ] [[프로젝트 이름]] 오후에 할 일 — 왜
</note>

규칙:
- 오후 할 일은 1~3개. 아침 "오늘 할 일" 중 아직 체크 안 된 것에서 고르고, 너무 크면 오후에 끝낼 만한 크기로 줄여.
- 이미 체크한 것, 📌 일정은 다시 쓰지 마 (일정은 시각에 맞춰 알림이 가). 남은 일정 시각은 생각해서 골라.
- 오전 기록이 없으면 "오전: 기록 없음"으로. 꾸짖지 말고 담백하게.
- [[프로젝트 이름]]은 아침 브리핑에 쓰인 이름 그대로.`;
}

export function eveningPrompt(o: { today: string; todayPath: string; daily: string; commits: DayCommits[]; tomorrow: AgendaItem[] }): string {
  return `[할 일: 저녁 회고]
오늘: ${o.today}

# 오늘 데일리 노트 (${o.todayPath})
${o.daily.trim() || "(비어 있음)"}

# 오늘 커밋
${commitBlock(o.commits) || "(없음)"}

# 내일 일정
${agendaLines(o.tomorrow) || "(없음)"}

출력은 아래 두 블록만. 블록 밖에는 아무것도 쓰지 마.
<notify>알림에 띄울 한 줄. 오늘 한 것 요약, 30자 이내</notify>
<note path="${o.todayPath}" mode="append">
> [!success] 오늘 한 것
> - [[프로젝트 이름]] 한 일

> [!todo] 내일 이어갈 것
> - 내일 일정: 10:00 회의
> - [[프로젝트 이름]] 이어갈 일 — 왜

> [!quote]- 한 줄 회고
> 오늘 흐름에 대한 짧은 한 마디
</note>

규칙:
- "오늘 한 것"은 체크한 항목과 오늘 커밋이 근거. 아무것도 없으면 "> - 기록된 작업 없음" 한 줄.
- "내일 이어갈 것"은 2~4개: 체크 안 된 오늘 할 일, 하다 만 흐름. 내일 아침 브리핑이 이걸 먼저 챙겨. 내일 일정이 있으면 맨 위에 "내일 일정: ..." 한 줄로, 없으면 그 줄은 빼.
- 루틴 달성 줄은 프로그램이 "오늘 한 것" 맨 위에 넣어. 너는 루틴을 따로 세지 마.
- 한 줄 회고는 칭찬 위주로 담백하게. 꾸짖지 마.
- [[프로젝트 이름]]은 브리핑에 쓰인 이름 그대로.`;
}
