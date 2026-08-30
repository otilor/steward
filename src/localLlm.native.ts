import * as FileSystem from "expo-file-system/legacy";
import { initLlama, type LlamaContext } from "llama.rn";
import {
  MODEL_FILE,
  MODEL_URL,
  type LoadState,
} from "./llmMeta";

export {
  idleLoad,
  MODEL_FILE,
  MODEL_ID,
  MODEL_URL,
  type LoadPhase,
  type LoadState,
} from "./llmMeta";

let context: LlamaContext | null = null;
let warming: Promise<void> | null = null;

function modelPath(): string {
  const dir = FileSystem.documentDirectory ?? "";
  return `${dir}${MODEL_FILE}`;
}

export async function warmSteward(
  onState?: (s: LoadState) => void
): Promise<void> {
  if (context) {
    onState?.({ phase: "ready", pct: 100, message: "On this device" });
    return;
  }
  if (warming) return warming;
  warming = (async () => {
    const emit = (s: LoadState) => onState?.(s);
    try {
      emit({ phase: "checking", pct: 0, message: "Looking for the on-device model…" });
      const path = modelPath();
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        emit({
          phase: "downloading",
          pct: 0,
          message: "Downloading Llama 3.2 1B (~0.8 GB). One time, then fully offline.",
        });
        const tmp = `${path}.part`;
        const dl = FileSystem.createDownloadResumable(
          MODEL_URL,
          tmp,
          {},
          (prog) => {
            const pct =
              prog.totalBytesExpectedToWrite > 0
                ? Math.round(
                    (prog.totalBytesWritten / prog.totalBytesExpectedToWrite) * 100
                  )
                : 0;
            emit({
              phase: "downloading",
              pct,
              message: `Downloading model… ${pct}%`,
            });
          }
        );
        await dl.downloadAsync();
        await FileSystem.moveAsync({ from: tmp, to: path });
      }
      emit({ phase: "loading", pct: 90, message: "Loading model into memory…" });
      context = await initLlama({
        model: path,
        n_ctx: 2048,
        n_gpu_layers: 99,
        use_mlock: true,
      });
      emit({ phase: "ready", pct: 100, message: "On this device" });
    } catch (e) {
      context = null;
      warming = null;
      emit({
        phase: "error",
        pct: 0,
        message: e instanceof Error ? e.message : "Failed to load on-device model",
      });
      throw e;
    }
  })();
  return warming;
}

const STOP = [
  "</s>",
  "<|eot_id|>",
  "<|end_of_text|>",
  "<|im_end|>",
  "<|end|>",
];

export async function completeChat(input: {
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  nPredict?: number;
}): Promise<string> {
  await warmSteward();
  if (!context) throw new Error("Model is not loaded");
  const result = await context.completion({
    messages: [
      { role: "system", content: input.system },
      ...input.messages,
    ],
    n_predict: input.nPredict ?? 400,
    temperature: 0.6,
    stop: STOP,
  });
  const text = (result?.text ?? "").trim();
  if (!text) throw new Error("Empty reply from on-device model");
  return text;
}
