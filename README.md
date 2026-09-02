# Steward

Voice companion for a Christian day: **listen**, **speak**, **plan the morning**, **check in**, **recap at night**. Four callings: read, pray, study, build.

Everything runs **on the device**. No cloud LLMs and no cloud speech APIs.

- **Mind:** Gemma 3 270M Instruct via [Cactus Compute](https://cactuscompute.com) (`cactus-react-native`)
- **Listen:** NVIDIA Parakeet CTC 1.1B via [Cactus Compute](https://cactuscompute.com) (`cactus-react-native`)
- **Speak:** on-device TTS (`expo-speech`)

Models download **once**, then work offline. Cactus telemetry and cloud handoff are disabled.

Not branded Jarvis. Steward works for you.

## Run on a phone (required)

Expo Go and web cannot load the native models. Use a development build:

```bash
cd ~/Projects/steward
npx expo run:ios --device
# or
npx expo run:android --device
```

Android Gradle cannot use **JDK 25** (what Android Studio ships). Install Temurin 17, then rebuild:

```bash
brew install --cask temurin@17
source ~/.zshrc
cd ~/Projects/steward
npx expo run:android --device
```

`adb devices` should list the phone first. **Hexagon SDK not found** is fine — llama.cpp will use CPU.

First launch downloads Llama and Parakeet, then loads them. Hold to talk records 16 kHz WAV and transcribes with Parakeet on device.

Settings → **Test check-in in 5s** to verify local notifications.

Defaults: morning plan **07:00**, night recap **21:30**.

## Claude export (optional, still local)

Used only to tune Steward’s persona on disk — nothing is sent to Anthropic.

```bash
npm run ingest -- /path/to/conversations.json
```

## Persona

- [`persona/steward.md`](persona/steward.md) — constitution
- [`persona/unknowns.md`](persona/unknowns.md) — ask once
- [`persona/memory-schema.md`](persona/memory-schema.md) — SQLite on device
