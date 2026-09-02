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
import { speakNatural } from "./voice";

export function stopSpeaking(): void {
  Speech.stop();
}

export function speak(text: string, muted: boolean): void {
  speakNatural(text, muted);
}

const REC_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16000,
  numberOfChannels: 1,
};

export function useHoldToTalk(onFinal: (transcript: string) => void): {
  listening: boolean;
  partial: string;
  start: () => Promise<void>;
  stop: () => void;
} {
  const recorder = useAudioRecorder(REC_OPTIONS);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const busy = useRef(false);
  const starting = useRef(false);

  const start = async () => {
    if (Platform.OS === "web" || busy.current || starting.current) return;
    starting.current = true;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPartial("Mic permission denied");
        return;
      }
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
    } catch (e) {
      setPartial(e instanceof Error ? e.message : "Could not start mic");
    } finally {
      starting.current = false;
    }
  };

  const stop = () => {
    if (busy.current || !listening) return;
    busy.current = true;
    void (async () => {
      try {
        setListening(false);
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        const uri = recorder.uri;
        if (!uri) {
          setPartial("");
          return;
        }
        setPartial("Transcribing…");
        const text = await transcribeWav(uri);
        if (text) {
          setPartial(text);
          onFinal(text);
        } else {
          setPartial("Heard nothing. Try again.");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Transcription failed";
        setPartial(msg.trim() || "Transcription failed");
      } finally {
        busy.current = false;
      }
    })();
  };

  return { listening, partial, start, stop };
}
