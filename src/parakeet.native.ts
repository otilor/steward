import { Platform } from "react-native";
import { CactusSTT } from "cactus-react-native";
import type { LoadState } from "./llmMeta";
import { PARAKEET_MODEL } from "./sttMeta";

export { PARAKEET_MODEL } from "./sttMeta";

const SLUGS = [PARAKEET_MODEL, "parakeet-ctc-0.6b"];

let stt: CactusSTT | null = null;
let warming: Promise<void> | null = null;

async function loadEngine(onProgress: (p: number) => void): Promise<CactusSTT> {
  const proTries = Platform.OS === "ios" ? [true, false] : [false];
  let last: unknown;
  for (const slug of SLUGS) {
    for (const pro of proTries) {
      const engine = new CactusSTT({
        model: slug,
        options: { quantization: "int8", pro },
      });
      try {
        await engine.download({ onProgress });
        await engine.init();
        return engine;
      } catch (e) {
        last = e;
      }
    }
  }
  throw last instanceof Error
    ? last
    : new Error("Could not load Parakeet via Cactus");
}

export async function warmParakeet(
  onState?: (s: LoadState) => void
): Promise<void> {
  if (stt) {
    onState?.({
      phase: "ready",
      pct: 100,
      message: `On this device · ${PARAKEET_MODEL}`,
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
        message: "Looking for NVIDIA Parakeet (Cactus)…",
      });
      emit({
        phase: "downloading",
        pct: 0,
        message: "Downloading Parakeet CTC via Cactus (once, then offline)…",
      });
      stt = await loadEngine((p) =>
        emit({
          phase: "downloading",
          pct: Math.round(p * 100),
          message: `Downloading Parakeet… ${Math.round(p * 100)}%`,
        })
      );
      emit({
        phase: "ready",
        pct: 100,
        message: `On this device · ${PARAKEET_MODEL}`,
      });
    } catch (e) {
      warming = null;
      stt = null;
      emit({
        phase: "error",
        pct: 0,
        message: e instanceof Error ? e.message : "Parakeet failed to load",
      });
      throw e;
    }
  })();
  return warming;
}

const LOCAL_OPTS = {
  useVad: true,
  telemetryEnabled: false,
  cloudHandoffThreshold: 1_000_000,
  maxTokens: 2048,
} as const;

export async function transcribeWav(uri: string): Promise<string> {
  await warmParakeet();
  if (!stt) throw new Error("Parakeet is not loaded");
  const path = decodeURI(uri.replace(/^file:\/\//, ""));
  let result;
  try {
    result = await stt.transcribe({
      audio: path,
      options: { ...LOCAL_OPTS },
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const detail = raw.replace(/^Cactus transcribe failed:\s*/i, "").trim();
    throw new Error(
      detail || "Parakeet could not read the recording. Hold to talk and try again."
    );
  }
  const text = (result?.response ?? "").trim();
  if (!result?.success || !text) {
    throw new Error("Parakeet heard nothing. Try again.");
  }
  return text;
}
