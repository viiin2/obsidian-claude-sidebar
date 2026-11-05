// 줄 단위 비교: 다듬기 전/후에 무엇이 바뀌었는지 보여 주는 용도.

export type DiffLine = { t: " " | "+" | "-"; s: string };
export type HunkLine = DiffLine | { t: "…"; s: string };

/** 너무 큰 노트는 비교를 건너뜁니다 (null 반환). */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head: DiffLine[] = a.slice(0, start).map((s) => ({ t: " ", s }));
  const tail: DiffLine[] = a.slice(endA).map((s) => ({ t: " ", s }));
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) return null;

  // lcs[i][j] = A[i..], B[j..] 의 최장 공통 부분열 길이
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      mid.push({ t: " ", s: A[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      mid.push({ t: "-", s: A[i++] });
    } else {
      mid.push({ t: "+", s: B[j++] });
    }
  }
  while (i < n) mid.push({ t: "-", s: A[i++] });
  while (j < m) mid.push({ t: "+", s: B[j++] });

  return [...head, ...mid, ...tail];
}

export function diffStats(d: DiffLine[]): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const l of d) {
    if (l.t === "+") add++;
    else if (l.t === "-") del++;
  }
  return { add, del };
}

/** 바뀐 줄 주변만 남기고 나머지는 "…" 한 줄로 접습니다. */
export function hunks(d: DiffLine[], context = 1): HunkLine[] {
  const keep = new Array<boolean>(d.length).fill(false);
  d.forEach((l, k) => {
    if (l.t === " ") return;
    for (let x = Math.max(0, k - context); x <= Math.min(d.length - 1, k + context); x++) keep[x] = true;
  });
  const out: HunkLine[] = [];
  let skipped = 0;
  d.forEach((l, k) => {
    if (keep[k]) {
      if (skipped) out.push({ t: "…", s: String(skipped) });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ t: "…", s: String(skipped) });
  return out;
}
