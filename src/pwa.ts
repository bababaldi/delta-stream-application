export async function startOfflineApp(base: string): Promise<void> {
  const status = document.querySelector<HTMLElement>("#pwa-status")!;
  const message = document.querySelector<HTMLElement>("#pwa-message")!;
  const button = document.querySelector<HTMLButtonElement>("#pwa-update")!;
  const show = (text: string) => {
    message.textContent = text;
    status.hidden = false;
  };
  if (!("serviceWorker" in navigator)) {
    show("Offline installation is unavailable in this browser. Use the site online.");
    return;
  }
  let updating = false;
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloadPending = false;
  try {
    const registration = await navigator.serviceWorker.register(`${base}sw.js`, {
      scope: base,
      updateViaCache: "none",
    });
    const refresh = () => {
      if (reloadPending || (registration.waiting && navigator.serviceWorker.controller)) {
        show("Update ready. Reloading clears unsaved form fields; saved team drafts stay on this browser.");
        button.hidden = false;
      } else if (registration.active) {
        show("Offline copy ready. Data freshness is shown in Meta.");
        button.hidden = true;
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updating) {
        window.location.reload();
        return;
      }
      reloadPending = controlled;
      controlled = true;
      refresh();
    });
    button.addEventListener("click", () => {
      if (!registration.waiting) {
        if (reloadPending) window.location.reload();
        return;
      }
      updating = true;
      button.disabled = true;
      registration.waiting.postMessage("ACTIVATE_UPDATE");
    });
    const watch = (worker: ServiceWorker | null) => worker?.addEventListener("statechange", () => {
      refresh();
      if (worker.state === "redundant" && !registration.active)
        show("Offline setup failed. Stay online and reload to retry.");
    });
    watch(registration.installing);
    registration.addEventListener("updatefound", () => watch(registration.installing));
    void navigator.serviceWorker.ready.then(refresh);
    refresh();
    // No timers or telemetry: check only on launch, reconnect or returning to the app.
    const check = () => { void registration.update().catch(() => {}); };
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  } catch {
    show("Offline setup is unavailable. Stay online and reload to retry.");
  }
}
