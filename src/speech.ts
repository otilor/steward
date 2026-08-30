import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Speech from "expo-speech";
import { useRef, useState } from "react";
import { Platform } from "react-native";
import { transcribeWav, warmParakeet } from "./parakeet";

export function stopSpeaking(): void {
  Speech.stop();
}

export function speak(text: string, muted: boolean): void {
  if (muted || !text.trim()) return;
  Speech.stop();
  Speech.speak(text, { language: "en-US", rate: 0.95, pitch: 0.95 });
}

const PARAKEET_REC = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
};

export function useHoldToTalk(onFinal: (transcript: string) => void): {
  listening: boolean;
  partial: string;
  start: () => Promise<void>;
  stop: () => void;
} {
  const recorder = useAudioRecorder(PARAKEET_REC);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const busy = useRef(false);

  const start = async () => {
    if (Platform.OS === "web" || busy.current) return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return;
    Speech.stop();
    await warmParakeet();
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
    });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPartial("");
    setListening(true);
  };

  const stop = () => {
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        setListening(false);
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        const uri = recorder.uri;
        if (!uri) return;
        setPartial("Transcribing with Parakeet…");
        const text = await transcribeWav(uri);
        if (text) onFinal(text);
      } catch (e) {
        setPartial(e instanceof Error ? e.message : "Transcription failed");
      } finally {
        setPartial("");
        busy.current = false;
      }
    })();
  };

  return { listening, partial, start, stop };
}
