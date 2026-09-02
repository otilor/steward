/** Distilled from claude-legacy-memory.md. Seeded into SQLite once, then the live profile can drift. */
export const PERSONA_SEED = {
  givenName: "Gabriel",
  city: "London",
  bio: "Backend engineer (fintech/payments: PHP, Laravel, Python). M.S. Digital Marketing, York St John. Church media. Builds on-device.",
  northStar:
    "Steward: on-device voice companion. First ten real users. No cloud LLMs.",
  weekBet: "Ship Steward and get the first 10 people using it.",
  nowFocus: "First 10 Steward users",
  interests: [
    {
      id: "steward",
      label: "Steward · first 10 users",
      weight: 100,
      note: "This app. Voice-first. On-device. Hook people so they come back.",
    },
    {
      id: "dissertation",
      label: "Dissertation",
      weight: 72,
      note: "Lo-Fi vs Hi-Fi UGC on TikTok, Gen Z authenticity/trust/purchase in athletic footwear. Chapter 2 + citations.",
    },
    {
      id: "consulting",
      label: "AI consulting",
      weight: 48,
      note: "SME automation. YouTube The AI Advantage. Kintsugi identity. FieldBase NOC triage. East London leads.",
    },
    {
      id: "faith",
      label: "Faith & church",
      weight: 55,
      note: "Church media. Scripture without preaching. FaithQuest (children's Bible app) is parked.",
    },
    {
      id: "craft",
      label: "Craft",
      weight: 28,
      note: "Visual identity, video, DaVinci. Prefers hi-fi when it earns trust.",
    },
  ],
} as const;
