import * as db from "./src/js/supabase.js";
import { aggregateStats, computeSessionStats, formatGold, formatGoldPlain } from "./src/js/stats.js";
import { PASSWORD } from "./src/js/config.js";

const $ = (sel) => document.querySelector(sel);

function stripRealm(id) {
  return id ? id.split("-")[0] : "";
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function gameTypeLabel(t) {
  if (t === "simpleDice") return "Simple Dice";
  if (t === "deathRoll")  return "Death Roll";
  return t || "—";
}

// ── Leaderboard ─────────────────────────────────────────────────────────────

function renderStats(stats) {
  $("#stat-sessions").textContent = stats.totalSessions;
  $("#stat-rounds").textContent   = stats.totalRounds;
  $("#stat-volume").textContent   = formatGoldPlain(stats.totalVolume);
  $("#stat-biggest").textContent  = formatGoldPlain(stats.biggestPayout);

  $("#leaderboard-heading").textContent = `Rangliste (${stats.leaderboard.length} Spieler)`;

  const ltbody = $("#leaderboard-table tbody");
  ltbody.innerHTML = "";

  if (stats.leaderboard.length === 0) {
    ltbody.innerHTML = '<tr><td colspan="5" class="empty">Noch keine Daten</td></tr>';
    return;
  }

  stats.leaderboard.forEach((entry, i) => {
    const hasAlts = entry.chars.some(c => c.id !== entry.id);
    const won  = entry.won  ?? 0;
    const lost = entry.lost ?? 0;

    const tr = document.createElement("tr");
    tr.className = "lb-main";
    tr.innerHTML = `
      <td class="rank muted">${i + 1}</td>
      <td class="lb-name">
        ${hasAlts
          ? `<button class="expand-btn" data-idx="${i}" aria-label="Details">▶</button>`
          : `<span class="expand-spacer"></span>`}
        ${stripRealm(entry.id)}
      </td>
      <td class="num ${entry.net >= 0 ? "positive" : "negative"}">${formatGold(entry.net)}</td>
      <td class="num positive">${won > 0 ? "+" + formatGoldPlain(won) : "—"}</td>
      <td class="num negative">${lost > 0 ? "−" + formatGoldPlain(lost) : "—"}</td>`;
    ltbody.append(tr);

    if (hasAlts) {
      for (const char of entry.chars) {
        const sub = document.createElement("tr");
        sub.className = "lb-sub hidden";
        sub.dataset.parent = i;
        const label = char.id === entry.id ? "(main)" : "(alt)";
        sub.innerHTML = `
          <td></td>
          <td class="lb-sub-name muted">
            <span class="sub-arrow">└</span>
            ${stripRealm(char.id)}
            <span class="char-type">${label}</span>
          </td>
          <td class="num ${char.net >= 0 ? "positive" : "negative"}">${formatGold(char.net)}</td>
          <td></td><td></td>`;
        ltbody.append(sub);
      }
    }
  });

  ltbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".expand-btn");
    if (!btn) return;
    const idx = btn.dataset.idx;
    const open = btn.classList.toggle("open");
    btn.textContent = open ? "▼" : "▶";
    ltbody.querySelectorAll(`[data-parent="${idx}"]`)
      .forEach(r => r.classList.toggle("hidden", !open));
  });
}

// ── Session detail modal ─────────────────────────────────────────────────────

function renderRound(round, gameType) {
  const num = round.roundNumber ?? "?";
  const { winner, loser, payoutAmount = 0 } = round.results || {};

  let content = "";

  if (gameType === "deathRoll") {
    const history = Object.values(round.deathRollState?.rollHistory || {})
      .sort((a, b) => a.timestamp - b.timestamp);
    content = `
      <table class="round-table">
        <thead><tr>
          <th>#</th><th>Spieler</th>
          <th class="num">Gewürfelt</th><th class="num muted">Max</th>
        </tr></thead>
        <tbody>
          ${history.map((h, i) => `<tr>
            <td class="muted">${i + 1}</td>
            <td>${stripRealm(h.player)}</td>
            <td class="num mono">${h.roll.toLocaleString("de-DE")}</td>
            <td class="num muted">${h.max.toLocaleString("de-DE")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="round-result">
        <span class="positive">${stripRealm(winner)}</span> gewinnt
        <span class="gold">&nbsp;${formatGoldPlain(payoutAmount)}</span> —
        <span class="negative">${stripRealm(loser)}</span> verliert.
      </div>`;
  } else {
    // simpleDice: sort rolls descending (winner on top)
    const rolls = Object.entries(round.rolls || {})
      .map(([charId, data]) => ({ charId, ...data }))
      .sort((a, b) => b.roll - a.roll);
    content = `
      <table class="round-table">
        <thead><tr>
          <th>Spieler</th>
          <th class="num">Wurf</th>
          <th class="num muted">Max</th>
          <th class="num">Ergebnis</th>
        </tr></thead>
        <tbody>
          ${rolls.map(r => {
            const isW = r.charId === winner;
            const isL = r.charId === loser;
            return `<tr class="${isW ? "round-winner" : isL ? "round-loser" : ""}">
              <td>${stripRealm(r.charId)}</td>
              <td class="num mono">${r.roll.toLocaleString("de-DE")}</td>
              <td class="num muted">${r.maxRoll.toLocaleString("de-DE")}</td>
              <td class="num ${isW ? "positive" : isL ? "negative" : "muted"}">
                ${isW ? "+" + formatGoldPlain(payoutAmount) : isL ? "−" + formatGoldPlain(payoutAmount) : "—"}
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  return `<div class="round-block">
    <div class="round-heading">Runde ${num}</div>
    ${content}
  </div>`;
}

let _backdropHandler = null;

function openSessionModal(row) {
  const session = row.raw_data;
  if (!session) return;

  const dialog = $("#session-dialog");
  const { totalRounds, totalPayouts } = computeSessionStats(session);
  const participants = Object.keys(session.participants || {}).map(stripRealm).join(", ");
  const rounds = Array.isArray(session.rounds)
    ? session.rounds
    : Object.values(session.rounds || {});

  dialog.innerHTML = `
    <div class="session-header">
      <h2>${gameTypeLabel(row.game_type)} — ${formatDate(row.start_time)}</h2>
      <div class="session-meta">
        Host: <strong>${stripRealm(row.host_character || "")}</strong>
        &nbsp;·&nbsp; Spieler: ${participants}
        &nbsp;·&nbsp; ${totalRounds} Runde${totalRounds !== 1 ? "n" : ""},
        <span class="gold">${formatGoldPlain(totalPayouts)}</span> Volumen
      </div>
    </div>
    <div class="session-rounds">
      ${rounds.map(r => renderRound(r, row.game_type)).join("")}
    </div>
    <div class="dialog-actions">
      <button class="btn" id="session-close-btn">Schließen</button>
    </div>`;

  dialog.querySelector("#session-close-btn").addEventListener("click", () => dialog.close());

  if (_backdropHandler) dialog.removeEventListener("click", _backdropHandler);
  _backdropHandler = (e) => { if (e.target === dialog) dialog.close(); };
  dialog.addEventListener("click", _backdropHandler);

  dialog.showModal();
}

// ── Sessions grid ────────────────────────────────────────────────────────────

function getSessionStake(session, gameType) {
  const rounds = Array.isArray(session.rounds)
    ? session.rounds
    : Object.values(session.rounds || {});
  const round = rounds.find(r => r.status === "completed") ?? rounds[0];
  if (!round) return null;
  if (gameType === "simpleDice") {
    return Object.values(round.rolls || {})[0]?.maxRoll ?? null;
  }
  if (gameType === "deathRoll") {
    return round.results?.payoutAmount ?? null;
  }
  return null;
}

const PAGE_SIZE = 15;
let _allSessions = [];
let _filter = "all";
let _page = 1;

function filteredSessions() {
  if (_filter === "all") return _allSessions;
  return _allSessions.filter(s => s.game_type === _filter);
}

function buildSessionCard(row) {
  const session = row.raw_data || {};
  const { totalRounds, totalPayouts } = computeSessionStats(session);
  const stake = getSessionStake(session, row.game_type);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "session-card";
  card.innerHTML = `
    <div class="sc-top">
      <span class="sc-date mono">${formatDate(row.start_time)}</span>
      <span class="sc-type">${gameTypeLabel(row.game_type)}</span>
    </div>
    <div class="sc-mid">
      <span class="sc-host muted">${stripRealm(row.host_character || "")}</span>
      <span class="sc-rounds mono">${totalRounds} Runden</span>
    </div>
    <div class="sc-bot">
      <span class="sc-stake muted">Einsatz <span class="mono">${stake !== null ? formatGoldPlain(stake) : "—"}</span></span>
      <span class="sc-payout gold mono">${formatGoldPlain(totalPayouts)}</span>
    </div>`;
  card.addEventListener("click", () => openSessionModal(row));
  return card;
}

function renderSessionsView() {
  const list  = filteredSessions();
  const total = list.length;
  $("#sessions-heading").textContent = `Sessions (${_allSessions.length})`;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (_page > pages) _page = pages;

  const grid  = $("#sessions-grid");
  const empty = $("#sessions-empty");
  grid.innerHTML = "";

  if (total === 0) {
    empty.textContent = _allSessions.length === 0
      ? "Noch keine Sessions importiert"
      : "Keine Sessions für diesen Filter.";
    empty.classList.remove("hidden");
    $("#pager-info").textContent = "0 / 0";
    $("#pager-prev").disabled = true;
    $("#pager-next").disabled = true;
    return;
  }
  empty.classList.add("hidden");

  const slice = list.slice((_page - 1) * PAGE_SIZE, _page * PAGE_SIZE);
  for (const row of slice) grid.append(buildSessionCard(row));

  $("#pager-info").textContent = `${_page} / ${pages}`;
  $("#pager-prev").disabled = _page <= 1;
  $("#pager-next").disabled = _page >= pages;
}

function renderSessions(sessions) {
  _allSessions = sessions;
  _page = 1;
  renderSessionsView();
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

function isEmptySession(row) {
  const { totalRounds, totalPayouts } = computeSessionStats(row.raw_data || {});
  return totalRounds === 0 && totalPayouts === 0;
}

async function load() {
  try {
    const [sessions, characters] = await Promise.all([
      db.listSessions(),
      db.listCharacters(),
    ]);
    const nonEmpty = sessions.filter(s => !isEmptySession(s));
    renderStats(aggregateStats(nonEmpty, characters));
    renderSessions(nonEmpty);
  } catch (err) {
    console.error("Ladefehler:", err);
  }
}

$("#refresh-btn").addEventListener("click", load);

$("#pager-prev").addEventListener("click", () => { _page--; renderSessionsView(); });
$("#pager-next").addEventListener("click", () => { _page++; renderSessionsView(); });

$("#sessions-filter").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  $("#sessions-filter").querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === chip));
  _filter = chip.dataset.filter;
  _page = 1;
  renderSessionsView();
});

load();

(function initWrDownload() {
  const btn    = document.getElementById("wr-download-btn");
  const dialog = document.getElementById("wr-pw-dialog");
  const input  = document.getElementById("wr-pw-input");
  const ok     = document.getElementById("wr-pw-ok");
  const error  = document.getElementById("wr-pw-error");

  function triggerDownload() {
    const a = document.createElement("a");
    a.href = "WhateverRoyale-2.0.5.zip";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (sessionStorage.getItem("royale-auth") === "1") {
    btn.addEventListener("click", (e) => { e.preventDefault(); triggerDownload(); });
    return;
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    error.textContent = "";
    input.value = "";
    dialog.showModal();
    input.focus();
  });

  function attempt() {
    if (input.value === PASSWORD) {
      sessionStorage.setItem("royale-auth", "1");
      dialog.close();
      triggerDownload();
    } else {
      error.textContent = "Falsches Passwort.";
      input.value = "";
      input.focus();
    }
  }

  ok.addEventListener("click", attempt);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
}());
