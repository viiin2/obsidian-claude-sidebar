// 실제 Claude Code로 프롬프트가 약속한 형식대로 답하는지 확인합니다 (구독 사용량을 조금 씀).
// 실행: npm run e2e
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findClaude, runClaude } from "../src/claude";
import { contextHeader, polishPrompt, systemPrompt } from "../src/prompts";
import { noteBlocks, routineBlocks, todoBlocks } from "../src/segments";

const vault = mkdtempSync(join(tmpdir(), "cs-vault-"));
mkdirSync(join(vault, "회의"));
writeFileSync(join(vault, "회의", "11-03 기획회의.md"), "# 기획회의\n- 출시일은 12월 2일로 정함\n- 담당: 민지(디자인), 철수(서버)\n");
writeFileSync(join(vault, "메모.md"), "오늘 회의 했음 결론은 출시일 정하기 였고 다음주에 디자인 시안 봐야함 철수는 서버비용 알아보기로함\n");

const claude = findClaude();
if (!claude) throw new Error("claude 없음");

async function ask(prompt: string, calendarFile: string | null = null): Promise<{ text: string; tools: string[]; ok: boolean; ms: number }> {
  let text = "";
  const tools: string[] = [];
  let ok = false;
  const t0 = Date.now();
  const h = runClaude({
    claudePath: claude!, cwd: vault, prompt, systemPrompt: systemPrompt({ projectFolder: "프로젝트", materialsFolder: "자료", snapshotPath: "/없음.json", agendaFile: "일정.md", routineFile: "루틴.md", calendarFile }), model: "sonnet", effort: "low",
    onEvent: (e) => {
      if (e.type === "text") text += e.delta;
      if (e.type === "tool") tools.push(`${e.name}(${JSON.stringify(e.input).slice(0, 60)})`);
      if (e.type === "result") { ok = e.ok; if (!e.ok) text += `\n[오류] ${e.text}`; }
    },
  });
  await h.done;
  return { text, tools, ok, ms: Date.now() - t0 };
}

(async () => {
  const today = "2026-11-05 (목)";
  const q = await ask(`${contextHeader({ today })}\n\n출시일이 언제로 정해졌어?`);
  console.log(`\n① 질문 (${q.ms}ms, ok=${q.ok})\n도구: ${q.tools.join(", ")}\n${q.text}`);
  const qPass = q.ok && q.text.includes("12월 2일") && q.text.includes("[[");

  const memo = "오늘 회의 했음 결론은 출시일 정하기 였고 다음주에 디자인 시안 봐야함 철수는 서버비용 알아보기로함\n";
  const p = await ask(`${contextHeader({ today })}\n\n${polishPrompt("메모.md", memo)}`);
  const blocks = noteBlocks(p.text);
  console.log(`\n② 다듬기 (${p.ms}ms, ok=${p.ok}) 블록 ${blocks.length}개\n${p.text}`);
  const pPass = p.ok && blocks.length === 1 && blocks[0].complete && blocks[0].mode === "replace" && blocks[0].path === "메모.md";

  const t = await ask(`${contextHeader({ today: "2026-11-05 (목) 15:20" })}\n\n금요일 오후 3시에 치과 가야 하고, 다음 주 화요일까지 보고서 내야 해`);
  const todos = todoBlocks(t.text);
  console.log(`\n③ 일정 넣기 (${t.ms}ms, ok=${t.ok}) 일정 ${todos.length}개\n${t.text}`);
  const tPass =
    t.ok &&
    todos.some((x) => x.date === "2026-11-06" && x.time === "15:00" && x.text.includes("치과")) &&
    todos.some((x) => x.date === "2026-11-10" && x.text.includes("보고서"));

  const r = await ask(`${contextHeader({ today: "2026-11-05 (목) 15:20" })}\n\n매일 아침 7시에 영어 단어 외우는 루틴 넣어줘. 월수금엔 헬스도`);
  const rs = routineBlocks(r.text);
  console.log(`\n④ 루틴 넣기 (${r.ms}ms, ok=${r.ok}) 루틴 ${rs.length}개\n${r.text}`);
  const rPass =
    r.ok &&
    todoBlocks(r.text).length === 0 &&
    rs.some((x) => x.days === "매일" && x.time === "07:00" && x.text.includes("영어")) &&
    rs.some((x) => x.days.replace(/\s/g, "") === "월수금" && x.text.includes("헬스"));

  const c = await ask(`${contextHeader({ today: "2026-11-05 (목) 15:20" })}\n\n토요일 오후 3시부터 5시까지 친구 결혼식`, "/없음/calendar.json");
  const cs = todoBlocks(c.text);
  console.log(`\n⑤ 캘린더 일정 (${c.ms}ms, ok=${c.ok})\n${c.text}`);
  const cPass = c.ok && cs.some((x) => x.date === "2026-11-07" && x.time === "15:00" && x.end === "17:00");

  console.log(`\n결과: 질문 ${qPass ? "통과" : "실패"} · 다듬기 ${pPass ? "통과" : "실패"} · 일정 ${tPass ? "통과" : "실패"} · 루틴 ${rPass ? "통과" : "실패"} · 캘린더 ${cPass ? "통과" : "실패"}`);
  process.exit(qPass && pPass && tPass && rPass && cPass ? 0 : 1);
})();
