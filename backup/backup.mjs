// Reads every voter's document from the public vote relays and merges it into backup.json.
// Run by .github/workflows/backup.yml. Usage: node backup/backup.mjs <output folder>
//
// The merge only ever adds or updates: if a relay has lost its data, the backup keeps what it had.
// cleanDoc, canon and mergeDoc must stay identical to the copies in index.html on the gh-pages branch.
import mqtt from "mqtt";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Must match SYNC in index.html. The group chat (…/v1/c/) is deliberately not backed up.
const PREFIX = "jbst-d681dbca690e8839/v1/p/";
const PASS = "AjiRR9PXb0V1lIw4tJthmVHTr_-G103M";
const BROKERS = (process.env.BROKERS || "wss://broker.emqx.io:8084/mqtt,wss://broker.hivemq.com:8884/mqtt").split(",");
const QUIET_MS = +(process.env.QUIET_MS || 4000);   // stop once a relay has been silent this long
const MAX_MS = +(process.env.MAX_MS || 30000);      // hard stop per relay
const MAX_PEOPLE = 60;                              // the relays are public, so cap what we will store

const outDir = process.argv[2] || "data";
const SLUG_OK = /^[a-z0-9-]{1,40}$/;
const ID_OK = /^[a-z0-9-]{1,80}$/;

function cleanDoc(d) {
  if (!d || typeof d !== "object") return null;
  const out = { name: String(d.name || "").slice(0, 24), votes: {}, notes: {}, updated: +d.updated || 0 };
  if (d.votes && typeof d.votes === "object") for (const k of Object.keys(d.votes).slice(0, 400)) {
    const x = d.votes[k]; if (x && typeof x.t === "number" && ID_OK.test(k)) out.votes[k] = { v: x.v === 1 ? 1 : x.v === -1 ? -1 : 0, t: x.t };
  }
  if (d.notes && typeof d.notes === "object") for (const k of Object.keys(d.notes).slice(0, 300)) {
    const x = d.notes[k]; if (!x || typeof x !== "object" || !ID_OK.test(k)) continue;
    out.notes[k] = x.del ? { del: true, ts: +x.ts || 0 } : { item: ID_OK.test(x.item) ? x.item : "general", kind: x.kind === "change" ? "change" : "comment", text: String(x.text || "").slice(0, 600), ts: +x.ts || 0 };
    if (!x.del && typeof x.hrs === "number" && x.hrs >= 0.5 && x.hrs <= 12) out.notes[k].hrs = Math.round(x.hrs * 2) / 2;
  }
  return out;
}
function canon(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
  return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
}
function mergeDoc(a, b) {
  if (!a) return b; if (!b) return a;
  const ua = a.updated || 0, ub = b.updated || 0;
  let name; if (ua !== ub) name = (ua > ub ? a.name : b.name) || a.name || b.name; else name = [a.name, b.name].filter(Boolean).sort()[0] || "";
  const out = { name, votes: {}, notes: {}, updated: Math.max(ua, ub) };
  for (const src of [a.votes, b.votes]) for (const k in src) { const x = src[k], c = out.votes[k]; if (!c || x.t > c.t || (x.t === c.t && x.v > c.v)) out.votes[k] = x; }
  for (const src of [a.notes, b.notes]) for (const k in src) {
    const x = src[k], c = out.notes[k];
    if (!c) out.notes[k] = x; else if (x.del && !c.del) out.notes[k] = x; else if (!!x.del === !!c.del && canon(x) < canon(c)) out.notes[k] = x;
  }
  return out;
}

let keyP = null;
function getKey() {
  if (!keyP) keyP = crypto.subtle.digest("SHA-256", new TextEncoder().encode(PASS)).then(d => crypto.subtle.importKey("raw", d, "AES-GCM", false, ["decrypt"]));
  return keyP;
}
async function unseal(b64) {
  if (typeof b64 !== "string" || b64.length < 40 || b64.length > 300000) return null;
  try {
    const u = new Uint8Array(Buffer.from(b64, "base64"));
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12) }, await getKey(), u.subarray(12))));
  } catch (e) { return null; }
}

/* one relay: connect, let it replay everything it holds, hand back the raw messages */
function readRelay(url) {
  return new Promise(resolve => {
    const got = []; let connected = false, quiet = null, done = false, client;
    const finish = () => { if (done) return; done = true; clearTimeout(quiet); clearTimeout(hard); try { client.end(true); } catch (e) {} resolve({ url, connected, got }); };
    const hard = setTimeout(finish, MAX_MS);
    const bump = () => { clearTimeout(quiet); quiet = setTimeout(finish, QUIET_MS); };
    try {
      client = mqtt.connect(url, { clientId: "jbst_backup_" + Math.random().toString(16).slice(2, 12), clean: true, keepalive: 30, reconnectPeriod: 0, connectTimeout: 12000 });
    } catch (e) { return finish(); }
    client.on("connect", () => { connected = true; client.subscribe(PREFIX + "+", { qos: 1 }, err => { if (err) finish(); else bump(); }); });
    client.on("message", (topic, msg) => { got.push([topic, msg.toString()]); bump(); });
    client.on("error", finish); client.on("close", finish);
  });
}

const csvCell = v => { let s = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
const iso = t => (t ? new Date(t).toISOString().replace(".000Z", "Z") : "");
/* stable, readable JSON: sorted keys, so an unchanged backup is byte-for-byte the same file */
function pretty(o, ind = "") {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  const keys = Object.keys(o).sort(); if (!keys.length) return "{}";
  if (keys.every(k => o[k] === null || typeof o[k] !== "object")) return "{" + keys.map(k => JSON.stringify(k) + ":" + JSON.stringify(o[k])).join(",") + "}";
  return "{\n" + keys.map(k => ind + "  " + JSON.stringify(k) + ": " + pretty(o[k], ind + "  ")).join(",\n") + "\n" + ind + "}";
}

const file = join(outDir, "backup.json");
let people = {};
if (existsSync(file)) {
  try {
    const old = JSON.parse(readFileSync(file, "utf8")).people || {};
    for (const slug of Object.keys(old)) { const d = cleanDoc(old[slug]); if (d && SLUG_OK.test(slug)) people[slug] = d; }
  } catch (e) { console.log("::error::backup.json exists but could not be read, leaving it untouched: " + e.message); process.exit(1); }
}
const before = canon(people);

const relays = await Promise.all(BROKERS.map(readRelay));
const up = relays.filter(r => r.connected);
for (const r of relays) console.log((r.connected ? "read " : "could not reach ") + r.url + (r.connected ? ": " + r.got.length + " documents" : ""));
if (!up.length) { console.log("::warning::No relay could be reached. The backup was left as it is."); process.exit(0); }

let skipped = 0;
for (const r of up) for (const [topic, raw] of r.got) {
  const slug = topic.slice(PREFIX.length); if (!topic.startsWith(PREFIX) || !SLUG_OK.test(slug)) continue;
  const obj = await unseal(raw); if (!obj || obj.s !== slug) continue;
  const inc = cleanDoc(obj.d); if (!inc) continue;
  if (!people[slug] && Object.keys(people).length >= MAX_PEOPLE) { skipped++; continue; }
  people[slug] = mergeDoc(people[slug], inc);
}
if (skipped) console.log("::warning::" + skipped + " documents skipped: the backup already holds " + MAX_PEOPLE + " people.");

const slugs = Object.keys(people).sort();
const votes = [["voter", "item", "vote", "voted_at_utc"]], comments = [["author", "about", "kind", "text", "posted_at_utc"]];
for (const slug of slugs) {
  const p = people[slug], who = p.name || slug;
  for (const id of Object.keys(p.votes).sort()) { const x = p.votes[id]; if (x.v) votes.push([who, id, x.v === 1 ? "up" : "down", iso(x.t)]); }
  for (const id of Object.keys(p.notes).sort((a, b) => (p.notes[a].ts || 0) - (p.notes[b].ts || 0) || (a < b ? -1 : 1))) {
    const n = p.notes[id]; if (!n.del && n.text) comments.push([who, n.item, n.kind === "change" ? "change proposal" : "feedback", n.text, iso(n.ts)]);
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(file, pretty({ version: 1, people }) + "\n");
writeFileSync(join(outDir, "votes.csv"), csv(votes));
writeFileSync(join(outDir, "comments.csv"), csv(comments));
console.log((canon(people) === before ? "No change. " : "Backup updated. ") + slugs.length + " people, " + (votes.length - 1) + " votes, " + (comments.length - 1) + " comments.");
