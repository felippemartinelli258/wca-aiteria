// WC Açaíteria - PWA Update Helper
(function () {
  if (!("serviceWorker" in navigator)) return;

  let hasUpdate = false;
  let waitingSW = null;

  function makeBanner() {
    // não cria 2x
    if (document.getElementById("pwa-update-banner")) return;

    const bar = document.createElement("div");
    bar.id = "pwa-update-banner";
    bar.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      background: rgba(18,18,26,.92);
      color: #fff;
      border: 1px solid rgba(255,255,255,.10);
      box-shadow: 0 18px 40px rgba(0,0,0,.35);
      border-radius: 16px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: 92vw;
      backdrop-filter: blur(10px);
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
    `;

    const msg = document.createElement("div");
    msg.style.cssText = `font-size: 13px; color: rgba(255,255,255,.9);`;
    msg.innerHTML = `<b style="font-size:13px">Nova versão disponível</b><div style="font-size:12px;color:rgba(255,255,255,.7)">Atualize para ver as mudanças.</div>`;

    const btn = document.createElement("button");
    btn.textContent = "Atualizar agora";
    btn.style.cssText = `
      border: 0;
      background: #7c3aed;
      color: #fff;
      padding: 10px 12px;
      border-radius: 14px;
      font-weight: 800;
      cursor: pointer;
      white-space: nowrap;
    `;

    const close = document.createElement("button");
    close.textContent = "Agora não";
    close.style.cssText = `
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: rgba(255,255,255,.85);
      padding: 10px 12px;
      border-radius: 14px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    `;

    btn.onclick = () => {
      if (waitingSW) {
        waitingSW.postMessage({ type: "SKIP_WAITING" });
      } else {
        // fallback
        window.location.reload();
      }
    };

    close.onclick = () => bar.remove();

    bar.appendChild(msg);
    bar.appendChild(btn);
    bar.appendChild(close);
    document.body.appendChild(bar);
  }

  function trackUpdate(reg) {
    if (!reg) return;

    // se já tem um worker esperando
    if (reg.waiting) {
      waitingSW = reg.waiting;
      hasUpdate = true;
      makeBanner();
      return;
    }

    // quando achar update
    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        // installed + já existe controller => tem update
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          waitingSW = reg.waiting || newWorker;
          hasUpdate = true;
          makeBanner();
        }
      });
    });
  }

  // quando o SW novo assumir, recarrega a página
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasUpdate) window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/service-worker.js");
      trackUpdate(reg);

      // checa update a cada 30s (opcional, bom em produção)
      setInterval(() => reg.update().catch(() => {}), 30000);
    } catch (e) {
      // silencioso
    }
  });
})();