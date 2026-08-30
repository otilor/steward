import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { askSteward, stripSpoken } from "./src/claude";
import {
  addMessage,
  answerCheckIn,
  getDayPlan,
  kvGet,
  kvSet,
  loadMemorySnapshot,
  pendingCheckInForBlock,
  recentMessages,
  todayKey,
} from "./src/db";
import { FROM_EXPORT } from "./src/fromExport";
import {
  nextBlockLabel,
  pendingFromNotification,
  scheduleDailyBeats,
  scheduleTestCheckIn,
} from "./src/notifications";
import { applyStewardPayloads } from "./src/payloads";
import { idleLoad, MODEL_ID, warmSteward, type LoadState } from "./src/localLlm";
import { PARAKEET_MODEL, warmParakeet } from "./src/parakeet";
import { speak, useHoldToTalk } from "./src/speech";
import type { Calling, ChatMessage, DayPlan, PendingOpen } from "./src/types";

const CALLINGS: { id: Calling; label: string }[] = [
  { id: "read", label: "Read" },
  { id: "pray", label: "Pray" },
  { id: "study", label: "Study" },
  { id: "build", label: "Build" },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [bias, setBias] = useState<Calling | null>(null);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [model, setModel] = useState<LoadState>(idleLoad);
  const [stt, setStt] = useState<LoadState>(idleLoad);
  const [pending, setPending] = useState<PendingOpen | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const send = useCallback(
    async (
      text: string,
      mode: "chat" | "plan" | "checkin" | "recap" = "chat",
      extra?: string
    ) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setError("");
      if (Platform.OS === "web") {
        setError("Steward runs on your phone, fully on-device. Use the iOS or Android build.");
        return;
      }
      if (model.phase !== "ready") {
        setError(model.message || "Wait for the on-device model to finish loading.");
        return;
      }
      setBusy(true);
      setDraft("");
      await addMessage("user", trimmed);
      setMessages((m) => [
        ...m,
        { role: "user", content: trimmed, createdAt: new Date().toISOString() },
      ]);
      try {
        const history = await recentMessages(20);
        const reply = await askSteward({
          userText: trimmed,
          history: history.slice(0, -1),
          callingBias: bias,
          mode,
          fromExport: FROM_EXPORT,
          extra,
        });
        await addMessage("assistant", reply);
        await applyStewardPayloads(reply);
        if (
          (mode === "checkin" || pending?.kind === "checkin" || pending?.kind === "followup") &&
          pending?.blockId
        ) {
          const row = await pendingCheckInForBlock(todayKey(), pending.blockId);
          if (row) await answerCheckIn(row.id, trimmed);
        }
        const spoken = stripSpoken(reply);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: reply,
            createdAt: new Date().toISOString(),
          },
        ]);
        speak(spoken, mutedRef.current);
        setPlan(await getDayPlan(todayKey()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Steward failed");
      } finally {
        setBusy(false);
      }
    },
    [bias, busy, pending, model.phase]
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  const { listening, partial, start, stop } = useHoldToTalk((transcript) => {
    void sendRef.current(transcript, pending?.kind === "checkin" || pending?.kind === "followup" ? "checkin" : "chat");
  });

  useEffect(() => {
    void (async () => {
      await kvSet("last_heard_at", new Date().toISOString());
      const [msgs, p, mute] = await Promise.all([
        recentMessages(30),
        getDayPlan(todayKey()),
        kvGet("muted"),
      ]);
      setMessages(msgs);
      setPlan(p);
      setMuted(mute === "1");
      await scheduleDailyBeats();
      if (Platform.OS !== "web") {
        try {
          const last = await Notifications.getLastNotificationResponseAsync();
          const opened = pendingFromNotification(last);
          if (opened) setPending(opened);
        } catch {
          /* native-only */
        }
      }
      setReady(true);
    })();

    const sub =
      Platform.OS === "web"
        ? { remove: () => undefined }
        : Notifications.addNotificationResponseReceivedListener((res) => {
            const opened = pendingFromNotification(res);
            if (opened) setPending(opened);
          });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      setModel({
        phase: "error",
        pct: 0,
        message: "On-device only — use the iOS or Android build.",
      });
      setStt({
        phase: "error",
        pct: 0,
        message: "Parakeet STT is on-device only.",
      });
      return;
    }
    void warmSteward(setModel).catch((e) =>
      setModel({
        phase: "error",
        pct: 0,
        message: e instanceof Error ? e.message : "Model failed",
      })
    );
    void warmParakeet(setStt).catch((e) =>
      setStt({
        phase: "error",
        pct: 0,
        message: e instanceof Error ? e.message : "Parakeet failed",
      })
    );
  }, []);

  useEffect(() => {
    if (!ready || !pending) return;
    const run = async () => {
      const mem = await loadMemorySnapshot();
      if (pending.kind === "morning") {
        speak(
          "Good morning. Hold the mic and we'll plan the day — or tap Plan today.",
          mutedRef.current
        );
        return;
      }
      if (pending.kind === "recap") {
        speak(
          "When you're ready, we'll recap. Tap Recap tonight, or hold the mic.",
          mutedRef.current
        );
        return;
      }
      const prompt =
        pending.prompt ||
        mem.todayPlan?.blocks.find((b) => b.id === pending.blockId)?.outcome ||
        "How is this block going?";
      speak(prompt, mutedRef.current);
    };
    void run();
  }, [ready, pending]);

  const lastSpoken = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last ? stripSpoken(last.content) : "Hold the mic. I'll listen, then speak.";
  }, [messages]);

  if (!ready) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color="#C4A574" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <StatusBar style="light" />
      <View style={styles.top}>
        <View>
          <Text style={styles.wordmark}>Steward</Text>
          <Text style={styles.planStrip}>{nextBlockLabel(plan)}</Text>
          <Text style={styles.modelLine}>
            {model.phase === "ready"
              ? `Mind · ${MODEL_ID}`
              : model.message}
          </Text>
          <Text style={styles.modelLine}>
            {stt.phase === "ready"
              ? `Listen · NVIDIA Parakeet (${PARAKEET_MODEL})`
              : stt.message}
          </Text>
        </View>
        <Pressable onPress={() => setSettings(true)} hitSlop={12} accessibilityLabel="Settings">
          <Text style={styles.gear}>Settings</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {CALLINGS.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setBias((b) => (b === c.id ? null : c.id))}
            style={[styles.chip, bias === c.id && styles.chipOn]}
            accessibilityLabel={c.label}
          >
            <Text style={[styles.chipText, bias === c.id && styles.chipTextOn]}>
              {c.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.thread}
        contentContainerStyle={styles.threadInner}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.map((m, i) => (
          <View
            key={m.id ?? i}
            style={[styles.bubble, m.role === "user" ? styles.user : styles.assistant]}
          >
            <Text style={styles.bubbleText}>
              {m.role === "assistant" ? stripSpoken(m.content) : m.content}
            </Text>
          </View>
        ))}
        {listening && partial ? (
          <Text style={styles.partial}>{partial}</Text>
        ) : null}
      </ScrollView>

      <Text style={styles.lastLine}>{lastSpoken}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          style={styles.smallBtn}
          accessibilityLabel="Plan today"
          onPress={() =>
            void send(
              "Plan today across read, pray, study, and build. Leave slack.",
              "plan"
            )
          }
        >
          <Text style={styles.smallBtnText}>Plan today</Text>
        </Pressable>
        <Pressable
          style={styles.smallBtn}
          accessibilityLabel="Recap tonight"
          onPress={() =>
            void send(
              "Night recap: what we kept, what slipped, tomorrow's first move.",
              "recap"
            )
          }
        >
          <Text style={styles.smallBtnText}>Recap tonight</Text>
        </Pressable>
        <Pressable
          style={styles.smallBtn}
          accessibilityLabel={muted ? "Voice off" : "Voice on"}
          onPress={async () => {
            const next = !muted;
            setMuted(next);
            await kvSet("muted", next ? "1" : "0");
          }}
        >
          <Text style={styles.smallBtnText}>{muted ? "Voice off" : "Voice on"}</Text>
        </Pressable>
      </View>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type if you can't talk…"
          placeholderTextColor="#6F6A64"
          onSubmitEditing={() => void send(draft)}
          returnKeyType="send"
        />
        <Pressable
          style={styles.send}
          onPress={() => void send(draft)}
          disabled={busy}
          accessibilityLabel="Send"
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>

      <Pressable
        onPressIn={() => void start()}
        onPressOut={stop}
        style={[styles.mic, listening && styles.micOn]}
        accessibilityLabel="Hold to talk"
      >
        <Text style={styles.micText}>{listening ? "Listening…" : "Hold to talk"}</Text>
      </Pressable>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color="#C4A574" />
        </View>
      ) : null}

      <Modal visible={settings} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modal}>
            <Text style={styles.wordmark}>Settings</Text>
            <Text style={styles.hint}>
              No cloud LLMs and no cloud speech. Cactus runs NVIDIA Parakeet on this phone.
              The STT model downloads once, then works offline. Telemetry and cloud handoff
              are off.
            </Text>
            <Text style={styles.hint}>{model.message}</Text>
            <Text style={styles.hint}>{stt.message}</Text>
            {model.phase === "downloading" ||
            model.phase === "loading" ||
            stt.phase === "downloading" ||
            stt.phase === "loading" ? (
              <ActivityIndicator color="#C4A574" />
            ) : null}
            {model.phase === "error" && Platform.OS !== "web" ? (
              <Pressable
                style={styles.smallBtn}
                accessibilityLabel="Retry model"
                onPress={() =>
                  void warmSteward(setModel).catch((e) =>
                    setModel({
                      phase: "error",
                      pct: 0,
                      message: e instanceof Error ? e.message : "Model failed",
                    })
                  )
                }
              >
                <Text style={styles.smallBtnText}>Retry on-device model</Text>
              </Pressable>
            ) : null}
            {stt.phase === "error" && Platform.OS !== "web" ? (
              <Pressable
                style={styles.smallBtn}
                accessibilityLabel="Retry Parakeet"
                onPress={() =>
                  void warmParakeet(setStt).catch((e) =>
                    setStt({
                      phase: "error",
                      pct: 0,
                      message: e instanceof Error ? e.message : "Parakeet failed",
                    })
                  )
                }
              >
                <Text style={styles.smallBtnText}>Retry Parakeet STT</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={styles.smallBtn}
              accessibilityLabel="Test check-in in 5s"
              onPress={() =>
                void scheduleTestCheckIn("Build block — still on the next ship?")
              }
            >
              <Text style={styles.smallBtnText}>Test check-in in 5s</Text>
            </Pressable>
            <Pressable onPress={() => setSettings(false)} accessibilityLabel="Close settings">
              <Text style={styles.gear}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0E1114", paddingTop: 56, paddingHorizontal: 16 },
  center: { alignItems: "center", justifyContent: "center" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  wordmark: { color: "#E8E4DC", fontSize: 22, fontWeight: "600", letterSpacing: 0.4 },
  planStrip: { color: "#C4A574", marginTop: 4, fontSize: 13, maxWidth: 260 },
  modelLine: { color: "#8B8680", marginTop: 4, fontSize: 11, maxWidth: 280 },
  gear: { color: "#8B8680", fontSize: 13, marginTop: 6 },
  chips: { flexDirection: "row", gap: 8, marginTop: 16 },
  chip: {
    borderColor: "#2A3138",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: "#C4A574", borderColor: "#C4A574" },
  chipText: { color: "#E8E4DC", fontSize: 13 },
  chipTextOn: { color: "#0E1114", fontWeight: "600" },
  thread: { flex: 1, marginTop: 16 },
  threadInner: { paddingBottom: 12, gap: 8 },
  bubble: { borderRadius: 12, padding: 10, maxWidth: "92%" },
  user: { alignSelf: "flex-end", backgroundColor: "#243018" },
  assistant: { alignSelf: "flex-start", backgroundColor: "#1A1F24" },
  bubbleText: { color: "#E8E4DC", fontSize: 15, lineHeight: 21 },
  partial: { color: "#8B8680", fontStyle: "italic", marginTop: 8 },
  lastLine: { color: "#8B8680", fontSize: 12, marginTop: 4 },
  error: { color: "#D9786A", fontSize: 12, marginTop: 6 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  smallBtn: {
    borderColor: "#2A3138",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  smallBtnText: { color: "#E8E4DC", fontSize: 13 },
  composer: { flexDirection: "row", gap: 8, marginTop: 10, alignItems: "center" },
  input: {
    flex: 1,
    color: "#E8E4DC",
    borderColor: "#2A3138",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  send: { paddingHorizontal: 12, paddingVertical: 10 },
  sendText: { color: "#C4A574", fontWeight: "600" },
  mic: {
    marginTop: 12,
    marginBottom: 24,
    backgroundColor: "#1A1F24",
    borderRadius: 28,
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#C4A574",
  },
  micOn: { backgroundColor: "#3A2E1C" },
  micText: { color: "#C4A574", fontSize: 16, fontWeight: "600" },
  busy: { position: "absolute", top: 64, right: 20 },
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#14181C",
    padding: 20,
    paddingBottom: 36,
    gap: 12,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  hint: { color: "#8B8680", fontSize: 13, lineHeight: 18 },
});
