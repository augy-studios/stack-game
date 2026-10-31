// The leaderboard window: best score, tallest tower or total points, one
// row per name, after MRT Station Guesser's.

import { api } from "./api.js";
import { difficultyOf } from "./rules.js";
import { escapeHtml, openModal } from "./ui.js";

const BOARDS = {
  best: {
    head: ["#", "Name", "Score", "Mode", "Height"],
    row: (e) => [e.rank, e.name, e.score, difficultyOf(e.difficulty).label, e.layers],
    about: "Each name's single best game. Harder modes and time limits score more.",
  },
  tallest: {
    head: ["#", "Name", "Height", "Mode", "Score"],
    row: (e) => [e.rank, e.name, e.layers, difficultyOf(e.difficulty).label, e.score],
    about: "Each name's highest tower: how many layers high it stood when the game ended.",
  },
  total: {
    head: ["#", "Name", "Total", "Games"],
    row: (e) => [e.rank, e.name, e.total, e.games],
    about: "Every game added under a name, scores added up.",
  },
};

let board = "best";
let loading = 0;

function setTab(next) {
  board = next;
  document.querySelectorAll("#boardTabs [data-board]").forEach((el) => {
    const on = el.dataset.board === board;
    el.classList.toggle("active", on);
    el.setAttribute("aria-selected", String(on));
  });
}

async function load() {
  const body = document.getElementById("boardBody");
  const note = document.getElementById("boardNote");
  const ticket = ++loading;
  const spec = BOARDS[board];
  body.setAttribute("aria-busy", "true");
  note.textContent = spec.about;

  try {
    const data = await api.leaderboard(board);
    if (ticket !== loading) return;
    const entries = data.entries ?? [];
    body.innerHTML = entries.length
      ? `<table class="board-table">
          <thead><tr>${spec.head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead>
          <tbody>${entries
            .map((e) => `<tr>${spec.row(e).map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`)
            .join("")}</tbody>
        </table>`
      : `<p class="board-empty">No scores yet. Build a tower and add yours.</p>`;
  } catch (err) {
    if (ticket !== loading) return;
    body.innerHTML = `<p class="board-empty">${
      err.code === "offline" ? "The leaderboard needs a connection." : "The leaderboard did not load. Try again in a moment."
    }</p>`;
  } finally {
    if (ticket === loading) body.removeAttribute("aria-busy");
  }
}

export function openLeaderboard(which = board) {
  setTab(which);
  openModal("boardModal");
  load();
}

export function initLeaderboard() {
  document.getElementById("boardBtn").addEventListener("click", () => openLeaderboard());
  document.getElementById("boardTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-board]");
    if (!tab || tab.dataset.board === board) return;
    setTab(tab.dataset.board);
    load();
  });
}
