export type Calling = "read" | "pray" | "study" | "build";

export type PlanBlock = {
  id: string;
  start: string;
  minutes: number;
  calling: Calling;
  outcome: string;
};

export type DayPlan = {
  type: "day_plan";
  date: string;
  blocks: PlanBlock[];
};

export type RecapRecord = {
  date: string;
  kept: string;
  slipped: string;
  tomorrowFirst: string;
  raw: string;
};

export type ChatMessage = {
  id?: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type MemorySnapshot = {
  book: string;
  bookPlace: string;
  prayerTheme: string;
  studyTopic: string;
  startupNorthStar: string;
  weekBet: string;
  nowFocus: string;
  interests: { id: string; label: string; weight: number }[];
  refusals: string[];
  todayPlan: DayPlan | null;
  lastRecap: RecapRecord | null;
  checkInAnswers: { prompt: string; answer: string }[];
};

export type NotificationKind = "morning" | "checkin" | "recap" | "followup";

export type PendingOpen = {
  kind: NotificationKind;
  blockId?: string;
  prompt?: string;
};
