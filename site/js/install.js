// Install help: Chrome's install offer behind our "Install app" buttons, the iPhone Safari banner,
// and the "Open on phone" QR code for computers.
import { qrSVG } from "./qr.js";

export const APP_URL = "https://vakosv.github.io/pricecheck/";
const IOS_KEY = "pc.iosbanner.closed"; // when the iPhone banner was closed (ms)
const IOS_PAUSE = 14 * 24 * 3600 * 1000;

let offer = null; // the beforeinstallprompt event, while Chrome allows installing

export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

/** iPhone Safari itself (not Chrome/Firefox/Edge for iOS or an app's built-in browser). */
export function isIPhoneSafari() {
  const ua = navigator.userAgent;
  return /iPhone|iPod/.test(ua) && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua);
}

export const canInstall = () => !!offer && !isInstalled();

/** Show or hide every [data-install] button. */
export function syncInstallButtons() {
  document.querySelectorAll("[data-install]").forEach((b) => { b.hidden = !canInstall(); });
}

async function install() {
  if (!offer) return;
  const e = offer;
  e.prompt();
  try { await e.userChoice; } catch {}
  offer = null; // an offer can be used once
  syncInstallButtons();
}

export function initInstall() {
  if (window.__installEvent) offer = window.__installEvent;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); offer = e; syncInstallButtons(); });
  addEventListener("appinstalled", () => { offer = null; syncInstallButtons(); });
  document.addEventListener("click", (e) => { if (e.target.closest("[data-install]")) install(); });
  syncInstallButtons();

  // iPhone Safari: a closable banner, not again for 14 days after closing
  const ban = document.getElementById("iosbanner");
  let closed = 0;
  try { closed = +localStorage.getItem(IOS_KEY) || 0; } catch {}
  if (ban && isIPhoneSafari() && !isInstalled() && Date.now() - closed > IOS_PAUSE) {
    ban.hidden = false;
    document.getElementById("iosx").onclick = () => {
      ban.hidden = true;
      try { localStorage.setItem(IOS_KEY, String(Date.now())); } catch {}
    };
  }

  // "Open on phone" QR code (shown on computers by CSS; not inside the installed app)
  const qr = document.getElementById("qrbox");
  if (qr) qr.innerHTML = qrSVG(APP_URL); // its label: data-i18n-aria on #qrbox
  if (isInstalled()) document.documentElement.classList.add("installed");
}
