// Records a compact Overwolf game-events status snapshot into data/YYYY-MM-DD.json
// (UTC date). Run by GitHub Actions every ~5 minutes. Requires Node 20+ (global fetch).
//
// Snapshot shape (kept tiny so day files stay small):
//   { "t": "<ISO timestamp>", "g": { "<gameId>": { "s": <gameState>, "d": <0|1 disabled>,
//                                                   "f": { "<feature>": <state> } } } }

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// Features we record per game. Keep in sync with the Zendesk app's GAMES config
// (assets/main.js). Game-level state is always recorded regardless of this list.
const GAMES = {
  5426: ["jungle_camps", "augments"],     // LoL: 정글 타이머, 증바람 증강체
  21570: ["store"],                       // TFT: 상점 알림 (증강체는 게임 전체 상태로 대체)
  21640: ["game_info", "match_info"]      // 발로란트: 라운드별 정보
};

const endpoint = (id) => `https://game-events-status.overwolf.com/${id}_prod.json`;

async function fetchGame(id, features) {
  const res = await fetch(endpoint(id), { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const f = {};
  for (const feat of features) {
    const hit = (data.features || []).find((x) => x.name === feat);
    f[feat] = hit ? hit.state : 0;
  }
  return {
    s: typeof data.state === "number" ? data.state : 0,
    d: data.disabled || data.disabled_electron ? 1 : 0,
    f
  };
}

async function main() {
  const now = new Date();
  const g = {};
  for (const [id, feats] of Object.entries(GAMES)) {
    try {
      g[id] = await fetchGame(id, feats);
    } catch (e) {
      g[id] = { s: 0, d: 0, f: {}, e: String((e && e.message) || e) };
    }
  }
  const snapshot = { t: now.toISOString(), g };

  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  if (!existsSync("data")) await mkdir("data", { recursive: true });
  const file = `data/${date}.json`;

  let arr = [];
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (Array.isArray(parsed)) arr = parsed;
    } catch { /* corrupt/partial file — start fresh for safety */ }
  }
  arr.push(snapshot);
  await writeFile(file, JSON.stringify(arr) + "\n");
  console.log(`wrote ${file} (${arr.length} snapshots)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
