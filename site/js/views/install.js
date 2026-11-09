// How to install: short steps for iPhone and Android, the install button when Chrome offers it,
// and the QR code to open the site on a phone.
import { APP_URL, isInstalled, isIPhoneSafari, syncInstallButtons } from "../install.js";
import { qrSVG } from "../qr.js";

export function render(view) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  view.innerHTML = `
    <h1 class="h">How to install the app</h1>
    <p class="hint">PriceCheck can sit on your home screen like an app: it opens full screen, starts at once from the saved copy (also offline) and checks for new prices in the background.</p>
    ${isInstalled() ? `<div class="note ok">You are using the installed app.</div>` : ""}
    <button type="button" class="btn" data-install hidden>Install app</button>

    <h2>iPhone (Safari)</h2>
    <ol class="steps">
      <li>Open <b>${APP_URL.replace("https://", "")}</b> in <b>Safari</b>.</li>
      <li>Tap <b>Share</b> <span class="sharei" aria-hidden="true">⬆</span> in the bar at the bottom (on iPad: at the top).</li>
      <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>PriceCheck</b> from the home screen.</li>
    </ol>
    <p class="note">On iPhone the installed app keeps its own storage, separate from Safari: My products, your selling prices and shop choices saved in Safari are not carried over. Install first, then save them in the app.</p>
    ${ios && !isIPhoneSafari() && !isInstalled() ? `<p class="note warn">You are not in Safari now. Open the link in Safari to install.</p>` : ""}

    <h2>Android (Chrome)</h2>
    <ol class="steps">
      <li>Open <b>${APP_URL.replace("https://", "")}</b> in <b>Chrome</b>.</li>
      <li>Tap <b>Install app</b> at the top of the page, or the <b>⋮</b> menu → <b>Install app</b> (on some phones: <b>Add to Home screen</b>).</li>
      <li>Tap <b>Install</b>. PriceCheck appears with your apps.</li>
    </ol>
    <p class="hint">On Android the app shares its storage with Chrome, so what you saved stays.</p>

    <h2>Computer</h2>
    <p class="hint">In Chrome or Edge: the install icon at the right end of the address bar. Or scan this code with the phone camera to open the site on the phone:</p>
    <div class="qrbig">${qrSVG(APP_URL, { label: "QR code for " + APP_URL })}</div>`;
  syncInstallButtons();
}
