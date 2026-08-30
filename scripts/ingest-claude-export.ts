/**
 * Ingest a Claude data export (conversations.json) into a short persona appendix.
 * Never copies the raw dump into the live prompt.
 *
 * Usage: npm run ingest -- /path/to/conversations.json
 *        npm run ingest -- /path/to/unzipped-export-folder
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Message = {
  sender?: string;
  text?: string;
  content?: { type?: string; text?: string }[];
};

type Conversation = {
  name?: string;
  title?: string;
  chat_messages?: Message[];
  messages?: Message[];
};

const root = join(__dirname, "..");

function findConversations(input: string): string {
  const p = resolve(input);
  if (existsSync(p) && p.endsWith(".json")) return p;
  const candidate = join(p, "conversations.json");
  if (existsSync(candidate)) return candidate;
  const files = existsSync(p) ? readdirSync(p) : [];
  const hit = files.find((f) => f === "conversations.json");
  if (hit) return join(p, hit);
  throw new Error(`Could not find conversations.json at ${p}`);
}

function textOf(m: Message): string {
  if (m.text) return m.text;
  if (Array.isArray(m.content)) {
    return m.content.map((c) => c.text ?? "").join("\n");
  }
  return "";
}

function topTerms(blob: string, n: number): string[] {
  const stop = new Set(
    "the a an and or to of in for on with you i it that this is was are be as at from we they not but have had if then than so my your".split(
      " "
    )
  );
  const counts = new Map<string, number>();
  for (const raw of blob.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    if (stop.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

function quotes(userBlob: string): string[] {
  return userBlob
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 180)
    .slice(0, 8);
}

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: npm run ingest -- /path/to/conversations.json");
    process.exit(1);
  }
  const file = findConversations(input);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as
    | Conversation[]
    | { conversations?: Conversation[] };
  const convos = Array.isArray(parsed) ? parsed : parsed.conversations ?? [];
  const userParts: string[] = [];
  const titles: string[] = [];
  for (const c of convos) {
    if (c.name) titles.push(c.name);
    if (c.title) titles.push(c.title);
    const msgs = c.chat_messages ?? c.messages ?? [];
    for (const m of msgs) {
      const sender = (m.sender ?? "").toLowerCase();
      if (sender === "human" || sender === "user") userParts.push(textOf(m));
    }
  }
  const userBlob = userParts.join("\n");
  const terms = topTerms(`${userBlob} ${titles.join(" ")}`, 24);
  const samples = quotes(userBlob);
  const md = `# From Claude export

Ingested ${convos.length} conversations from ${file}.

## Recurring terms
${terms.join(", ") || "(none)"}

## How they talk (verbatim snippets)
${samples.map((s) => `- ${s}`).join("\n") || "- (no long user turns found)"}

## Thread titles
${[...new Set(titles)].slice(0, 30).map((t) => `- ${t}`).join("\n") || "- (none)"}

Keep this appendix short. Match their diction. Do not quote the raw export.
`;
  writeFileSync(join(root, "persona/from-export.md"), md, "utf8");
  const ts = `/** Updated by npm run ingest. Keep short. */\nexport const FROM_EXPORT = ${JSON.stringify(md)};\n`;
  writeFileSync(join(root, "src/fromExport.ts"), ts, "utf8");
  console.log(
    `Wrote persona/from-export.md and src/fromExport.ts (${convos.length} conversations).`
  );
}

main();
