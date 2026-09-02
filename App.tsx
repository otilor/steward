import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { askSteward, stripSpoken } from "./src/claude";
import { createReplyStreamer } from "./src/streamSpeak";
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
import {
  nextBlockLabel,
  pendingFromNotification,
  scheduleDailyBeats,
  scheduleTestCheckIn,
} from "./src/notifications";
import { applyStewardPayloads } from "./src/payloads";
import {
  getLastInferenceStats,
  idleLoad,
  MODEL_ID,
  warmSteward,
  type LoadState,
} from "./src/localLlm";
import { PARAKEET_MODEL, warmParakeet } from "./src/parakeet";
import { speak, useHoldToTalk } from "./src/speech";
import {
  learnFromUtterance,
  loadLivePersona,
  type LivePersona,
} from "./src/persona";
import { warmVoice } from "./src/voice";
import type { Calling, ChatMessage, DayPlan, PendingOpen } from "./src/types";

function callingForInterest(id: string): Calling {
  if (id === "faith") return "pray";
  if (id === "dissertation") return "study";
  return "build";
}

function hourNow(): number {
  return new Date().getHours();
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [bias, setBias] = useState<Calling | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState(false);
  const [model, setModel] = useState<LoadState>(idleLoad);
  const [stt, setStt] = useState<LoadState>(idleLoad);
  const [lastHeard, setLastHeard] = useState("");
  const [liveReply, setLiveReply] = useState("");
  const [lastStats, setLastStats] = useState("");
  const [pending, setPending] = useState<PendingOpen | null>(null);
  const [persona, setPersona] = useState<LivePersona | null>(null);
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
      Keyboard.dismiss();
      setError("");
      if (Platform.OS === "web") {
        setError("On-device only. Open the phone build.");
        return;
      }
      if (model.phase !== "ready") {
        setError(model.message || "Still loading.");
        return;
      }
      setBusy(true);
      setLiveReply("");
      setDraft("");
      const learned = await learnFromUtterance(trimmed);
      setPersona(learned);
      const userMsgId = await addMessage("user", trimmed);
      setMessages((m) => [
        ...m,
        {
          id: userMsgId,
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        },
      ]);
      try {
        const history = await recentMessages(8);
        const streamer = createReplyStreamer(mutedRef.current);
        const reply = await askSteward({
          userText: trimmed,
          history: history.slice(0, -1),
          callingBias: bias,
          mode,
          extra,
          onToken: (token) => {
            streamer.onToken(token);
            setLiveReply((s) => s + token);
          },
        });
        streamer.finish();
        const stats = getLastInferenceStats();
        if (stats) {
          setLastStats(
            `TTFT ${Math.round(stats.timeToFirstTokenMs)}ms · ${stats.decodeTps.toFixed(0)} tok/s`
          );
        }
        const assistantMsgId = await addMessage("assistant", reply);
        await applyStewardPayloads(reply);
        setPersona(await loadLivePersona());
        if (
          (mode === "checkin" || pending?.kind === "checkin" || pending?.kind === "followup") &&
          pending?.blockId
        ) {
          const row = await pendingCheckInForBlock(todayKey(), pending.blockId);
          if (row) await answerCheckIn(row.id, trimmed);
        }
        setMessages((m) => [
          ...m,
          {
            id: assistantMsgId,
            role: "assistant",
            content: reply,
            createdAt: new Date().toISOString(),
          },
        ]);
        setLiveReply("");
        setPlan(await getDayPlan(todayKey()));
      } catch (e) {
        setLiveReply("");
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
    setLastHeard(transcript);
    const mode =
      pending?.kind === "checkin" || pending?.kind === "followup" ? "checkin" : "chat";
    void sendRef.current(transcript, mode);
  });

  useEffect(() => {
    return () => {};
  }, []);

  useEffect(() => {
    void (async () => {
      await kvSet("last_heard_at", new Date().toISOString());
      const [msgs, p, mute, live] = await Promise.all([
        recentMessages(30),
        getDayPlan(todayKey()),
        kvGet("muted"),
        loadLivePersona(),
      ]);
      setMessages(msgs);
      setPlan(p);
      setMuted(mute === "1");
      setPersona(live);
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
        message: "Listen is on-device only.",
      });
      return;
    }
    void warmVoice();
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
        message: e instanceof Error ? e.message : "Listen failed",
      })
    );
  }, []);

  useEffect(() => {
    if (!ready || !pending || !persona) return;
    const run = async () => {
      const mem = await loadMemorySnapshot();
      if (pending.kind === "morning") {
        speak(`Morning. ${persona.nowFocus}. Hold, and we'll cut the day.`, mutedRef.current);
        return;
      }
      if (pending.kind === "recap") {
        speak("Hold when you want the recap.", mutedRef.current);
        return;
      }
      const prompt =
        pending.prompt ||
        mem.todayPlan?.blocks.find((b) => b.id === pending.blockId)?.outcome ||
        persona.nowFocus;
      speak(prompt, mutedRef.current);
    };
    void run();
  }, [ready, pending, persona]);

  const spoken = useMemo(() => {
    if (liveReply) return stripSpoken(liveReply) || "…";
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (last) return stripSpoken(last.content);
    return persona
      ? `${persona.nowFocus}. Hold, and we'll take the next inch.`
      : "";
  }, [liveReply, messages, persona]);

  const hour = hourNow();
  const showPlan = hour < 11 && !plan;
  const showRecap = hour >= 20;
  const status =
    listening
      ? "Listening"
      : partial.startsWith("Transcribing")
        ? partial
        : lastHeard && busy
          ? lastHeard
          : nextBlockLabel(plan);
  const readyMind = model.phase === "ready" && stt.phase === "ready";

  if (!ready) {
    return (
      <View style={[styles.safe, styles.center]}>
        <ActivityIndicator color="#C9B896" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar style="light" />

        <View style={styles.nav}>
          <Text style={styles.wordmark}>Steward</Text>
          <View style={styles.navRight}>
            <Pressable
              onPress={async () => {
                const next = !muted;
                setMuted(next);
                await kvSet("muted", next ? "1" : "0");
              }}
              hitSlop={10}
              accessibilityLabel={muted ? "Voice off" : "Voice on"}
            >
              <Text style={styles.navLink}>{muted ? "Silent" : "Voice"}</Text>
            </Pressable>
            <Pressable onPress={() => setSettings(true)} hitSlop={10} accessibilityLabel="Settings">
              <Text style={styles.navLink}>Settings</Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={styles.now} accessibilityLabel={persona?.nowFocus ?? "Focus"}>
          <Text style={styles.nowKicker}>{persona?.givenName}</Text>
          <Text style={styles.nowTitle}>{persona?.nowFocus}</Text>
          {status ? <Text style={styles.nowMeta}>{status}</Text> : null}
        </Pressable>

        <View style={styles.pills}>
          {(persona?.interests ?? []).slice(0, 4).map((i) => (
            <Pressable
              key={i.id}
              onPress={() => {
                const on = focusId === i.id;
                setFocusId(on ? null : i.id);
                setBias(on ? null : callingForInterest(i.id));
              }}
              style={[styles.pill, focusId === i.id && styles.pillOn]}
              accessibilityLabel={i.label}
            >
              <Text style={[styles.pillText, focusId === i.id && styles.pillTextOn]}>
                {i.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.heroScroll}
          contentContainerStyle={styles.heroInner}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          <Text style={styles.hero}>{spoken}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.dock}>
          {(showPlan || showRecap) && (
            <View style={styles.rituals}>
              {showPlan ? (
                <Pressable
                  onPress={() =>
                    void send("Plan today. First 10 users first. Leave slack.", "plan")
                  }
                  accessibilityLabel="Plan"
                >
                  <Text style={styles.ritual}>Plan</Text>
                </Pressable>
              ) : null}
              {showRecap ? (
                <Pressable
                  onPress={() =>
                    void send("Night recap. Kept, slipped, tomorrow first.", "recap")
                  }
                  accessibilityLabel="Recap"
                >
                  <Text style={styles.ritual}>Recap</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          <View style={[styles.composerBar, listening && styles.composerBarActive]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={listening ? "Listening…" : "Ask, plan, or reflect…"}
              placeholderTextColor="#686258"
              onSubmitEditing={() => void send(draft)}
              returnKeyType="send"
              editable={!listening}
            />
            {draft.trim().length > 0 ? (
              <Pressable
                onPress={() => void send(draft)}
                disabled={busy}
                accessibilityLabel="Send"
                style={styles.sendBtn}
              >
                <Text style={[styles.sendText, busy && styles.sendDisabled]}>Send</Text>
              </Pressable>
            ) : (
              <Pressable
                onPressIn={() => void start()}
                onPressOut={stop}
                disabled={!readyMind}
                style={[
                  styles.micBtn,
                  listening && styles.micBtnOn,
                  !readyMind && styles.micBtnWait,
                ]}
                accessibilityLabel="Hold to talk"
              >
                <View style={[styles.micDotSmall, listening && styles.micDotSmallOn]} />
                <Text style={[styles.micBtnText, listening && styles.micBtnTextOn]}>
                  {!readyMind ? "…" : listening ? "Release" : "Hold"}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color="#C9B896" />
          </View>
        ) : null}

        <Modal visible={settings} animationType="slide" transparent>
          <View style={styles.modalWrap}>
            <ScrollView contentContainerStyle={styles.modal} keyboardShouldPersistTaps="handled">
              <Text style={styles.wordmark}>On this phone</Text>
              <Text style={styles.hint}>{model.message}</Text>
              <Text style={styles.hint}>{stt.message}</Text>
              {lastStats ? <Text style={styles.hint}>{lastStats}</Text> : null}
              <Text style={styles.hint}>
                Persona grows from what you say. Nothing leaves the device.
              </Text>
              {(model.phase === "downloading" || stt.phase === "downloading") && (
                <ActivityIndicator color="#C9B896" />
              )}
              {model.phase === "error" && Platform.OS !== "web" ? (
                <Pressable
                  style={styles.smallBtn}
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
                  <Text style={styles.ritual}>Retry mind</Text>
                </Pressable>
              ) : null}
              {stt.phase === "error" && Platform.OS !== "web" ? (
                <Pressable
                  style={styles.smallBtn}
                  onPress={() =>
                    void warmParakeet(setStt).catch((e) =>
                      setStt({
                        phase: "error",
                        pct: 0,
                        message: e instanceof Error ? e.message : "Listen failed",
                      })
                    )
                  }
                >
                  <Text style={styles.ritual}>Retry listen</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.smallBtn}
                onPress={() => void scheduleTestCheckIn(persona?.nowFocus || "Still on it?")}
              >
                <Text style={styles.ritual}>Ping in 5s</Text>
              </Pressable>
              <Pressable onPress={() => setSettings(false)} accessibilityLabel="Close">
                <Text style={styles.navLink}>Close</Text>
              </Pressable>
            </ScrollView>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0C0E" },
  screen: {
    flex: 1,
    paddingHorizontal: 22,
    paddingBottom: Platform.OS === "android" ? 16 : 8,
    minHeight: 0,
  },
  center: { alignItems: "center", justifyContent: "center" },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  navRight: { flexDirection: "row", gap: 18 },
  wordmark: {
    color: "#EDE6D6",
    fontSize: 17,
    fontWeight: "500",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  navLink: { color: "#8A8478", fontSize: 13 },
  now: { marginTop: 20 },
  nowKicker: {
    color: "#8A8478",
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  nowTitle: {
    color: "#EDE6D6",
    fontSize: 24,
    fontWeight: "300",
    letterSpacing: -0.4,
    marginTop: 4,
    lineHeight: 30,
  },
  nowMeta: { color: "#C9B896", marginTop: 8, fontSize: 13 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  pill: {
    borderColor: "#2A2C2E",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillOn: { backgroundColor: "#C9B896", borderColor: "#C9B896" },
  pillText: { color: "#C4BBA8", fontSize: 12 },
  pillTextOn: { color: "#0B0C0E", fontWeight: "600" },
  heroScroll: { flex: 1, minHeight: 0, marginTop: 18 },
  heroInner: { flexGrow: 1, justifyContent: "center", paddingBottom: 8 },
  hero: {
    color: "#EDE6D6",
    fontSize: 20,
    fontWeight: "300",
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  error: { color: "#C97B6E", fontSize: 13, marginTop: 12 },
  dock: {
    paddingTop: 8,
    paddingBottom: Platform.OS === "android" ? 16 : 8,
    flexShrink: 0,
    width: "100%",
  },
  rituals: { flexDirection: "row", gap: 28, marginBottom: 12, justifyContent: "center" },
  ritual: { color: "#C9B896", fontSize: 14, letterSpacing: 0.6 },
  composerBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#14171A",
    borderColor: "#262B30",
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 4,
    minHeight: 48,
  },
  composerBarActive: {
    borderColor: "#C9B896",
    backgroundColor: "#1F1C16",
  },
  input: {
    flex: 1,
    color: "#EDE6D6",
    fontSize: 15,
    paddingVertical: 8,
    paddingRight: 8,
  },
  sendBtn: {
    backgroundColor: "#C9B896",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: {
    color: "#0B0C0E",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  sendDisabled: { opacity: 0.5 },
  micBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#202428",
    borderColor: "#323840",
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  micBtnOn: {
    backgroundColor: "#3A2E1A",
    borderColor: "#C9B896",
  },
  micBtnWait: { opacity: 0.45 },
  micDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#C9B896",
  },
  micDotSmallOn: {
    backgroundColor: "#EDE6D6",
  },
  micBtnText: {
    color: "#C9B896",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  micBtnTextOn: {
    color: "#EDE6D6",
  },
  busy: { position: "absolute", top: 20, right: 22 },
  modalWrap: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "flex-end",
  },
  modal: {
    backgroundColor: "#121416",
    padding: 24,
    paddingBottom: 40,
    gap: 14,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  hint: { color: "#8A8478", fontSize: 14, lineHeight: 20 },
  smallBtn: { paddingVertical: 8 },
});
