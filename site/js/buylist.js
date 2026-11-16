// Buy list: the products I'm willing to buy (barcodes only, nothing copied from the price data),
// shared between my devices through site/config/buylist.json in the GitHub repository:
//   {"version":1,"items":[{"id":"<barcode>","added":"<ISO time>"}]}
//
// Read:  with a token on this device → GitHub Contents API (fresh at once);
//        without one → the copy published on GitHub Pages (a minute or two behind a change);
//        offline → the service worker's last copy, else the last list seen on this device.
// Write: only with a token → Contents API PUT with the file's current sha. Taps within 2 s go
//        into one commit. When another device changed the file meanwhile (409/422), read it
//        again, apply this device's changes again and retry (3 tries). On failure the hearts go
//        back and the reason is reported (see onChange "error").
// The token stays in this browser (localStorage) and is only ever sent to api.github.com.
// Every save is a commit "buylist: …" on main, so pull --rebase before pushing from the PC.

export const REPO = { owner: "vakoSV", repo: "pricecheck", branch: "main", path: "site/config/buylist.json" };
const API = "https://api.github.com";
const TKEY = "pc.ghtoken.v1"; // the GitHub token (this device only)
const CKEY = "pc.buylist.v1"; // the last list seen on this device (start offline)
const BATCH_MS = 2000;
const MAX_TRIES = 3;

let items = []; // [{ id, added }], newest first
let byId = new Map(); // id -> added
let state = { loaded: false, source: "", offline: false, error: "" };
const pending = new Map(); // id -> { op: "add" | "remove", added, prevAdded }: taps not committed yet
let timer = 0;
let flushing = false;
const subs = new Set();

// ── token ──
export const getToken = () => { try { return localStorage.getItem(TKEY) || ""; } catch { return ""; } };
export function setToken(tok) {
  try { if (tok) localStorage.setItem(TKEY, tok); else localStorage.removeItem(TKEY); } catch {}
}
export const hasToken = () => !!getToken();
/** The last 4 characters, the most of the token the screens ever show. */
export const tokenEnd = () => getToken().slice(-4);

// ── list ──
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = (why, detail) => subs.forEach((fn) => { try { fn(why, detail); } catch (e) { console.error(e); } });
export const isSaved = (id) => byId.has(id);
export const addedOf = (id) => byId.get(id);
export const list = () => items.slice();
export const count = () => items.length;
export const status = () => ({ ...state, pending: pending.size, busy: flushing });

/** Valid entries, one per id, newest saved first. */
function normalize(list) {
  const seen = new Map();
  for (const x of Array.isArray(list) ? list : []) {
    if (x && typeof x.id === "string" && x.id && !seen.has(x.id)) seen.set(x.id, { id: x.id, added: typeof x.added === "string" ? x.added : "" });
  }
  return [...seen.values()].sort((a, b) => b.added.localeCompare(a.added) || a.id.localeCompare(b.id));
}
function setItems(list) {
  items = normalize(list);
  byId = new Map(items.map((x) => [x.id, x.added]));
  try { localStorage.setItem(CKEY, JSON.stringify(items)); } catch {}
}
function cachedItems() { try { return JSON.parse(localStorage.getItem(CKEY) || "[]"); } catch { return []; } }

/** A list with changes applied: add sets the time saved, remove drops the id. */
function apply(list, ops) {
  const m = new Map(normalize(list).map((x) => [x.id, x.added]));
  for (const [id, o] of ops) { if (o.op === "add") m.set(id, o.added); else m.delete(id); }
  return normalize([...m].map(([id, added]) => ({ id, added })));
}
const withPending = (list) => apply(list, pending);
const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

// ── GitHub ──
class SyncError extends Error {
  constructor(kind, status = 0) { super(kind); this.kind = kind; this.status = status; }
}
function errorOf(r) {
  if (r.status === 401) return new SyncError("bad_token", 401);
  if (r.status === 429 || (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0")) return new SyncError("rate_limited", r.status);
  if (r.status === 403) return new SyncError("no_access", 403);
  if (r.status === 404) return new SyncError("not_found", 404);
  if (r.status === 409 || r.status === 422) return new SyncError("conflict", r.status);
  return new SyncError("github", r.status);
}
async function gh(method, path, body) {
  const tok = getToken();
  if (!tok) throw new SyncError("no_token");
  let r;
  try {
    r = await fetch(API + path, {
      method, cache: "no-store",
      headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError("offline");
  }
  if (!r.ok) throw errorOf(r);
  return r.json();
}
const contentsPath = () => `/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path}`;
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (s) => { let bin = ""; new TextEncoder().encode(s).forEach((x) => { bin += String.fromCharCode(x); }); return btoa(bin); };
const fileText = (list) => JSON.stringify({ version: 1, items: normalize(list) }, null, 2) + "\n";

async function readApi() {
  const j = await gh("GET", contentsPath() + "?ref=" + encodeURIComponent(REPO.branch));
  let data;
  try { data = JSON.parse(b64decode(j.content || "")); } catch { throw new SyncError("github", 200); }
  return { items: normalize(data.items), sha: j.sha };
}
async function readPages() {
  let r;
  // no-cache (not no-store): the service worker handles it (network first, its copy when offline)
  try { r = await fetch("config/buylist.json?t=" + Date.now(), { cache: "no-cache" }); } catch { throw new SyncError("offline"); }
  if (!r.ok) throw new SyncError("github", r.status);
  const data = await r.json();
  return { items: normalize(data.items), offline: r.headers.get("x-pc-offline") === "1" };
}

/** Read the list (see the top of this file). Taps not committed yet stay applied. */
export async function load() {
  let err = "";
  if (hasToken()) {
    try {
      const x = await readApi();
      setItems(withPending(x.items));
      state = { loaded: true, source: "github", offline: false, error: "" };
      emit("load");
      return;
    } catch (e) {
      err = e.kind || "github";
    }
  }
  try {
    const x = await readPages();
    setItems(withPending(x.items));
    state = { loaded: true, source: "pages", offline: x.offline || err === "offline", error: err === "offline" ? "" : err };
  } catch {
    setItems(withPending(cachedItems()));
    state = { loaded: true, source: "device", offline: true, error: "" };
  }
  emit("load");
}

// ── changes ──
/**
 * Save or unsave one product. Instant on screen; committed after 2 s without taps.
 * { added } restores an earlier time saved (Undo). Returns { ok, saved } or { ok: false, reason }.
 */
export function toggle(id, { added } = {}) {
  if (!hasToken()) return { ok: false, reason: "no_token" };
  const prev = pending.get(id);
  let saved;
  if (byId.has(id)) {
    const prevAdded = byId.get(id);
    setItems(items.filter((x) => x.id !== id));
    // saved and unsaved again before the commit: nothing to send
    if (prev && prev.op === "add" && prev.prevAdded === undefined) pending.delete(id);
    else pending.set(id, { op: "remove", prevAdded: prev ? prev.prevAdded : prevAdded });
    saved = false;
  } else {
    const at = added || new Date().toISOString();
    setItems([{ id, added: at }, ...items]);
    // unsaved and restored (Undo) before the commit: nothing to send
    if (prev && prev.op === "remove" && prev.prevAdded === at) pending.delete(id);
    else pending.set(id, { op: "add", added: at, prevAdded: prev ? prev.prevAdded : undefined });
    saved = true;
  }
  emit("toggle", { id, saved });
  clearTimeout(timer);
  timer = setTimeout(flush, BATCH_MS);
  return { ok: true, saved };
}

function message(ops) {
  const add = [], rem = [];
  for (const [id, o] of ops) (o.op === "add" ? add : rem).push(id);
  const parts = [];
  if (add.length) parts.push("add " + add.join(", "));
  if (rem.length) parts.push("remove " + rem.join(", "));
  const m = "buylist: " + parts.join("; ");
  return m.length <= 200 ? m : `buylist: add ${add.length}, remove ${rem.length}`;
}

/** Undo changes that could not be saved, so the hearts show what is really on GitHub. */
function revert(ops) {
  let list = items;
  for (const [id, o] of ops) {
    if (pending.has(id)) continue; // tapped again since: that newer change decides
    if (o.op === "add") list = o.prevAdded !== undefined ? [...list.filter((x) => x.id !== id), { id, added: o.prevAdded }] : list.filter((x) => x.id !== id);
    else if (o.prevAdded !== undefined) list = [...list.filter((x) => x.id !== id), { id, added: o.prevAdded }];
  }
  setItems(list);
}

async function flush() {
  if (flushing) { clearTimeout(timer); timer = setTimeout(flush, BATCH_MS); return; }
  if (!pending.size) return;
  const ops = new Map(pending);
  pending.clear();
  flushing = true;
  emit("busy");
  let err = null;
  for (let i = 0; i < MAX_TRIES; i++) {
    try {
      const cur = await readApi();
      const next = apply(cur.items, ops);
      if (!same(next, cur.items)) {
        await gh("PUT", contentsPath(), { message: message(ops), content: b64encode(fileText(next)), sha: cur.sha, branch: REPO.branch });
      }
      setItems(withPending(next));
      state = { loaded: true, source: "github", offline: false, error: "" };
      err = null;
      break;
    } catch (e) {
      err = e instanceof SyncError ? e : new SyncError("github");
      if (err.kind !== "conflict") break; // another device saved meanwhile: read again and retry
    }
  }
  flushing = false;
  if (err) {
    revert(ops);
    if (err.kind === "offline") state.offline = true;
    emit("error", { kind: err.kind, status: err.status });
  } else {
    emit("saved");
  }
  if (pending.size) { clearTimeout(timer); timer = setTimeout(flush, BATCH_MS); }
}

/**
 * Settings → Test connection: can this token read and change the Buy list file?
 * The write check sends an update with a wrong sha: GitHub refuses it with 409/422 when the token
 * may write (and 403/404 when it may not), so nothing is ever committed by the test.
 * Returns { ok, step: "repo" | "read" | "write" | "done", kind, status }.
 */
export async function testConnection() {
  try { await gh("GET", `/repos/${REPO.owner}/${REPO.repo}`); } catch (e) { return { ok: false, step: "repo", kind: e.kind, status: e.status }; }
  let cur;
  try { cur = await readApi(); } catch (e) { return { ok: false, step: "read", kind: e.kind, status: e.status }; }
  try {
    await gh("PUT", contentsPath(), { message: "buylist: connection test (no change)", content: b64encode(fileText(cur.items)), sha: "0".repeat(40), branch: REPO.branch });
    return { ok: true, step: "done", kind: "", status: 200 };
  } catch (e) {
    if (e.kind === "conflict") return { ok: true, step: "done", kind: "", status: e.status };
    return { ok: false, step: "write", kind: e.kind, status: e.status };
  }
}
