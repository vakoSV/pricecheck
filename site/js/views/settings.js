// Settings, saved on this phone (localStorage).
import { S, saveSettings, resetSettings } from "../state.js";
import { CURRENCIES, DEFAULTS, num } from "../calc.js";
import { esc, day } from "../ui.js";
import { t } from "../i18n.js";
import * as buy from "../buylist.js";

export function render(view) {
  const s = S.settings;
  const nbg = (S.rates && S.rates.rates) || {};
  const f = (k, label, unit, def) => `<label class="f"><span>${label}</span><div class="pair"><input data-s="${k}" inputmode="decimal" value="${esc(s[k])}"><b>${unit}</b></div><small>${esc(t("settings.default", { v: def + unit }))}</small></label>`;
  view.innerHTML = `
    <h1 class="h">${esc(t("settings.title"))}</h1>
    <p class="hint">${esc(t("settings.saved_here"))}</p>
    <h2>${esc(t("settings.rates"))} <small class="muted">${esc(t("settings.rates_unit"))}</small></h2>
    <p class="hint">${esc(S.rates && S.rates.valid_from ? t("settings.rates_hint_date", { date: day(S.rates.valid_from) }) : t("settings.rates_hint"))}</p>
    <div class="inputs">${CURRENCIES.map((c) => `<label class="f"><span>${c}</span><input data-r="${c}" inputmode="decimal" placeholder="${nbg[c] != null ? nbg[c] : esc(t("settings.no_rate"))}" value="${esc(s.rates[c] ?? "")}"><small>${esc(t("settings.nbg", { rate: nbg[c] != null ? nbg[c] : "–" }))}</small></label>`).join("")}</div>
    <h2>${esc(t("settings.costs"))}</h2>
    <div class="inputs">
      ${f("vat", esc(t("settings.vat")), "%", DEFAULTS.vat)}
      ${f("freight", esc(t("settings.freight")), "%", DEFAULTS.freight)}
      ${f("local", esc(t("settings.local")), "%", DEFAULTS.local)}
      ${f("below", esc(t("settings.below")), "%", DEFAULTS.below)}
    </div>
    <h2>${esc(t("settings.levels"))}</h2>
    <div class="inputs">
      ${f("low", esc(t("settings.low")), "%", DEFAULTS.low)}
      ${f("high", esc(t("settings.high")), "%", DEFAULTS.high)}
    </div>
    <p class="hint">${esc(t("settings.levels_hint"))}</p>
    <div class="row2"><button type="button" class="btn ghost" id="reset">${esc(t("settings.reset"))}</button><span id="saved" class="muted"></span></div>
    <p class="muted small">${esc(t("settings.formulas"))}</p>
    <h2 id="sync">${esc(t("sync.title"))}</h2>
    <p class="hint">${esc(t("sync.hint"))}</p>
    <p class="hint"><b>${esc(t("sync.help"))}</b></p>
    <label class="f wide"><span>${esc(t("sync.token"))}</span>
      <input id="ghtok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…"></label>
    <div class="row2"><button type="button" class="btn" id="ghsave">${esc(t("sync.save"))}</button>
      <button type="button" class="btn ghost" id="ghtest">${esc(t("sync.test"))}</button>
      <button type="button" class="btn ghost danger" id="ghdel">${esc(t("sync.remove"))}</button></div>
    <p class="note" id="ghstat" role="status"></p>`;
  const saved = view.querySelector("#saved");
  view.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.s) {
      const v = num(el.value);
      el.classList.toggle("bad", v == null);
      if (v != null) s[el.dataset.s] = v;
    } else if (el.dataset.r) {
      const v = num(el.value);
      el.classList.toggle("bad", el.value.trim() !== "" && !(v > 0));
      s.rates[el.dataset.r] = el.value.trim() === "" ? null : v > 0 ? v : s.rates[el.dataset.r];
    } else return;
    saveSettings();
    saved.textContent = t("settings.saved");
  });
  view.querySelector("#reset").onclick = () => { resetSettings(); render(view); view.querySelector("#saved").textContent = t("settings.restored"); };

  // ── Buy list sync: the token stays on this device; only its last 4 characters are ever shown ──
  const tok = view.querySelector("#ghtok"), stat = view.querySelector("#ghstat");
  const showSaved = (extra = "") => {
    stat.textContent = (buy.hasToken() ? t("sync.saved_ends", { end: buy.tokenEnd() }) : t("sync.none")) + (extra ? " " + extra : "");
    view.querySelector("#ghtest").disabled = !buy.hasToken();
    view.querySelector("#ghdel").disabled = !buy.hasToken();
  };
  showSaved();
  view.querySelector("#ghsave").onclick = () => {
    const v = tok.value.trim();
    if (!v) { stat.textContent = t("sync.paste_first"); return; }
    buy.setToken(v);
    tok.value = "";
    showSaved(t("sync.test_now"));
    buy.load();
  };
  view.querySelector("#ghdel").onclick = () => { buy.setToken(""); tok.value = ""; showSaved(); buy.load(); };
  view.querySelector("#ghtest").onclick = async () => {
    stat.textContent = t("sync.testing");
    const r = await buy.testConnection();
    // a plain reason: the token itself, the connection, or which permission is missing
    const why = ["bad_token", "rate_limited", "offline", "github", "no_token"].includes(r.kind) ? r.kind : r.step;
    stat.textContent = r.ok ? t("sync.ok") : t("sync.fail." + why, { status: r.status });
    if (r.ok) buy.load();
  };
}
