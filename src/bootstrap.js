const BUILD_ID = "20260325a";

function mergeRuntimeConfig(patch) {
  if (!patch || typeof patch !== "object") return;
  const current = window.MONOBRICK_RUNTIME && typeof window.MONOBRICK_RUNTIME === "object" ? window.MONOBRICK_RUNTIME : {};
  const currentEndpoints =
    current.endpoints && typeof current.endpoints === "object" ? current.endpoints : {};
  const patchEndpoints = patch.endpoints && typeof patch.endpoints === "object" ? patch.endpoints : {};

  window.MONOBRICK_RUNTIME = {
    ...current,
    ...patch,
    endpoints: {
      ...currentEndpoints,
      ...patchEndpoints
    }
  };
}

function withBuildVersion(urlLike) {
  const url = new URL(urlLike, window.location.href);
  if (!url.searchParams.has("v")) {
    url.searchParams.set("v", BUILD_ID);
  }
  return url;
}

async function probeResource(url) {
  try {
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
}

async function loadOptionalRuntimeJson() {
  const jsonUrl = withBuildVersion(new URL("../runtime-config.json", import.meta.url));
  const response = await probeResource(jsonUrl);
  if (!response) return false;
  try {
    const parsed = await response.json();
    mergeRuntimeConfig(parsed);
    return true;
  } catch {
    return false;
  }
}

async function injectScript(src, type = "text/javascript") {
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.type = type;
    script.async = false;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });
}

async function loadOptionalScript(url, type = "text/javascript") {
  return injectScript(url.toString(), type);
}

async function loadOptionalRuntimeScript() {
  const scriptUrl = withBuildVersion(new URL("../runtime-config.js", import.meta.url));
  const probe = await probeResource(scriptUrl);
  if (!probe) return false;
  return loadOptionalScript(scriptUrl);
}

function getWalletAdapterCandidates() {
  const runtime = window.MONOBRICK_RUNTIME && typeof window.MONOBRICK_RUNTIME === "object" ? window.MONOBRICK_RUNTIME : {};
  const candidates = [];
  const runtimeUrl = typeof runtime.walletAdapterUrl === "string" ? runtime.walletAdapterUrl.trim() : "";
  if (runtimeUrl) {
    try {
      candidates.push(withBuildVersion(new URL(runtimeUrl, window.location.href)));
    } catch {
      // Ignore invalid runtime wallet adapter URL.
    }
  }
  return candidates;
}

async function loadOptionalWalletAdapter() {
  const candidates = getWalletAdapterCandidates();
  for (const url of candidates) {
    const loaded = await loadOptionalScript(url);
    if (loaded && window.MONOBRICK_WALLET_ADAPTER) return true;
  }
  try {
    if (window.MONOBRICK_WALLET_ADAPTER) return true;
  } catch {
    return false;
  }
  return false;
}

async function bootstrap() {
  window.MONOBRICK_RUNTIME = window.MONOBRICK_RUNTIME || {};
  await loadOptionalRuntimeJson();
  await loadOptionalRuntimeScript();
  await loadOptionalWalletAdapter();
  await import(`./app.js?v=${BUILD_ID}`);
}

bootstrap();
