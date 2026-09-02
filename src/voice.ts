import * as Speech from "expo-speech";

let voiceId: string | undefined;
let warmed = false;

function scoreVoice(v: Speech.Voice): number {
  const blob = `${v.language} ${v.name}`.toLowerCase();
  let n = 0;
  if (blob.includes("en-gb") || blob.includes("gb") || blob.includes("uk")) n += 8;
  if (blob.startsWith("en")) n += 2;
  if (v.quality === Speech.VoiceQuality.Enhanced) n += 5;
  if (/(daniel|george|arthur|brian|rishi|male|baritone|british)/i.test(v.name)) n += 6;
  if (/(female|woman|samantha|karen|moira|tessa)/i.test(v.name)) n -= 6;
  return n;
}

export async function warmVoice(): Promise<void> {
  if (warmed) return;
  warmed = true;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    voiceId = ranked[0]?.identifier;
  } catch {
    voiceId = undefined;
  }
}

export function speakNatural(text: string, muted: boolean): void {
  if (muted || !text.trim()) return;
  Speech.stop();
  Speech.speak(text.trim(), {
    language: "en-GB",
    pitch: 0.9,
    rate: 0.88,
    voice: voiceId,
  });
}
