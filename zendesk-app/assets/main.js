/* Overwolf Status Monitor — Zendesk sidebar app
 *
 * Reads Overwolf's public game-events status endpoints and shows whether the
 * Overwolf data behind OP.GG's overlays is currently stable.
 *
 * Endpoint (per game):  https://game-events-status.overwolf.com/{gameId}_prod.json
 * State codes:  1 = 정상 / 2 = 일부 불안정 / 3 = 장애 / 0 = 확인 불가
 *               (plus a game-level `disabled` flag = 중단)
 */

// ---------------------------------------------------------------------------
// Config — OP.GG overlays mapped to the Overwolf game + feature they depend on.
// `feature` can be a string, an array (worst state wins), or "_game"
// to track the game-level status (use when the feature isn't publicly exposed).
// Tweak this block if an overlay's underlying feature dependency changes.
// ---------------------------------------------------------------------------
var GAMES = [
  {
    id: 5426,
    nameKo: "리그 오브 레전드 (LoL)",
    overlays: [
      { label: "정글 타이머", feature: "jungle_camps" },
      { label: "증바람 증강체 오버레이", feature: "augments" }
    ]
  },
  {
    id: 21570,
    nameKo: "전략적 팀 전투 (TFT)",
    overlays: [
      // TFT 증강체 데이터는 라이엇 TOS상 오버울프가 공개 status로 노출하지 않아
      // 게임 전체 상태를 기준으로 표시합니다.
      { label: "증강체 오버레이", feature: "_game", hint: "오버울프 미노출 항목 — 게임 전체 상태 기준" },
      { label: "상점 알림 오버레이", feature: "store" }
    ]
  },
  {
    id: 21640,
    nameKo: "발로란트",
    overlays: [
      { label: "라운드별 정보 오버레이", feature: ["game_info", "match_info"] }
    ]
  }
];

var ENDPOINT = function (id) {
  return "https://game-events-status.overwolf.com/" + id + "_prod.json";
};

// All-games summary file — the only place that carries the per-game GEP version.
var GAMESTATUS_ENDPOINT = "https://game-events-status.overwolf.com/gamestatus_prod.json";

// Latest LoL / Valorant patch (version + official release date) is published as
// patches.json alongside the history data, by the overwolf-status-history repo's
// scheduled scraper. We read it from there rather than calling Riot directly:
// no public, key-less endpoint exposes a patch's real *release* date in-browser
// (valorant-api's buildDate is the build date — days early — and Data Dragon has
// no date and labels LoL "16.x" while the public patch notes say "26.x"). The
// scraper reads Riot's own news pages server-side, where there's no CORS/auth wall.
// File: <historyBaseUrl>/patches.json

// game_id -> GEP version string (current run). Filled by fetchVersions().
var gepVersions = {};

var STATE = {
  1: { ko: "정상", cls: "s1" },
  2: { ko: "불안정", cls: "s2" },
  3: { ko: "장애", cls: "s3" },
  0: { ko: "확인 불가", cls: "s0" }
};

var POLL_MS = 60 * 1000;

// Base URL of the overwolf-status-history repo's /data folder. The app's
// "History data base URL" setting overrides this when set; this hardcoded
// fallback guarantees the history panel works even if the setting isn't
// delivered to the iframe (which was flaky in practice).
var HISTORY_BASE_URL = "https://raw.githubusercontent.com/sohyun1006/overwolf-status-history/main/data";

// Snapshots closer than this to the ticket time are shown as trustworthy;
// further ones still display but with a "참고용" (approximate) caveat.
var HISTORY_WINDOW_MS = 20 * 60 * 1000;

var appSettings = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve the effective state (0-3) for one overlay from a fetched game object.
function overlayState(game, overlay) {
  if (!game) return 0;
  if (game.disabled || game.disabled_electron) return 3;

  var feature = overlay.feature;
  if (feature === "_game") return normalize(game.state);

  var names = Array.isArray(feature) ? feature : [feature];
  var states = [];
  for (var i = 0; i < names.length; i++) {
    var f = findFeature(game, names[i]);
    states.push(f ? normalize(f.state) : 0);
  }
  return worst(states);
}

function findFeature(game, name) {
  var fs = game.features || [];
  for (var i = 0; i < fs.length; i++) {
    if (fs[i].name === name) return fs[i];
  }
  return null;
}

function normalize(s) {
  return s === 1 || s === 2 || s === 3 ? s : 0;
}

// Worst (most severe) state for the UI: 3 > 2 > 0 > 1.
// Unknown (0) is treated as more concerning than OK (1) but less than a real issue.
function worst(states) {
  var rank = { 3: 4, 2: 3, 0: 2, 1: 1 };
  var w = states[0] || 0;
  for (var i = 1; i < states.length; i++) {
    if ((rank[states[i]] || 0) > (rank[w] || 0)) w = states[i];
  }
  return w;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
function fetchGame(id) {
  return fetch(ENDPOINT(id), { cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      return { id: id, ok: true, data: data };
    })
    .catch(function (err) {
      return { id: id, ok: false, error: err };
    });
}

// Fetch the per-game GEP version from the all-games summary file.
// Prefers the ow-electron version (populated for all our games), falling back
// to the native one.
function fetchVersions() {
  return fetch(GAMESTATUS_ENDPOINT, { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) {
      var map = {};
      (Array.isArray(list) ? list : []).forEach(function (g) {
        map[g.game_id] = g.min_gep_version_electron || g.min_gep_version || null;
      });
      return map;
    })
    .catch(function () { return {}; });
}

// Normalize one game's patch entry from patches.json into { patch, dateMs }.
function toPatchInfo(o) {
  if (!o || !o.patch) return null;
  var ms = o.date ? Date.parse(o.date) : NaN;
  return { patch: o.patch, dateMs: isNaN(ms) ? null : ms };
}

// Read the published patch versions/dates. Lives next to the history data, so it
// shares the same base URL (and is unavailable if that isn't configured).
function fetchPatches() {
  var base = historyBaseUrl();
  if (!base) return Promise.resolve({});
  return fetch(base + "/patches.json", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (j) {
      var g = (j && j.games) || {};
      return { lol: toPatchInfo(g.lol), valorant: toPatchInfo(g.valorant) };
    })
    .catch(function () { return {}; });
}

function refresh() {
  var btn = document.getElementById("refresh");
  btn.classList.add("spinning");

  Promise.all([
    Promise.all(GAMES.map(function (g) { return fetchGame(g.id); })),
    fetchVersions(),
    fetchPatches()
  ])
    .then(function (out) {
      var results = out[0];
      gepVersions = out[1] || {};
      var byId = {};
      results.forEach(function (r) { byId[r.id] = r; });
      render(byId);
      renderPatches(out[2] || {});
    })
    .catch(function (err) {
      renderFatal(err);
    })
    .then(function () {
      btn.classList.remove("spinning");
    });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render(byId) {
  var gamesEl = document.getElementById("games");
  gamesEl.innerHTML = "";

  var anyFetchError = false;
  var allOverlayStates = [];

  GAMES.forEach(function (cfg) {
    var result = byId[cfg.id];
    var game = result && result.ok ? result.data : null;
    if (!result || !result.ok) anyFetchError = true;

    var gameEl = document.createElement("div");
    gameEl.className = "game";

    var gameState = game ? normalize(game.state) : 0;
    var gs = STATE[gameState];
    var ver = gepVersions[cfg.id];
    gameEl.innerHTML =
      '<div class="game-head">' +
        '<span class="dot ' + gs.cls + '"></span>' +
        '<span>' + cfg.nameKo +
          (ver ? ' <span class="gep">GEP ' + ver + "</span>" : "") +
        "</span>" +
        '<span class="game-state ' + (game ? "state " + gs.cls : "") + '">' +
          (game ? "게임 전체: " + gs.ko : "불러오기 실패") +
        "</span>" +
      "</div>";

    cfg.overlays.forEach(function (ov) {
      var st = game ? overlayState(game, ov) : 0;
      allOverlayStates.push(st);
      var s = STATE[st];
      var row = document.createElement("div");
      row.className = "row";
      row.innerHTML =
        '<span class="dot ' + s.cls + '"></span>' +
        '<span class="label">' + ov.label + "</span>" +
        '<span class="state ' + s.cls + '">' + s.ko + "</span>" +
        (ov.hint ? '<span class="hint">' + ov.hint + "</span>" : "");
      gameEl.appendChild(row);
    });

    gamesEl.appendChild(gameEl);
  });

  renderOverall(allOverlayStates, anyFetchError);
  stamp();
  resize();
}

function renderOverall(states, anyFetchError) {
  var el = document.getElementById("overall");
  el.className = "overall";

  var w = states.length ? worst(states) : 0;
  var hasDown = states.indexOf(3) !== -1;
  var hasWarn = states.indexOf(2) !== -1;
  var hasUnknown = states.indexOf(0) !== -1;

  if (hasDown) {
    el.classList.add("s-down");
    el.innerHTML = "🔴 오버울프 데이터 장애" +
      '<span class="sub">아래 빨간 항목의 오버레이는 현재 정상 동작이 어려울 수 있어요.</span>';
  } else if (hasWarn) {
    el.classList.add("s-warn");
    el.innerHTML = "🟡 일부 데이터 불안정" +
      '<span class="sub">노란 항목의 오버레이가 간헐적으로 불안정할 수 있어요.</span>';
  } else if (anyFetchError || hasUnknown) {
    el.classList.add("s-error");
    el.innerHTML = "⚪ 일부 상태 확인 불가" +
      '<span class="sub">오버울프 상태를 일부 불러오지 못했어요. 새로고침 해보세요.</span>';
  } else {
    el.classList.add("s-ok");
    el.innerHTML = "🟢 안정 — 오버울프 데이터 정상" +
      '<span class="sub">오버레이가 안 뜨면 오버울프가 아닌 다른 원인일 가능성이 높아요.</span>';
  }
}

function renderFatal(err) {
  var el = document.getElementById("overall");
  el.className = "overall s-error";
  el.innerHTML = "⚠️ 상태 확인 실패" +
    '<span class="sub">' + (err && err.message ? err.message : "네트워크 오류") + "</span>";
  stamp();
  resize();
}

function stamp() {
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, "0");
  var mm = String(now.getMinutes()).padStart(2, "0");
  var ss = String(now.getSeconds()).padStart(2, "0");
  document.getElementById("updated").textContent =
    "마지막 업데이트 " + hh + ":" + mm + ":" + ss;
}

// ---------------------------------------------------------------------------
// Latest game patches — "when did LoL / Valorant last patch?"
// Reference info for agents triaging "오버레이가 안 떠요" right after a patch.
// ---------------------------------------------------------------------------
function fmtPatchDate(ms) {
  return new Date(ms).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function fmtDaysAgo(ms) {
  var days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  return days + "일 전";
}

function patchMetaHtml(info) {
  if (!info || !info.patch) {
    return '<span class="patch-date">불러오기 실패</span>';
  }
  var date = info.dateMs
    ? '<span class="patch-date">' + fmtPatchDate(info.dateMs) +
        ' <span class="patch-ago">(' + fmtDaysAgo(info.dateMs) + ")</span></span>"
    : '<span class="patch-date">날짜 확인 불가</span>';
  return '<span class="patch-ver">' + info.patch + "</span>" + date;
}

function renderPatches(data) {
  var el = document.getElementById("patches");
  var rows = [
    { name: "리그 오브 레전드", info: data.lol },
    { name: "발로란트", info: data.valorant }
  ];
  var body = rows.map(function (r) {
    return '<div class="patch-row">' +
      '<span class="patch-game">' + r.name + "</span>" +
      '<span class="patch-meta">' + patchMetaHtml(r.info) + "</span>" +
    "</div>";
  }).join("");

  el.innerHTML = '<div class="patches-head">🩹 최근 게임 패치</div>' + body;
}

// ---------------------------------------------------------------------------
// History — "what was the Overwolf status when this ticket came in?"
// Reads compact snapshots logged by the overwolf-status-history repo.
// ---------------------------------------------------------------------------
function historyBaseUrl() {
  var url = appSettings.historyBaseUrl || HISTORY_BASE_URL || "";
  return url.replace(/\/+$/, "");
}

function utcDayKey(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

function fetchDay(base, dayKey) {
  return fetch(base + "/" + dayKey + ".json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (arr) { return Array.isArray(arr) ? arr : []; })
    .catch(function () { return []; });
}

function nearestSnapshot(list, targetMs) {
  var best = null;
  var bestGap = Infinity;
  for (var i = 0; i < list.length; i++) {
    var t = Date.parse(list[i].t);
    if (isNaN(t)) continue;
    var gap = Math.abs(t - targetMs);
    if (gap < bestGap) { bestGap = gap; best = list[i]; }
  }
  return best ? { snap: best, gapMs: bestGap } : null;
}

// Effective overlay state from a compact history game object { s, d, f:{} }.
function overlayStateHist(gobj, overlay) {
  if (!gobj) return 0;
  if (gobj.d) return 3;
  if (overlay.feature === "_game") return normalize(gobj.s);
  var names = Array.isArray(overlay.feature) ? overlay.feature : [overlay.feature];
  var states = names.map(function (n) { return normalize((gobj.f || {})[n]); });
  return worst(states);
}

function fmtLocal(date) {
  return date.toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  });
}

function fmtGap(ms) {
  var min = Math.round(ms / 60000);
  if (min < 60) return min + "분";
  var h = Math.floor(min / 60);
  var m = min % 60;
  return m ? h + "시간 " + m + "분" : h + "시간";
}

// Collapsible history panel. Starts collapsed; the live status above is primary.
var historyCollapsed = true;

// Wrap a body in the clickable header + toggleable body. The header click is
// handled by a single delegated listener attached in init().
function historyShell(bodyHtml) {
  return '<div class="history-head" data-history-toggle>' +
           '<span class="caret">' + (historyCollapsed ? "▸" : "▾") + "</span>" +
           "<span>🕓 티켓 인입 시각 기준 상태</span>" +
         "</div>" +
         '<div class="history-body"' + (historyCollapsed ? ' style="display:none"' : "") + ">" +
           bodyHtml +
         "</div>";
}

function historyMsg(el, msg) {
  el.innerHTML = historyShell('<div class="history-empty">' + msg + "</div>");
  resize();
}

// Load once per ticket. Looks up the snapshot nearest the ticket's creation time.
function loadHistory() {
  var el = document.getElementById("history");
  var base = historyBaseUrl();

  if (!zafClient) {
    historyMsg(el, zafSdkPresent
      ? "Zendesk 연결 초기화 실패 (ZAFClient.init이 null). 과거 조회를 사용할 수 없어요."
      : "ZAF SDK가 로드되지 않았어요. 과거 조회를 사용할 수 없어요.");
    return;
  }
  if (!base) { historyMsg(el, "과거 데이터 주소(History data base URL)가 설정되지 않았어요."); return; }

  historyMsg(el, "불러오는 중…");

  zafClient.get("ticket.createdAt").then(function (res) {
    var iso = res && res["ticket.createdAt"];
    if (!iso) { historyMsg(el, "티켓 인입 시각을 불러올 수 없어요. (티켓 화면에서만 동작)"); return; }
    var when = new Date(iso);
    var targetMs = when.getTime();

    // Pull the ticket's UTC day plus neighbors so lookups near midnight still
    // find the closest snapshot.
    var keys = [addDays(when, -1), when, addDays(when, 1)].map(utcDayKey);
    Promise.all(keys.map(function (k) { return fetchDay(base, k); }))
      .then(function (lists) {
        var all = lists.reduce(function (a, b) { return a.concat(b); }, []);
        renderHistory(el, when, nearestSnapshot(all, targetMs));
        resize();
      })
      .catch(function (e) {
        historyMsg(el, "과거 데이터를 불러오지 못했어요: " + (e && e.message ? e.message : e));
      });
  }).catch(function (e) {
    historyMsg(el, "티켓 정보를 불러오지 못했어요: " + (e && e.message ? e.message : e));
  });
}

function renderHistory(el, when, nearest) {
  if (!nearest) {
    el.innerHTML = historyShell(
      '<div class="history-sub">인입: ' + fmtLocal(when) + "</div>" +
      '<div class="history-empty">이 시각 부근의 기록이 없어요. ' +
      "(로깅 시작 이전이거나 기록이 누락된 구간일 수 있어요.)</div>");
    return;
  }

  var snap = nearest.snap;
  var snapTime = new Date(Date.parse(snap.t));
  var far = nearest.gapMs > HISTORY_WINDOW_MS;
  var html =
    '<div class="history-sub">인입 ' + fmtLocal(when) +
    " · 기록 " + fmtLocal(snapTime) + " 기준</div>" +
    (far
      ? '<div class="history-empty">⚠️ 인입 시각과 ' + fmtGap(nearest.gapMs) +
        " 차이 나는 기록이에요. 정확도가 낮으니 참고용으로만 보세요.</div>"
      : "");

  GAMES.forEach(function (cfg) {
    var gobj = (snap.g || {})[cfg.id] || (snap.g || {})[String(cfg.id)];
    var gameState = gobj ? normalize(gobj.s) : 0;
    var gs = STATE[gameState];
    html +=
      '<div class="game"><div class="game-head">' +
        '<span class="dot ' + gs.cls + '"></span>' +
        '<span>' + cfg.nameKo + "</span>" +
        '<span class="game-state state ' + gs.cls + '">게임 전체: ' + gs.ko + "</span>" +
      "</div>";
    cfg.overlays.forEach(function (ov) {
      var st = overlayStateHist(gobj, ov);
      var s = STATE[st];
      html +=
        '<div class="row">' +
          '<span class="dot ' + s.cls + '"></span>' +
          '<span class="label">' + ov.label + "</span>" +
          '<span class="state ' + s.cls + '">' + s.ko + "</span>" +
        "</div>";
    });
    html += "</div>";
  });

  el.innerHTML = historyShell(html);
}

// ---------------------------------------------------------------------------
// Zendesk integration (degrades gracefully when run standalone)
// ---------------------------------------------------------------------------
var zafClient = null;

function measureHeight() {
  return Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
    document.getElementById("app").scrollHeight
  ) + 8;
}

// Single height push to Zendesk.
function pushHeight() {
  if (!zafClient) return;
  var h = measureHeight();
  if (h > 0) zafClient.invoke("resize", { width: "100%", height: h + "px" });
}

// Retried a few times because scrollHeight can read short right after a
// re-render (or 0 on tab switch), and an invoke fired before the app is fully
// registered is dropped — which is what left the iframe at its default height.
function resize() {
  if (!zafClient) return;
  [0, 60, 200, 500, 1000].forEach(function (delay) {
    setTimeout(pushHeight, delay);
  });
}

var zafSdkPresent = false;

function init() {
  document.getElementById("refresh").addEventListener("click", refresh);

  // Delegated toggle for the collapsible history panel (#history is rebuilt on
  // each render, so listen on the stable container).
  document.getElementById("history").addEventListener("click", function (e) {
    if (!e.target.closest("[data-history-toggle]")) return;
    historyCollapsed = !historyCollapsed;
    var body = document.querySelector("#history .history-body");
    var caret = document.querySelector("#history .caret");
    if (body) body.style.display = historyCollapsed ? "none" : "";
    if (caret) caret.textContent = historyCollapsed ? "▸" : "▾";
    resize();
  });

  zafSdkPresent = typeof ZAFClient !== "undefined";
  if (zafSdkPresent) {
    try { zafClient = ZAFClient.init(); } catch (e) { zafClient = null; }
  }

  // Always attempt history; loadHistory() shows a clear message for every case
  // (no SDK / no client / not a ticket / no data) instead of silently doing nothing.
  loadHistory();

  if (zafClient) {
    // Resize once the app is registered/activated — invokes fired earlier are
    // dropped, which is what left the iframe stuck at its default height.
    zafClient.on("app.registered", resize);
    zafClient.on("app.activated", resize);
    // Keep the height correct if the agent resizes the apps panel width
    // (content reflows → height changes).
    if (window.ResizeObserver) {
      new ResizeObserver(pushHeight).observe(document.getElementById("app"));
    }
    // Read app settings, then refresh the historical lookup with them applied.
    zafClient.metadata().then(function (m) {
      appSettings = (m && m.settings) || {};
      loadHistory();
    }).catch(function () { loadHistory(); });
  }

  refresh();
  setInterval(refresh, POLL_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
