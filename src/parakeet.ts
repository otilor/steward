import type { LoadState } from "./llmMeta";
import { PARAKEET_MODEL } from "./sttMeta";

export { PARAKEET_MODEL };

export async function warmParakeet(
  _onState?: (s: LoadState) => void
): Promise<void> {
  throw new Error("Parakeet STT runs on device. Use the iOS or Android build.");
}

export async function transcribeWav(_uri: string): Promise<string> {
  throw new Error("On-device Parakeet only.");
}
