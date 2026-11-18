const injectedTabs = new Set();
const stylesheetHeaders = new Map();
const traceSessions = new Map();
const VALID_MODES = new Set(["curl", "glass", "xray", "fabric"]);

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ effectMode: "fabric" }).then(({ effectMode }) => {
    if (!VALID_MODES.has(effectMode)) return chrome.storage.local.set({ effectMode: "fabric" });
  }).catch(() => {});
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;

  if (method === "CSS.styleSheetAdded" && params?.header) {
    let map = stylesheetHeaders.get(tabId);
    if (!map) {
      map = new Map();
      stylesheetHeaders.set(tabId, map);
    }
    map.set(params.header.styleSheetId, params.header);
  }

  const trace = traceSessions.get(tabId);
  if (!trace) return;

  if (method === "Network.requestWillBeSent" && params?.request) {
    const url = params.request.url || "";
    if (/^(data|blob|chrome|chrome-extension):/i.test(url)) return;
    trace.requests.set(params.requestId, {
      requestId: params.requestId,
      url,
      method: params.request.method || "GET",
      type: params.type || "Other",
      timestamp: params.timestamp || 0,
      wallTime: params.wallTime || 0,
      documentURL: params.documentURL || "",
      initiatorType: params.initiator?.type || "other",
      initiatorURL: params.initiator?.url || params.initiator?.stack?.callFrames?.[0]?.url || "",
      initiatorLine: params.initiator?.lineNumber ?? params.initiator?.stack?.callFrames?.[0]?.lineNumber ?? null,
      hasUserGesture: Boolean(params.hasUserGesture),
      status: null,
      mimeType: "",
      protocol: "",
      failed: false
    });
  }

  if (method === "Network.responseReceived") {
    const item = trace.requests.get(params.requestId);
    if (item) {
      item.status = params.response?.status ?? null;
      item.mimeType = params.response?.mimeType || "";
      item.protocol = params.response?.protocol || "";
      item.fromDiskCache = Boolean(params.response?.fromDiskCache);
      item.fromServiceWorker = Boolean(params.response?.fromServiceWorker);
    }
  }

  if (method === "Network.loadingFailed") {
    const item = trace.requests.get(params.requestId);
    if (item) {
      item.failed = true;
      item.errorText = params.errorText || "Request failed";
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (!source.tabId) return;
  stylesheetHeaders.delete(source.tabId);
  const trace = traceSessions.get(source.tabId);
  if (trace && !trace.finishing) {
    clearTimeout(trace.timer);
    traceSessions.delete(source.tabId);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-reality-tear") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const mode = await getStoredMode();
  await toggleOnTab(tab, mode);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  stylesheetHeaders.delete(tabId);
  stopTraceSilently(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    injectedTabs.delete(tabId);
    stylesheetHeaders.delete(tabId);
    stopTraceSilently(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "RT_POPUP_ACTIVATE") {
    activateFromPopup(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "RT_POPUP_MODE_CHANGED") {
    updateModeFromPopup(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (!sender.tab?.id) return false;
  const tabId = sender.tab.id;

  if (message?.type === "RT_BEGIN_TEAR") {
    inspectAndCapture(tabId, sender.tab.windowId, message)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "RT_INSPECT_ONLY") {
    inspectOnly(tabId, message)
      .then((inspection) => sendResponse({ ok: true, inspection }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "RT_CAPTURE_ONLY") {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
      .then((screenshot) => sendResponse({ ok: true, screenshot }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "RT_START_TRACE") {
    startNetworkTrace(tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  if (message?.type === "RT_FINISH_TRACE") {
    finishNetworkTrace(tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  return false;
});

async function activateFromPopup(message) {
  const tabId = Number(message.tabId);
  if (!Number.isInteger(tabId)) throw new Error("No active tab was supplied by the extension menu.");
  const tab = await chrome.tabs.get(tabId);
  const mode = sanitizeMode(message.mode);
  await chrome.storage.local.set({ effectMode: mode });
  await armOnTab(tab, mode);
}

async function updateModeFromPopup(message) {
  const tabId = Number(message.tabId);
  const mode = sanitizeMode(message.mode);
  await chrome.storage.local.set({ effectMode: mode });
  if (!Number.isInteger(tabId)) return;
  await chrome.tabs.sendMessage(tabId, { type: "RT_SET_MODE", mode }).catch(() => {});
}

async function toggleOnTab(tab, mode) {
  if (!isInjectableUrl(tab.url)) {
    await setBadge(tab.id, "×", "Reality Tear cannot run on this browser-protected page.");
    return;
  }

  try {
    await ensureInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "RT_TOGGLE", mode: sanitizeMode(mode) });
    await setBadge(tab.id, "", "Reality Tear Inspector");
  } catch (error) {
    injectedTabs.delete(tab.id);
    console.error("Reality Tear injection failed", error);
    await setBadge(tab.id, "!", normalizeError(error));
  }
}

async function armOnTab(tab, mode) {
  if (!tab?.id) throw new Error("No active tab found.");
  if (!isInjectableUrl(tab.url)) {
    await setBadge(tab.id, "×", "Reality Tear cannot run on this browser-protected page.");
    throw new Error("Reality Tear cannot run on Chrome internal pages, the Web Store, or other browser-protected surfaces.");
  }

  try {
    await ensureInjected(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "RT_ARM", mode: sanitizeMode(mode) });
    await setBadge(tab.id, "", `${modeLabel(mode)} · Reality Tear Inspector`);
  } catch (error) {
    injectedTabs.delete(tab.id);
    await setBadge(tab.id, "!", normalizeError(error));
    throw error;
  }
}

async function ensureInjected(tabId) {
  if (!injectedTabs.has(tabId)) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/tear-engine.js", "src/content.js"]
    });
    injectedTabs.add(tabId);
  }
}

async function getStoredMode() {
  const { effectMode } = await chrome.storage.local.get({ effectMode: "fabric" });
  return sanitizeMode(effectMode);
}

function sanitizeMode(mode) {
  return VALID_MODES.has(mode) ? mode : "fabric";
}

function modeLabel(mode) {
  return ({ curl: "Page Curl", glass: "Glass", xray: "X-Ray", fabric: "Fabric" })[sanitizeMode(mode)];
}
async function inspectOnly(tabId, message) {
  try {
    return await inspectWithCDP(tabId, message.x, message.y);
  } catch (error) {
    return normalizeFallbackInspection(message.fallback, message.x, message.y, normalizeError(error));
  }
}

async function inspectAndCapture(tabId, windowId, message) {
  const capturePromise = chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  let inspection;
  let debuggerError = null;

  try {
    inspection = await inspectWithCDP(tabId, message.x, message.y);
  } catch (error) {
    debuggerError = normalizeError(error);
    inspection = normalizeFallbackInspection(message.fallback, message.x, message.y, debuggerError);
  }

  const screenshot = await capturePromise;
  return { screenshot, inspection, debuggerError };
}

async function inspectWithCDP(tabId, x, y) {
  const target = { tabId };
  let attached = false;
  stylesheetHeaders.set(tabId, new Map());

  try {
    await chrome.debugger.attach(target, "1.3");
    attached = true;

    await chrome.debugger.sendCommand(target, "DOM.enable", { includeWhitespace: "none" });
    await chrome.debugger.sendCommand(target, "CSS.enable");
    await chrome.debugger.sendCommand(target, "DOM.getDocument", { depth: 0, pierce: true });

    // CSS.styleSheetAdded events are delivered asynchronously after CSS.enable.
    await delay(24);

    const hit = await chrome.debugger.sendCommand(target, "DOM.getNodeForLocation", {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      includeUserAgentShadowDOM: false,
      ignorePointerEventsNone: false
    });

    if (!hit?.nodeId) {
      throw new Error("Chrome resolved a backend node but did not expose a DOM node id.");
    }

    const nodeId = await elevateInspectableNode(target, hit.nodeId);
    const [description, outer, matched, computed, box, eventListeners] = await Promise.all([
      chrome.debugger.sendCommand(target, "DOM.describeNode", { nodeId, depth: 0 }),
      chrome.debugger.sendCommand(target, "DOM.getOuterHTML", { nodeId, includeShadowDOM: true }),
      chrome.debugger.sendCommand(target, "CSS.getMatchedStylesForNode", { nodeId }),
      chrome.debugger.sendCommand(target, "CSS.getComputedStyleForNode", { nodeId }),
      chrome.debugger.sendCommand(target, "DOM.getBoxModel", { nodeId }).catch(() => null),
      getEventListenersForNode(target, nodeId).catch(() => [])
    ]);

    return normalizeCDPInspection({
      tabId,
      nodeId,
      description: description?.node,
      outerHTML: outer?.outerHTML,
      matched,
      computed: computed?.computedStyle,
      box: box?.model,
      eventListeners,
      frameId: hit.frameId
    });
  } finally {
    if (attached) {
      await chrome.debugger.detach(target).catch(() => {});
    }
    stylesheetHeaders.delete(tabId);
  }
}

async function elevateInspectableNode(target, initialNodeId) {
  let objectId = null;
  let elevatedObjectId = null;
  try {
    await chrome.debugger.sendCommand(target, "Runtime.enable");
    const resolved = await chrome.debugger.sendCommand(target, "DOM.resolveNode", { nodeId: initialNodeId });
    objectId = resolved?.object?.objectId || null;
    if (!objectId) return initialNodeId;

    const result = await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function () {
        let el = this;
        if (el && el.nodeType !== 1) el = el.parentElement;
        if (!el || el.nodeType !== 1) return this;
        const interactive = el.closest?.("button, a, input, select, textarea, summary, [role='button'], [role='link'], [role='checkbox'], [role='tab']");
        if (interactive && interactive !== document.documentElement && interactive !== document.body) return interactive;
        if ((el.localName === "path" || el.localName === "use" || el.localName === "g") && el.closest?.("svg")) return el.closest("svg");
        return el;
      }`,
      returnByValue: false,
      silent: true
    });

    elevatedObjectId = result?.result?.objectId || null;
    if (!elevatedObjectId) return initialNodeId;
    const requested = await chrome.debugger.sendCommand(target, "DOM.requestNode", { objectId: elevatedObjectId });
    return requested?.nodeId || initialNodeId;
  } catch (_) {
    return initialNodeId;
  } finally {
    if (elevatedObjectId) {
      await chrome.debugger.sendCommand(target, "Runtime.releaseObject", { objectId: elevatedObjectId }).catch(() => {});
    }
    if (objectId && objectId !== elevatedObjectId) {
      await chrome.debugger.sendCommand(target, "Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }
}

async function getEventListenersForNode(target, nodeId) {
  await chrome.debugger.sendCommand(target, "Runtime.enable").catch(() => {});
  const resolved = await chrome.debugger.sendCommand(target, "DOM.resolveNode", { nodeId });
  const objectId = resolved?.object?.objectId;
  if (!objectId) return [];
  try {
    const result = await chrome.debugger.sendCommand(target, "DOMDebugger.getEventListeners", {
      objectId,
      depth: 2,
      pierce: true
    });
    return (result?.listeners || []).slice(0, 80).map((listener) => ({
      type: listener.type || "event",
      useCapture: Boolean(listener.useCapture),
      passive: Boolean(listener.passive),
      once: Boolean(listener.once),
      scriptId: listener.scriptId || null,
      lineNumber: Number.isFinite(listener.lineNumber) ? listener.lineNumber + 1 : null,
      columnNumber: Number.isFinite(listener.columnNumber) ? listener.columnNumber + 1 : null,
      handler: truncate(listener.handler?.description || listener.originalHandler?.description || "", 1200)
    }));
  } finally {
    await chrome.debugger.sendCommand(target, "Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

function normalizeCDPInspection(data) {
  const node = data.description || {};
  const matched = data.matched || {};
  const headers = stylesheetHeaders.get(data.tabId) || new Map();

  const matchedRules = (matched.matchedCSSRules || [])
    .slice(0, 120)
    .map((match) => normalizeRule(match.rule, match.matchingSelectors, headers))
    .filter(Boolean);

  const inheritedRules = [];
  for (const entry of matched.inherited || []) {
    for (const match of entry.matchedCSSRules || []) {
      if (inheritedRules.length >= 40) break;
      const rule = normalizeRule(match.rule, match.matchingSelectors, headers);
      if (rule) inheritedRules.push(rule);
    }
    if (inheritedRules.length >= 40) break;
  }

  const pseudoRules = [];
  for (const pseudo of matched.pseudoElements || []) {
    for (const match of pseudo.matches || []) {
      if (pseudoRules.length >= 40) break;
      const rule = normalizeRule(match.rule, match.matchingSelectors, headers);
      if (rule) {
        rule.pseudoType = pseudo.pseudoType || "pseudo";
        pseudoRules.push(rule);
      }
    }
    if (pseudoRules.length >= 40) break;
  }

  return {
    mode: "cdp",
    nodeId: data.nodeId,
    frameId: data.frameId || null,
    tagName: (node.localName || node.nodeName || "element").toLowerCase(),
    nodeName: node.nodeName || "",
    attributes: flattenAttributes(node.attributes),
    html: truncate(data.outerHTML || "", 60000),
    inlineStyle: normalizeStyle(matched.inlineStyle),
    attributesStyle: normalizeStyle(matched.attributesStyle),
    matchedRules,
    inheritedRules,
    pseudoRules,
    computed: (data.computed || []).map(({ name, value }) => ({ name, value })),
    eventListeners: data.eventListeners || [],
    box: normalizeBox(data.box)
  };
}

function normalizeRule(rule, matchingSelectors = [], headers) {
  if (!rule) return null;
  const styleSheetId = rule.styleSheetId || rule.style?.styleSheetId || null;
  const header = styleSheetId ? headers.get(styleSheetId) : null;
  const selectorText = rule.selectorList?.text ||
    (rule.selectorList?.selectors || []).map((selector) => selector.text).join(", ") ||
    "<style rule>";
  const range = rule.selectorList?.range || rule.style?.range || null;

  return {
    selector: selectorText,
    matchingSelectors: Array.isArray(matchingSelectors) ? matchingSelectors : [],
    origin: rule.origin || "regular",
    styleSheetId,
    sourceURL: header?.sourceURL || header?.sourceMapURL || "",
    line: range ? range.startLine + 1 : null,
    column: range ? range.startColumn + 1 : null,
    declarations: normalizeStyle(rule.style)
  };
}

function normalizeStyle(style) {
  if (!style) return [];
  const seen = new Set();
  const declarations = [];

  for (const prop of style.cssProperties || []) {
    if (!prop?.name || prop.disabled || prop.parsedOk === false) continue;
    const key = `${prop.name}\u0000${prop.value}\u0000${prop.important ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    declarations.push({
      name: prop.name,
      value: prop.value ?? "",
      important: Boolean(prop.important),
      implicit: Boolean(prop.implicit)
    });
  }
  return declarations.slice(0, 160);
}

function normalizeFallbackInspection(fallback, x, y, debuggerError) {
  if (!fallback) {
    return {
      mode: "fallback",
      tagName: "element",
      html: "<!-- Element inspection unavailable -->",
      matchedRules: [],
      inheritedRules: [],
      pseudoRules: [],
      inlineStyle: [],
      attributesStyle: [],
      computed: [],
      eventListeners: [],
      box: { x, y, width: 1, height: 1 },
      debuggerError
    };
  }

  return {
    mode: "fallback",
    tagName: fallback.tagName || "element",
    nodeName: fallback.nodeName || "",
    attributes: fallback.attributes || [],
    html: truncate(fallback.html || "", 60000),
    matchedRules: fallback.matchedRules || [],
    inheritedRules: [],
    pseudoRules: [],
    inlineStyle: fallback.inlineStyle || [],
    attributesStyle: [],
    computed: fallback.computed || [],
    eventListeners: fallback.eventListeners || [],
    box: fallback.box || { x, y, width: 1, height: 1 },
    debuggerError
  };
}

function normalizeBox(model) {
  if (!model?.border || model.border.length < 8) return null;
  const xs = [model.border[0], model.border[2], model.border[4], model.border[6]];
  const ys = [model.border[1], model.border[3], model.border[5], model.border[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function flattenAttributes(attributes) {
  if (!Array.isArray(attributes)) return [];
  const out = [];
  for (let i = 0; i < attributes.length; i += 2) {
    out.push({ name: attributes[i], value: attributes[i + 1] ?? "" });
  }
  return out;
}

async function startNetworkTrace(tabId) {
  if (traceSessions.has(tabId)) {
    await finishNetworkTrace(tabId).catch(() => {});
  }

  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  const trace = {
    target,
    requests: new Map(),
    startedAt: Date.now(),
    finishing: false,
    timer: null
  };
  traceSessions.set(tabId, trace);

  try {
    await chrome.debugger.sendCommand(target, "Network.enable", {
      maxTotalBufferSize: 8 * 1024 * 1024,
      maxResourceBufferSize: 2 * 1024 * 1024
    });
  } catch (error) {
    traceSessions.delete(tabId);
    await chrome.debugger.detach(target).catch(() => {});
    throw error;
  }

  trace.timer = setTimeout(() => {
    finishNetworkTrace(tabId).catch(() => {});
  }, 9000);

  return { startedAt: trace.startedAt };
}

async function finishNetworkTrace(tabId) {
  const trace = traceSessions.get(tabId);
  if (!trace) return { requests: [], durationMs: 0 };
  trace.finishing = true;
  clearTimeout(trace.timer);

  const requests = [...trace.requests.values()]
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
    .slice(0, 100);
  const durationMs = Math.max(0, Date.now() - trace.startedAt);
  traceSessions.delete(tabId);

  await chrome.debugger.sendCommand(trace.target, "Network.disable").catch(() => {});
  await chrome.debugger.detach(trace.target).catch(() => {});
  return { requests, durationMs };
}

function stopTraceSilently(tabId) {
  const trace = traceSessions.get(tabId);
  if (!trace) return;
  trace.finishing = true;
  clearTimeout(trace.timer);
  traceSessions.delete(tabId);
  chrome.debugger.detach(trace.target).catch(() => {});
}

async function setBadge(tabId, text, title) {
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#7f1d1d" }).catch(() => {});
  await chrome.action.setTitle({ tabId, title }).catch(() => {});
}

function isInjectableUrl(url = "") {
  return /^(https?|file):/i.test(url);
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n<!-- truncated -->` : text;
}

function normalizeError(error) {
  return error?.message || String(error || "Unknown error");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
