import { type LoadState } from "./llmMeta";

export {
  idleLoad,
  MODEL_FILE,
  MODEL_ID,
  MODEL_URL,
  type LoadPhase,
  type LoadState,
} from "./llmMeta";

export async function warmSteward(
  _onState?: (s: LoadState) => void
): Promise<void> {
  throw new Error(
    "Steward’s mind runs on your phone. Use an iOS or Android development build — not Expo Go or web."
  );
}

export async function completeChat(_input: {
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  nPredict?: number;
}): Promise<string> {
  throw new Error("On-device only. Open the iOS or Android build.");
}
