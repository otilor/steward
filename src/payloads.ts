import {
  addRefusal,
  kvSet,
  saveDayPlan,
  saveRecap,
  todayKey,
} from "./db";
import { extractJsonObjects } from "./claude";
import { schedulePlanCheckIns } from "./notifications";
import type { Calling, DayPlan, RecapRecord } from "./types";

const CALLINGS: Calling[] = ["read", "pray", "study", "build"];

export async function applyStewardPayloads(raw: string): Promise<void> {
  const objects = extractJsonObjects(raw);
  for (const obj of objects) {
    const type = obj.type;
    if (type === "day_plan") {
      const plan = normalizePlan(obj);
      if (plan) {
        await saveDayPlan(plan);
        await schedulePlanCheckIns(plan);
      }
    }
    if (type === "recap") {
      const recap = normalizeRecap(obj, raw);
      if (recap) await saveRecap(recap);
    }
    if (type === "memory") {
      await applyMemoryPatch(obj);
    }
  }
}

function normalizePlan(obj: Record<string, unknown>): DayPlan | null {
  const date = String(obj.date || todayKey());
  const blocksIn = Array.isArray(obj.blocks) ? obj.blocks : [];
  const blocks = blocksIn
    .map((b, i) => {
      if (!b || typeof b !== "object") return null;
      const row = b as Record<string, unknown>;
      const calling = String(row.calling || "") as Calling;
      if (!CALLINGS.includes(calling)) return null;
      return {
        id: String(row.id || `b${i + 1}`),
        start: String(row.start || "09:00"),
        minutes: Number(row.minutes || 25),
        calling,
        outcome: String(row.outcome || ""),
      };
    })
    .filter((b): b is DayPlan["blocks"][number] => b !== null);
  if (!blocks.length) return null;
  return { type: "day_plan", date, blocks };
}

function normalizeRecap(
  obj: Record<string, unknown>,
  raw: string
): RecapRecord | null {
  return {
    date: String(obj.date || todayKey()),
    kept: String(obj.kept || ""),
    slipped: String(obj.slipped || ""),
    tomorrowFirst: String(obj.tomorrowFirst || obj.tomorrow_first || ""),
    raw,
  };
}

async function applyMemoryPatch(obj: Record<string, unknown>): Promise<void> {
  const map: [string, string][] = [
    ["book", "book"],
    ["bookPlace", "book_place"],
    ["prayerTheme", "prayer_theme"],
    ["studyTopic", "study_topic"],
    ["startupNorthStar", "startup_north_star"],
    ["weekBet", "week_bet"],
  ];
  for (const [from, to] of map) {
    if (typeof obj[from] === "string" && obj[from]) {
      await kvSet(to, String(obj[from]));
    }
  }
  if (typeof obj.refusal === "string" && obj.refusal) {
    await addRefusal(String(obj.refusal));
  }
}
