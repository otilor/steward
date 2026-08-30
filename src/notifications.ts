import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { clearPendingCheckIns, insertCheckIn, kvGet, todayKey } from "./db";
import type { DayPlan, NotificationKind, PendingOpen } from "./types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const MORNING_ID = "steward-morning";
const RECAP_ID = "steward-recap";

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("steward", {
      name: "Steward",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  return status === "granted";
}

function dailyTrigger(hour: number, minute: number) {
  return {
    type: Notifications.SchedulableTriggerInputTypes.DAILY as const,
    hour,
    minute,
  };
}

export async function scheduleDailyBeats(): Promise<void> {
  if (Platform.OS === "web") return;
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const wakeH = Number((await kvGet("wake_hour")) || "7");
  const wakeM = Number((await kvGet("wake_minute")) || "0");
  const recapH = Number((await kvGet("recap_hour")) || "21");
  const recapM = Number((await kvGet("recap_minute")) || "30");

  await Notifications.cancelScheduledNotificationAsync(MORNING_ID).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(RECAP_ID).catch(() => undefined);

  await Notifications.scheduleNotificationAsync({
    identifier: MORNING_ID,
    content: {
      title: "Steward",
      body: "Plan the day when you’re ready.",
      data: { kind: "morning" satisfies NotificationKind },
    },
    trigger: dailyTrigger(wakeH, wakeM),
  });

  await Notifications.scheduleNotificationAsync({
    identifier: RECAP_ID,
    content: {
      title: "Steward",
      body: "Recap when you’re ready.",
      data: { kind: "recap" satisfies NotificationKind },
    },
    trigger: dailyTrigger(recapH, recapM),
  });
}

function dateFromHm(hm: string): Date | null {
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

export async function schedulePlanCheckIns(plan: DayPlan): Promise<void> {
  if (Platform.OS === "web") return;
  const granted = await requestNotificationPermission();
  if (!granted) return;

  const existing = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of existing) {
    const kind = (n.content.data as { kind?: string } | null)?.kind;
    if (kind === "checkin" || kind === "followup") {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }

  const now = Date.now();
  await clearPendingCheckIns(plan.date);
  for (const block of plan.blocks) {
    const start = dateFromHm(block.start);
    if (!start) continue;
    const prompt = `${capitalize(block.calling)} block — still on ${block.outcome}?`;
    await insertCheckIn({
      date: plan.date,
      blockId: block.id,
      kind: "checkin",
      prompt,
    });

    if (start.getTime() > now + 15_000) {
      await Notifications.scheduleNotificationAsync({
        identifier: `checkin-${plan.date}-${block.id}`,
        content: {
          title: "Steward",
          body: prompt,
          data: {
            kind: "checkin" satisfies NotificationKind,
            blockId: block.id,
            prompt,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: start,
        },
      });
    }

    const follow = new Date(start.getTime() + 30 * 60 * 1000);
    if (block.minutes >= 45 && follow.getTime() > now + 15_000) {
      await Notifications.scheduleNotificationAsync({
        identifier: `followup-${plan.date}-${block.id}`,
        content: {
          title: "Steward",
          body: `Still with you on ${block.outcome}? No rush.`,
          data: {
            kind: "followup" satisfies NotificationKind,
            blockId: block.id,
            prompt: `Quieter follow-up: ${block.outcome}`,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: follow,
        },
      });
    }
  }
}

export async function scheduleTestCheckIn(prompt: string): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Steward",
      body: prompt,
      data: { kind: "checkin" satisfies NotificationKind, prompt },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
    },
  });
}

export function pendingFromNotification(
  response: Notifications.NotificationResponse | null
): PendingOpen | null {
  if (!response) return null;
  const data = response.notification.request.content.data as {
    kind?: NotificationKind;
    blockId?: string;
    prompt?: string;
  };
  if (!data?.kind) return null;
  return {
    kind: data.kind,
    blockId: data.blockId,
    prompt: data.prompt ?? response.notification.request.content.body ?? undefined,
  };
}

export function nextBlockLabel(plan: DayPlan | null): string {
  if (!plan?.blocks.length) return "No plan yet — tap Plan today";
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const upcoming =
    plan.blocks.find((b) => b.start >= hm) ?? plan.blocks[plan.blocks.length - 1];
  return `${upcoming.start} ${upcoming.calling} — ${upcoming.outcome}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { todayKey };
