import { type LoadState } from "./llmMeta";

export {
  FALLBACK_MODEL_ID,
  idleLoad,
  MODEL_ID,
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
  onToken?: (token: string) => void;
}): Promise<string> {
  throw new Error("On-device only. Open the iOS or Android build.");
}

export type InferenceStats = {
  timeToFirstTokenMs: number;
  prefillTokens: number;
  prefillTps: number;
  decodeTokens: number;
  decodeTps: number;
  totalTimeMs: number;
};

export function getLastInferenceStats(): InferenceStats | null {
  return null;
}
