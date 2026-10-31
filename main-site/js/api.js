// The API. Games are played entirely in the browser; the API hands out
// start tickets, checks and scores finished games, keeps the leaderboard,
// and stores the replays behind short links.

const KEY_STORAGE = "uwustack.clientKey";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// A random id tying this browser's submissions to the games it started. Not
// an identity: it grants nothing and is never shown.
function makeKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let memoryKey = null;

export function clientKey() {
  try {
    let key = localStorage.getItem(KEY_STORAGE);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(key ?? "")) {
      key = makeKey();
      localStorage.setItem(KEY_STORAGE, key);
    }
    return key;
  } catch {
    memoryKey ??= makeKey();
    return memoryKey;
  }
}

async function call(method, path, body, { timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(path, {
      method,
      signal: controller.signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "offline", "That needs a connection.");
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // An HTML error page from the platform, not the API.
  }
  if (!response.ok) throw new ApiError(response.status, data?.error ?? "server", data?.message);
  return data;
}

export const api = {
  // Solo games get a seed from the server; a race passes the host's.
  start: ({ mode, seed, difficulty, turn, game }) =>
    call("POST", "/api/game/start", { client_key: clientKey(), mode, seed, difficulty, turn, game }, { timeout: 6000 }),
  finish: (gameId, record) => call("POST", "/api/game/finish", { game_id: gameId, client_key: clientKey(), record }),
  submit: (gameId, record, name) =>
    call("POST", "/api/game/submit", { game_id: gameId, client_key: clientKey(), record, name }, { timeout: 30000 }),
  checkName: (name) => call("POST", "/api/leaderboard/name", { name }),
  leaderboard: (board) => call("GET", `/api/leaderboard?board=${encodeURIComponent(board)}`),
  // A verified replay from a game the API started, or any record.
  createReplay: (body) => call("POST", "/api/replay/create", { ...body, client_key: clientKey() }),
  replay: (id) => call("GET", `/api/replay?id=${encodeURIComponent(id)}`),
};
