import { speak } from "./speech";

/** Speaks complete sentences as tokens arrive so voice starts before generation finishes. */
export function createReplyStreamer(muted: boolean): {
  onToken: (token: string) => void;
  finish: () => string;
} {
  let raw = "";
  let spokenChars = 0;

  const visible = () =>
    raw.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*$/g, "");

  const pump = (force: boolean) => {
    const v = visible();
    const unsent = v.slice(spokenChars);
    if (force) {
      const t = unsent.trim();
      if (t) speak(t, muted);
      spokenChars = v.length;
      return;
    }
    const m = unsent.match(/^([\s\S]{12,}?[.!?])(?:\s+|$)/);
    if (!m) return;
    speak(m[1].trim(), muted);
    spokenChars += m[0].length;
  };

  return {
    onToken(token: string) {
      raw += token;
      pump(false);
    },
    finish() {
      pump(true);
      return raw.trim();
    },
  };
}
