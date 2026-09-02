import { kvGet, kvSet } from "./db";
import { PERSONA_SEED } from "./personaSeed";

export type Interest = {
  id: string;
  label: string;
  weight: number;
  note: string;
};

export type LivePersona = {
  givenName: string;
  city: string;
  bio: string;
  northStar: string;
  weekBet: string;
  nowFocus: string;
  interests: Interest[];
};

const CUES: { id: string; re: RegExp }[] = [
  { id: "steward", re: /\b(steward|users?|ship|expo|on-device|mic|hooked|persona)\b/i },
  { id: "dissertation", re: /\b(dissertation|thesis|tiktok|ugc|chapter|citation|qualtrics|gen z)\b/i },
  { id: "consulting", re: /\b(consult|youtube|fieldbase|sme|lead gen|automation|kintsugi)\b/i },
  { id: "faith", re: /\b(pray|prayer|psalm|bible|scripture|church|faith|god)\b/i },
  { id: "craft", re: /\b(design|ui|ux|davinci|brand|aesthetic|video)\b/i },
];

export async function ensurePersonaSeeded(): Promise<void> {
  if (await kvGet("persona_seeded")) return;
  await kvSet("given_name", PERSONA_SEED.givenName);
  await kvSet("city", PERSONA_SEED.city);
  await kvSet("persona_bio", PERSONA_SEED.bio);
  await kvSet("startup_north_star", PERSONA_SEED.northStar);
  await kvSet("week_bet", PERSONA_SEED.weekBet);
  await kvSet("now_focus", PERSONA_SEED.nowFocus);
  await kvSet("study_topic", PERSONA_SEED.interests[1].note);
  await kvSet("interests_json", JSON.stringify(PERSONA_SEED.interests));
  await kvSet("persona_seeded", "1");
}

export async function loadLivePersona(): Promise<LivePersona> {
  await ensurePersonaSeeded();
  const [
    givenName,
    city,
    bio,
    northStar,
    weekBet,
    nowFocus,
    interestsRaw,
  ] = await Promise.all([
    kvGet("given_name"),
    kvGet("city"),
    kvGet("persona_bio"),
    kvGet("startup_north_star"),
    kvGet("week_bet"),
    kvGet("now_focus"),
    kvGet("interests_json"),
  ]);
  let interests: Interest[] = PERSONA_SEED.interests.map((i) => ({ ...i }));
  try {
    if (interestsRaw) interests = JSON.parse(interestsRaw) as Interest[];
  } catch {
    /* keep seed */
  }
  interests.sort((a, b) => b.weight - a.weight);
  const top = interests[0];
  return {
    givenName: givenName || PERSONA_SEED.givenName,
    city: city || PERSONA_SEED.city,
    bio: bio || PERSONA_SEED.bio,
    northStar: northStar || PERSONA_SEED.northStar,
    weekBet: weekBet || PERSONA_SEED.weekBet,
    nowFocus: nowFocus || top?.label || PERSONA_SEED.nowFocus,
    interests,
  };
}

export async function learnFromUtterance(text: string): Promise<LivePersona> {
  const persona = await loadLivePersona();
  let changed = false;
  for (const cue of CUES) {
    if (!cue.re.test(text)) continue;
    const row = persona.interests.find((i) => i.id === cue.id);
    if (!row) continue;
    row.weight = Math.min(140, row.weight + 8);
    changed = true;
  }
  if (!changed) return persona;
  persona.interests.sort((a, b) => b.weight - a.weight);
  const top = persona.interests[0];
  if (top) persona.nowFocus = top.label;
  await persistPersona(persona);
  return persona;
}

export async function persistPersona(persona: LivePersona): Promise<void> {
  await kvSet("given_name", persona.givenName);
  await kvSet("city", persona.city);
  await kvSet("persona_bio", persona.bio);
  await kvSet("startup_north_star", persona.northStar);
  await kvSet("week_bet", persona.weekBet);
  await kvSet("now_focus", persona.nowFocus);
  await kvSet("interests_json", JSON.stringify(persona.interests));
}

export function promptBlock(p: LivePersona): string {
  const ranked = p.interests
    .slice(0, 5)
    .map((i) => `${i.label} (${i.weight}): ${i.note}`)
    .join(" | ");
  return [
    `Person: ${p.givenName}, ${p.city}. ${p.bio}`,
    `Now: ${p.nowFocus}`,
    `North star: ${p.northStar}`,
    `This week: ${p.weekBet}`,
    `Ranked interests: ${ranked}`,
  ].join("\n");
}
