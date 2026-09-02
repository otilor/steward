import { Platform } from "react-native";
import { CactusLM, type CactusLMMessage } from "cactus-react-native";
import {
  FALLBACK_MODEL_ID,
  MODEL_ID,
  type LoadState,
} from "./llmMeta";

export {
  FALLBACK_MODEL_ID,
  idleLoad,
  MODEL_ID,
  type LoadPhase,
  type LoadState,
} from "./llmMeta";

let lm: CactusLM | null = null;
let warming: Promise<void> | null = null;
let activeModel = MODEL_ID;

const SLUGS = [MODEL_ID, FALLBACK_MODEL_ID];

async function loadEngine(
  onProgress: (p: number) => void
): Promise<{ engine: CactusLM; slug: string }> {
  const proTries = Platform.OS === "ios" ? [true, false] : [false];
  let last: unknown;
  for (const slug of SLUGS) {
    for (const pro of proTries) {
      const quants = slug.includes("gemma")
        ? (["int8"] as const)
        : (["int4"] as const);
      for (const quant of quants) {
        const engine = new CactusLM({
          model: slug,
          cacheIndex: false,
          options: { quantization: quant, pro },
        });
        try {
          await engine.download({ onProgress });
          await engine.init();
          return { engine, slug };
        } catch (e) {
          last = e;
        }
      }
    }
  }
  throw last instanceof Error
    ? last
    : new Error("Could not load CactusLM on-device");
}

export async function warmSteward(
  onState?: (s: LoadState) => void
): Promise<void> {
  if (lm && activeModel !== MODEL_ID) {
    try {
      await lm.destroy();
    } catch {
      /* swap */
    }
    lm = null;
    warming = null;
  }
  if (lm) {
    onState?.({
      phase: "ready",
      pct: 100,
      message: `On this device · ${activeModel}`,
    });
    return;
  }
  if (warming) return warming;
  warming = (async () => {
    const emit = (s: LoadState) => onState?.(s);
    try {
      emit({
        phase: "checking",
        pct: 0,
        message: `Looking for ${MODEL_ID} (Cactus)…`,
      });
      emit({
        phase: "downloading",
        pct: 0,
        message: `Downloading ${MODEL_ID} via Cactus (once, then offline)…`,
      });
      const res = await loadEngine((p) =>
        emit({
          phase: "downloading",
          pct: Math.round(p * 100),
          message: `Downloading model… ${Math.round(p * 100)}%`,
        })
      );
      lm = res.engine;
      activeModel = res.slug;
      try {
        await lm.prefill({
          messages: [{ role: "system", content: "You are Steward. Be brief." }],
        });
      } catch {
        /* warmup only */
      }
      emit({
        phase: "ready",
        pct: 100,
        message: `On this device · ${activeModel}`,
      });
    } catch (e) {
      lm = null;
      warming = null;
      emit({
        phase: "error",
        pct: 0,
        message:
          e instanceof Error ? e.message : "Failed to load on-device model",
      });
      throw e;
    }
  })();
  return warming;
}

export type InferenceStats = {
  timeToFirstTokenMs: number;
  prefillTokens: number;
  prefillTps: number;
  decodeTokens: number;
  decodeTps: number;
  totalTimeMs: number;
};

let lastStats: InferenceStats | null = null;

export function getLastInferenceStats(): InferenceStats | null {
  return lastStats;
}

const LOCAL_LM_OPTS: import("cactus-react-native").CactusLMCompleteOptions = {
  telemetryEnabled: false,
  enableThinking: false,
  temperature: 0,
  topP: 1,
  topK: 1,
  stopSequences: ["<|im_end|>", "<end_of_turn>", "<|eot_id|>", "</s>"],
};

export async function completeChat(input: {
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  nPredict?: number;
  onToken?: (token: string) => void;
}): Promise<string> {
  await warmSteward();
  if (!lm) throw new Error("Model is not loaded");

  const formattedMessages: CactusLMMessage[] = [
    { role: "system", content: input.system },
    ...input.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  const result = await lm.complete({
    messages: formattedMessages,
    options: {
      ...LOCAL_LM_OPTS,
      maxTokens: input.nPredict ?? 80,
    },
    onToken: input.onToken,
  });

  lastStats = {
    timeToFirstTokenMs: result.timeToFirstTokenMs ?? 0,
    prefillTokens: result.prefillTokens ?? 0,
    prefillTps: result.prefillTps ?? 0,
    decodeTokens: result.decodeTokens ?? 0,
    decodeTps: result.decodeTps ?? 0,
    totalTimeMs: result.totalTimeMs ?? 0,
  };

  const text = (result?.response ?? "").trim();
  if (!text) throw new Error("Empty reply from on-device model");
  return text;
}
