import type { BotB50Payload, BotB50Score } from "../bridge/workers-client.js";

const DIFFICULTY_LABELS = ["PST", "PRS", "FTR", "BYD", "ETR"] as const;

function displayTitle(score: BotB50Score): string {
  return score.title.zh || score.title.en || score.title.ja || score.songId;
}

function difficultyTag(difficulty: number): string {
  return DIFFICULTY_LABELS[difficulty] ?? `D${difficulty}`;
}

function formatBeijingTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatB50Summary(b50: BotB50Payload, syncNote?: string): string {
  const player = b50.user.name || "Arcaea Player";
  const lines = [
    `[${player}] PTT ${b50.potential.toFixed(3)}（精确 ${b50.stats.weightedExact.toFixed(4)}）`,
    `Top10 均值 ${b50.stats.top10Avg.toFixed(3)} · B50 均值 ${b50.stats.b50Avg.toFixed(3)} · B50 地板 ${b50.stats.b50Floor.toFixed(3)}`,
    `快照时间：${formatBeijingTime(b50.fetchedAt)}`,
  ];
  if (syncNote) lines.push(syncNote);
  return lines.join("\n");
}

export function formatB50TextList(b50: BotB50Payload, syncNote?: string, limit = 15): string {
  const header = formatB50Summary(b50, syncNote);
  const items = b50.best50.slice(0, limit).map((score, index) => {
    const rank = String(index + 1).padStart(2, "0");
    return `#${rank} [${difficultyTag(score.difficulty)}] ${displayTitle(score)} · ${score.score.toLocaleString("en-US")} (${score.rating.toFixed(3)})`;
  });
  const tail = b50.best50.length > limit ? `\n... 共 ${b50.best50.length} 首（文本模式展示前 ${limit} 首）` : "";
  return `${header}\n\n${items.join("\n")}${tail}`;
}
