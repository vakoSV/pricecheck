// Settings, saved on this phone (localStorage).
import { S, saveSettings, resetSettings } from "../state.js";
import { CURRENCIES, DEFAULTS, num } from "../calc.js";
import { esc, day } from "../ui.js";
import { t } from "../i18n.js";

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
    <p class="muted small">${esc(t("settings.formulas"))}</p>`;
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
}
