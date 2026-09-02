import { Platform } from "react-native";
import type { ChatMessage, DayPlan, MemorySnapshot, RecapRecord } from "./types";

type CheckInRow = {
  id: number;
  date: string;
  blockId?: string;
  kind: string;
  prompt: string;
  answer?: string;
  status: string;
  createdAt: string;
};

type Bag = {
  kv: Record<string, string>;
  messages: ChatMessage[];
  plans: Record<string, DayPlan>;
  checkIns: CheckInRow[];
  recaps: Record<string, RecapRecord>;
  refusals: { text: string; createdAt: string }[];
  nextId: number;
};

const KEY = "steward-web-db-v1";

function empty(): Bag {
  return {
    kv: {},
    messages: [],
    plans: {},
    checkIns: [],
    recaps: {},
    refusals: [],
    nextId: 1,
  };
}

function load(): Bag {
  if (Platform.OS !== "web") return empty();
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...(JSON.parse(raw) as Bag) };
  } catch {
    return empty();
  }
}

function save(bag: Bag): void {
  if (Platform.OS !== "web") return;
  globalThis.localStorage?.setItem(KEY, JSON.stringify(bag));
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function kvGet(key: string): Promise<string> {
  return load().kv[key] ?? "";
}

export async function kvSet(key: string, value: string): Promise<void> {
  const bag = load();
  bag.kv[key] = value;
  save(bag);
}

export async function addMessage(
  role: "user" | "assistant",
  content: string
): Promise<number> {
  const bag = load();
  const id = bag.nextId++;
  bag.messages.push({
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
  });
  save(bag);
  return id;
}

export async function recentMessages(limit = 24): Promise<ChatMessage[]> {
  return load().messages.slice(-limit);
}

export async function saveDayPlan(plan: DayPlan): Promise<void> {
  const bag = load();
  bag.plans[plan.date] = plan;
  save(bag);
}

export async function getDayPlan(date: string): Promise<DayPlan | null> {
  return load().plans[date] ?? null;
}

export async function clearPendingCheckIns(date: string): Promise<void> {
  const bag = load();
  bag.checkIns = bag.checkIns.filter(
    (c) => !(c.date === date && c.status === "pending")
  );
  save(bag);
}

export async function insertCheckIn(input: {
  date: string;
  blockId?: string;
  kind: string;
  prompt: string;
}): Promise<number> {
  const bag = load();
  const id = bag.nextId++;
  bag.checkIns.push({
    id,
    date: input.date,
    blockId: input.blockId,
    kind: input.kind,
    prompt: input.prompt,
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  save(bag);
  return id;
}

export async function answerCheckIn(id: number, answer: string): Promise<void> {
  const bag = load();
  const row = bag.checkIns.find((c) => c.id === id);
  if (row) {
    row.answer = answer;
    row.status = "answered";
    save(bag);
  }
}

export async function pendingCheckInForBlock(
  date: string,
  blockId: string
): Promise<{ id: number; prompt: string } | null> {
  const row = [...load().checkIns]
    .reverse()
    .find((c) => c.date === date && c.blockId === blockId && c.status === "pending");
  return row ? { id: row.id, prompt: row.prompt } : null;
}

export async function checkInAnswersForDate(
  date: string
): Promise<{ prompt: string; answer: string }[]> {
  return load()
    .checkIns.filter((c) => c.date === date && c.answer)
    .map((c) => ({ prompt: c.prompt, answer: c.answer as string }));
}

export async function saveRecap(recap: RecapRecord): Promise<void> {
  const bag = load();
  bag.recaps[recap.date] = recap;
  save(bag);
}

export async function getRecap(date: string): Promise<RecapRecord | null> {
  return load().recaps[date] ?? null;
}

export async function yesterdayRecap(): Promise<RecapRecord | null> {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getRecap(todayKey(d));
}

export async function addRefusal(text: string): Promise<void> {
  const bag = load();
  bag.refusals.push({ text, createdAt: new Date().toISOString() });
  save(bag);
}

export async function listRefusals(limit = 20): Promise<string[]> {
  return load()
    .refusals.slice(-limit)
    .reverse()
    .map((r) => r.text);
}

export async function loadMemorySnapshot(): Promise<import("./types").MemorySnapshot> {
  const date = todayKey();
  const [
    book,
    bookPlace,
    prayerTheme,
    studyTopic,
    startupNorthStar,
    weekBet,
    refusals,
    todayPlan,
    lastRecap,
    checkInAnswers,
    nowFocus,
    interestsRaw,
  ] = await Promise.all([
    kvGet("book"),
    kvGet("book_place"),
    kvGet("prayer_theme"),
    kvGet("study_topic"),
    kvGet("startup_north_star"),
    kvGet("week_bet"),
    listRefusals(),
    getDayPlan(date),
    yesterdayRecap(),
    checkInAnswersForDate(date),
    kvGet("now_focus"),
    kvGet("interests_json"),
  ]);
  let interests: MemorySnapshot["interests"] = [];
  try {
    if (interestsRaw) interests = JSON.parse(interestsRaw);
  } catch {
    interests = [];
  }
  return {
    book,
    bookPlace,
    prayerTheme,
    studyTopic,
    startupNorthStar,
    weekBet,
    nowFocus,
    interests,
    refusals,
    todayPlan,
    lastRecap,
    checkInAnswers,
  };
}
