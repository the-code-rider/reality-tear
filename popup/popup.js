const MODES = new Set(["curl", "glass", "xray", "fabric"]);
let selectedMode = "fabric";

const cards = [...document.querySelectorAll(".mode-card")];
const activateButton = document.getElementById("activate");
const status = document.getElementById("status");

init().catch((error) => showStatus(error?.message || String(error), true));

async function init() {
  const stored = await chrome.storage.local.get({ effectMode: "fabric" });
  selectMode(MODES.has(stored.effectMode) ? stored.effectMode : "fabric", false);

  for (const card of cards) {
    card.addEventListener("click", async () => {
      selectMode(card.dataset.mode, true);
      await chrome.storage.local.set({ effectMode: selectedMode });
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.runtime.sendMessage({ type: "RT_POPUP_MODE_CHANGED", tabId: tab.id, mode: selectedMode }).catch(() => {});
      }
    });
  }

  activateButton.addEventListener("click", activate);
}

function selectMode(mode, announce) {
  if (!MODES.has(mode)) return;
  selectedMode = mode;
  for (const card of cards) {
    const selected = card.dataset.mode === mode;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-checked", String(selected));
  }
  if (announce) showStatus(`${labelForMode(mode)} selected`);
}

async function activate() {
  activateButton.disabled = true;
  showStatus("Arming inspector…");
  try {
    await chrome.storage.local.set({ effectMode: selectedMode });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const response = await chrome.runtime.sendMessage({
      type: "RT_POPUP_ACTIVATE",
      tabId: tab.id,
      mode: selectedMode
    });

    if (!response?.ok) throw new Error(response?.error || "Could not activate on this page.");
    showStatus(`${labelForMode(selectedMode)} armed — drag an element`);
    setTimeout(() => window.close(), 260);
  } catch (error) {
    showStatus(error?.message || String(error), true);
  } finally {
    activateButton.disabled = false;
  }
}

function labelForMode(mode) {
  return ({ curl: "Page Curl", glass: "Glass", xray: "X-Ray", fabric: "Fabric" })[mode] || mode;
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}
