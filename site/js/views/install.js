// How to install: short steps for iPhone and Android, the install button when Chrome offers it,
// and the QR code to open the site on a phone. Wording: install.* keys in the language files
// (the step texts may contain <b> tags).
import { APP_URL, isInstalled, isIPhoneSafari, syncInstallButtons } from "../install.js";
import { qrSVG } from "../qr.js";
import { t } from "../i18n.js";
import { esc } from "../ui.js";

export function render(view) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const url = esc(APP_URL.replace("https://", ""));
  const steps = (keys) => `<ol class="steps">${keys.map((k) => `<li>${t(k, { url })}</li>`).join("")}</ol>`;
  view.innerHTML = `
    <h1 class="h">${esc(t("install.title"))}</h1>
    <p class="hint">${esc(t("install.intro"))}</p>
    ${isInstalled() ? `<div class="note ok">${esc(t("install.installed"))}</div>` : ""}
    <button type="button" class="btn" data-install hidden>${esc(t("install.button"))}</button>

    <h2>${esc(t("install.iphone"))}</h2>
    ${steps(["install.ios1", "install.ios2", "install.ios3", "install.ios4"])}
    <p class="note">${esc(t("install.ios_storage"))}</p>
    ${ios && !isIPhoneSafari() && !isInstalled() ? `<p class="note warn">${esc(t("install.not_safari"))}</p>` : ""}

    <h2>${esc(t("install.android"))}</h2>
    ${steps(["install.and1", "install.and2", "install.and3"])}
    <p class="hint">${esc(t("install.android_storage"))}</p>

    <h2>${esc(t("install.computer"))}</h2>
    <p class="hint">${esc(t("install.computer_hint"))}</p>
    <div class="qrbig">${qrSVG(APP_URL, { label: t("install.qr_label", { url: APP_URL }) })}</div>`;
  syncInstallButtons();
}
