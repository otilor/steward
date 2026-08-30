import { JSON_CONTRACT, STEWARD_CONSTITUTION, UNKNOWNS } from "./constitution";
import { loadMemorySnapshot } from "./db";
import { completeChat } from "./localLlm";
import type { Calling, MemorySnapshot } from "./types";

export function stripSpoken(text: string): string {
  return text.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, "").trim();
}

export function extractJsonObjects(text: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  const fence = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    try {
      objects.push(JSON.parse(m[1]) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }
  if (objects.length === 0) {
    const loose = text.match(/\{[\s\S]*"type"\s*:\s*"(day_plan|recap|memory)"[\s\S]*\}/);
    if (loose) {
      try {
        objects.push(JSON.parse(loose[0]) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }
  return objects;
}

function snapshotBlock(s: MemorySnapshot): string {
  return [
    `Book: ${s.book || "(unknown)"} @ ${s.bookPlace || "?"}`,
    `Prayer theme: ${s.prayerTheme || "(unknown)"}`,
    `Study: ${s.studyTopic || "(unknown)"}`,
    `Startup: ${s.startupNorthStar || "(unknown)"}`,
    `This week's bet: ${s.weekBet || "(unknown)"}`,
    `Refused: ${s.refusals.join("; ") || "none"}`,
    `Yesterday recap: ${
      s.lastRecap
        ? `kept=${s.lastRecap.kept}; slipped=${s.lastRecap.slipped}; tomorrow=${s.lastRecap.tomorrowFirst}`
        : "none"
    }`,
    `Today's plan: ${s.todayPlan ? JSON.stringify(s.todayPlan) : "none yet"}`,
    `Today's check-ins: ${
      s.checkInAnswers.length
        ? s.checkInAnswers.map((c) => `${c.prompt} → ${c.answer}`).join("; ")
        : "none"
    }`,
  ].join("\n");
}

export async function buildSystemPrompt(opts: {
  callingBias: Calling | null;
  mode: "chat" | "plan" | "checkin" | "recap";
  fromExport: string;
  extra?: string;
}): Promise<string> {
  const memory = await loadMemorySnapshot();
  const exportBit = opts.fromExport.replace("_No export ingested yet._", "").slice(0, 800);
  const parts = [
    STEWARD_CONSTITUTION,
    JSON_CONTRACT,
    UNKNOWNS,
    "## Memory now\n" + snapshotBlock(memory),
    exportBit ? "## From Claude export\n" + exportBit : "",
    opts.callingBias
      ? `Bias this turn toward: ${opts.callingBias} (still suggest one action).`
      : "",
    opts.mode === "plan"
      ? "This turn is MORNING PLAN. Speak a tight plan covering read, pray, study, and build with times. Then emit day_plan JSON."
      : "",
    opts.mode === "checkin"
      ? "This turn is a CHECK-IN. Speak one short question about the current block. Listen for done / slipped / smaller step / not now."
      : "",
    opts.mode === "recap"
      ? "This turn is NIGHT RECAP. Speak ~30 seconds: kept, slipped, tomorrow's first move. Then emit recap JSON."
      : "",
    opts.extra ?? "",
    "You run fully on-device. Be brief.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export async function askSteward(input: {
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  callingBias: Calling | null;
  mode: "chat" | "plan" | "checkin" | "recap";
  fromExport: string;
  extra?: string;
}): Promise<string> {
  const system = await buildSystemPrompt({
    callingBias: input.callingBias,
    mode: input.mode,
    fromExport: input.fromExport,
    extra: input.extra,
  });
  const messages = [
    ...input.history.slice(-8).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.role === "assistant" ? stripSpoken(m.content) : m.content,
    })),
    { role: "user" as const, content: input.userText },
  ];
  const nPredict = input.mode === "plan" || input.mode === "recap" ? 700 : 350;
  return completeChat({ system, messages, nPredict });
}
