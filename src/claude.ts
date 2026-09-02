import { JSON_CONTRACT, STEWARD_INFERENCE } from "./constitution";
import { loadMemorySnapshot } from "./db";
import { completeChat } from "./localLlm";
import { loadLivePersona, promptBlock } from "./persona";
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

function clip(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

function snapshotBlock(s: MemorySnapshot): string {
  const lines: string[] = [];
  if (s.nowFocus) lines.push(`Focus: ${s.nowFocus}`);
  if (s.book) lines.push(`Book: ${s.book}${s.bookPlace ? ` @ ${s.bookPlace}` : ""}`);
  if (s.prayerTheme) lines.push(`Prayer: ${s.prayerTheme}`);
  if (s.studyTopic) lines.push(`Study: ${clip(s.studyTopic, 120)}`);
  if (s.startupNorthStar) lines.push(`Startup: ${s.startupNorthStar}`);
  if (s.weekBet) lines.push(`Week: ${s.weekBet}`);
  if (s.refusals.length) lines.push(`Refused: ${s.refusals.join("; ")}`);
  if (s.lastRecap) {
    lines.push(`Yesterday: ${clip(s.lastRecap.tomorrowFirst || s.lastRecap.kept, 80)}`);
  }
  if (s.todayPlan) {
    lines.push(
      `Today: ${s.todayPlan.blocks.map((b) => `${b.start} ${b.calling}`).join("; ")}`
    );
  }
  return lines.join("\n");
}

export async function buildSystemPrompt(opts: {
  callingBias: Calling | null;
  mode: "chat" | "plan" | "checkin" | "recap";
  extra?: string;
}): Promise<string> {
  const [memory, persona] = await Promise.all([loadMemorySnapshot(), loadLivePersona()]);
  const parts = [
    STEWARD_INFERENCE,
    promptBlock(persona),
    snapshotBlock(memory),
    opts.mode === "plan" || opts.mode === "recap" ? JSON_CONTRACT : "",
    opts.callingBias ? `Lean ${opts.callingBias}. One action.` : "",
    opts.mode === "plan" ? "Morning plan. Spoken first, then day_plan JSON." : "",
    opts.mode === "checkin" ? "One spoken line. No JSON." : "",
    opts.mode === "recap" ? "Night recap, ~20s spoken, then recap JSON." : "",
    opts.mode === "chat" ? "One or two spoken sentences. No JSON unless you learned a new fact." : "",
    opts.extra ?? "",
  ];
  return parts.filter(Boolean).join("\n\n");
}

export async function askSteward(input: {
  userText: string;
  history: { role: "user" | "assistant"; content: string }[];
  callingBias: Calling | null;
  mode: "chat" | "plan" | "checkin" | "recap";
  extra?: string;
  onToken?: (token: string) => void;
}): Promise<string> {
  const system = await buildSystemPrompt({
    callingBias: input.callingBias,
    mode: input.mode,
    extra: input.extra,
  });
  const messages = [
    ...input.history.slice(-4).map((m) => ({
      role: m.role as "user" | "assistant",
      content: clip(
        m.role === "assistant" ? stripSpoken(m.content) : m.content,
        220
      ),
    })),
    { role: "user" as const, content: clip(input.userText, 400) },
  ];
  const nPredict =
    input.mode === "plan" ? 160 : input.mode === "recap" ? 120 : input.mode === "checkin" ? 48 : 56;
  return completeChat({ system, messages, nPredict, onToken: input.onToken });
}
