export const MODEL_ID = "gemma-3-270m-it";
export const FALLBACK_MODEL_ID = "qwen3-0.6b";

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
