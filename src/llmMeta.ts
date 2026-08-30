export const MODEL_ID = "Llama-3.2-1B-Instruct-Q4_K_M";
export const MODEL_FILE = `${MODEL_ID}.gguf`;
export const MODEL_URL =
  "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf";

export type LoadPhase =
  | "idle"
  | "checking"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

export type LoadState = {
  phase: LoadPhase;
  pct: number;
  message: string;
};

export const idleLoad: LoadState = {
  phase: "idle",
  pct: 0,
  message: "On-device model not loaded",
};
