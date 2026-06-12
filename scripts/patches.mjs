// Records the latest official patch (version + release date) for LoL and Valorant
// into data/patches.json. Run by GitHub Actions on a schedule. Node 20+ (global fetch).
//
// Why scrape the official news sites instead of an API?
//   - Riot exposes no public, key-less endpoint for a patch's *live release date*.
//     valorant-api's buildDate is the client *build* date (days before launch),
//     and Data Dragon has no date at all and labels LoL "16.x" while the public
//     patch notes call it "26.x".
//   - The official news pages embed a __NEXT_DATA__ JSON with the exact publish
//     date and the public version. Server-side (here) there's no CORS/auth wall,
//     so we read it once and publish a tiny patches.json the browser app can fetch.
//
// Output shape (overwritten each run; no timestamp, so the file — and thus a
// commit — only changes when a patch actually changes):
//   { "games": {
//       "lol":      { "patch": "26.12", "date": "2026-06-09T18:00:00.000Z" },
//       "valorant": { "patch": "12.11", "date": "2026-06-09T13:00:00.000Z" } } }

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const SOURCES = {
  lol: {
    url: "https://www.leagueoflegends.com/ko-kr/news/game-updates/",
    // Match LoL patch-notes article URLs (excludes TFT links on the same page).
    slug: /league-of-legends-patch-(\d+)-(\d+)/
  },
  valorant: {
    url: "https://playvalorant.com/ko-kr/news/game-updates/",
    slug: /valorant-patch-notes-(\d+)-(\d+)/
  }
};

// Pull the __NEXT_DATA__ blob out of a Next.js page and walk it for every object
// that links to a patch-notes article matching `slug`, returning {patch, date}.
function extractPatches(html, slug) {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }

  const out = [];
  (function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      const link = JSON.stringify(node.action || node.url || node.link || "");
      const hit = link.match(slug);
      const date = node.publishedAt || node.date || node.dateTime || null;
      if (hit && date) out.push({ patch: `${hit[1]}.${hit[2]}`, date });
      for (const k in node) walk(node[k]);
    }
  })(data);
  return out;
}

async function fetchLatestPatch(src) {
  const res = await fetch(src.url, {
    cache: "no-store",
    // Some Riot edges 403 a bare bot UA.
    headers: { "user-agent": "Mozilla/5.0 (compatible; overwolf-status-bot/1.0)" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const found = extractPatches(html, src.slug);
  if (!found.length) throw new Error("no patch-notes articles found");
  // Newest published wins.
  found.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { patch: found[0].patch, date: found[0].date };
}

async function readExisting() {
  try {
    const j = JSON.parse(await readFile("data/patches.json", "utf8"));
    return (j && j.games) || {};
  } catch {
    return {};
  }
}

async function main() {
  const prev = await readExisting();
  const games = {};
  for (const [name, src] of Object.entries(SOURCES)) {
    try {
      games[name] = await fetchLatestPatch(src);
      console.log(`${name}: ${games[name].patch} @ ${games[name].date}`);
    } catch (e) {
      const msg = String((e && e.message) || e);
      // A transient scrape failure must not clobber a known-good value.
      if (prev[name] && prev[name].patch) {
        games[name] = prev[name];
        console.error(`${name}: ${msg} — keeping previous (${prev[name].patch})`);
      } else {
        games[name] = { error: msg };
        console.error(`${name}: ${msg}`);
      }
    }
  }

  if (!existsSync("data")) await mkdir("data", { recursive: true });
  await writeFile("data/patches.json", JSON.stringify({ games }) + "\n");
  console.log("wrote data/patches.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
