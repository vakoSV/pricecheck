// Settings, saved on this phone (localStorage).
import { S, saveSettings, resetSettings } from "../state.js";
import { CURRENCIES, DEFAULTS, num } from "../calc.js";
import { esc, day } from "../ui.js";

export function render(view) {
  const s = S.settings;
  const nbg = (S.rates && S.rates.rates) || {};
  const f = (k, label, unit, def) => `<label class="f"><span>${label}</span><div class="pair"><input data-s="${k}" inputmode="decimal" value="${esc(s[k])}"><b>${unit}</b></div><small>default ${def}${unit}</small></label>`;
  view.innerHTML = `
    <h1 class="h">Settings</h1>
    <p class="hint">Saved on this phone only.</p>
    <h2>Exchange rates <small class="muted">GEL per 1 unit</small></h2>
    <p class="hint">Empty = official NBG rate${S.rates && S.rates.valid_from ? " of " + esc(day(S.rates.valid_from)) : ""}.</p>
    <div class="inputs">${CURRENCIES.map((c) => `<label class="f"><span>${c}</span><input data-r="${c}" inputmode="decimal" placeholder="${nbg[c] != null ? nbg[c] : "no rate"}" value="${esc(s.rates[c] ?? "")}"><small>NBG ${nbg[c] != null ? nbg[c] : "–"}</small></label>`).join("")}</div>
    <h2>Costs and pricing</h2>
    <div class="inputs">
      ${f("vat", "VAT", "%", DEFAULTS.vat)}
      ${f("freight", "Freight", "%", DEFAULTS.freight)}
      ${f("below", "Sell below market", "%", DEFAULTS.below)}
    </div>
    <h2>Margin levels</h2>
    <div class="inputs">
      ${f("low", "Walk away below", "%", DEFAULTS.low)}
      ${f("high", "Good deal from", "%", DEFAULTS.high)}
    </div>
    <p class="hint">Red below the first level, yellow between, green from the second.</p>
    <div class="row2"><button type="button" class="btn ghost" id="reset">Reset to defaults</button><span id="saved" class="muted"></span></div>
    <p class="muted small">Formulas: landed cost per piece = price per piece × rate × (1 + VAT) × (1 + freight).
      Sell price = market regular price × (1 − below market), scaled per l/kg/pc when the pack size differs.
      Margin = (sell − landed) / sell.</p>`;
  const saved = view.querySelector("#saved");
  view.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.s) {
      const v = num(t.value);
      t.classList.toggle("bad", v == null);
      if (v != null) s[t.dataset.s] = v;
    } else if (t.dataset.r) {
      const v = num(t.value);
      t.classList.toggle("bad", t.value.trim() !== "" && !(v > 0));
      s.rates[t.dataset.r] = t.value.trim() === "" ? null : v > 0 ? v : s.rates[t.dataset.r];
    } else return;
    saveSettings();
    saved.textContent = "Saved";
  });
  view.querySelector("#reset").onclick = () => { resetSettings(); render(view); view.querySelector("#saved").textContent = "Defaults restored"; };
}
