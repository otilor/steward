import * as SQLite from "expo-sqlite";
import type { ChatMessage, DayPlan, RecapRecord } from "./types";

let db: SQLite.SQLiteDatabase | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("steward.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS day_plans (
      date TEXT PRIMARY KEY NOT NULL,
      json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS check_ins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      block_id TEXT,
      kind TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recaps (
      date TEXT PRIMARY KEY NOT NULL,
      kept TEXT,
      slipped TEXT,
      tomorrow_first TEXT,
      raw TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refusals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function kvGet(key: string): Promise<string> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string }>(
    "SELECT value FROM kv WHERE key = ?",
    [key]
  );
  return row?.value ?? "";
}

export async function kvSet(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

export async function addMessage(
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)",
    [role, content, new Date().toISOString()]
  );
}

export async function recentMessages(limit = 24): Promise<ChatMessage[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    id: number;
    role: "user" | "assistant";
    content: string;
    created_at: string;
  }>(
    "SELECT id, role, content, created_at FROM messages ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export async function saveDayPlan(plan: DayPlan): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "INSERT INTO day_plans (date, json, created_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET json = excluded.json",
    [plan.date, JSON.stringify(plan), new Date().toISOString()]
  );
}

export async function getDayPlan(date: string): Promise<DayPlan | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ json: string }>(
    "SELECT json FROM day_plans WHERE date = ?",
    [date]
  );
  if (!row) return null;
  try {
    return JSON.parse(row.json) as DayPlan;
  } catch {
    return null;
  }
}

export async function clearPendingCheckIns(date: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "DELETE FROM check_ins WHERE date = ? AND status = 'pending'",
    [date]
  );
}

export async function insertCheckIn(input: {
  date: string;
  blockId?: string;
  kind: string;
  prompt: string;
}): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    "INSERT INTO check_ins (date, block_id, kind, prompt, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    [input.date, input.blockId ?? null, input.kind, input.prompt, new Date().toISOString()]
  );
  return Number(result.lastInsertRowId);
}

export async function answerCheckIn(id: number, answer: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "UPDATE check_ins SET answer = ?, status = 'answered' WHERE id = ?",
    [answer, id]
  );
}

export async function pendingCheckInForBlock(
  date: string,
  blockId: string
): Promise<{ id: number; prompt: string } | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ id: number; prompt: string }>(
    "SELECT id, prompt FROM check_ins WHERE date = ? AND block_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    [date, blockId]
  );
  return row ?? null;
}

export async function checkInAnswersForDate(
  date: string
): Promise<{ prompt: string; answer: string }[]> {
  const database = await getDb();
  return database.getAllAsync<{ prompt: string; answer: string }>(
    "SELECT prompt, answer FROM check_ins WHERE date = ? AND answer IS NOT NULL AND answer != ''",
    [date]
  );
}

export async function saveRecap(recap: RecapRecord): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO recaps (date, kept, slipped, tomorrow_first, raw, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       kept = excluded.kept,
       slipped = excluded.slipped,
       tomorrow_first = excluded.tomorrow_first,
       raw = excluded.raw`,
    [
      recap.date,
      recap.kept,
      recap.slipped,
      recap.tomorrowFirst,
      recap.raw,
      new Date().toISOString(),
    ]
  );
}

export async function getRecap(date: string): Promise<RecapRecord | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{
    date: string;
    kept: string;
    slipped: string;
    tomorrow_first: string;
    raw: string;
  }>("SELECT date, kept, slipped, tomorrow_first, raw FROM recaps WHERE date = ?", [
    date,
  ]);
  if (!row) return null;
  return {
    date: row.date,
    kept: row.kept ?? "",
    slipped: row.slipped ?? "",
    tomorrowFirst: row.tomorrow_first ?? "",
    raw: row.raw ?? "",
  };
}

export async function yesterdayRecap(): Promise<RecapRecord | null> {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getRecap(todayKey(d));
}

export async function addRefusal(text: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    "INSERT INTO refusals (text, created_at) VALUES (?, ?)",
    [text, new Date().toISOString()]
  );
}

export async function listRefusals(limit = 20): Promise<string[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ text: string }>(
    "SELECT text FROM refusals ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return rows.map((r) => r.text);
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
  ]);
  return {
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
  };
}
