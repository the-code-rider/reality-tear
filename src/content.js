(() => {
  if (globalThis.__RealityTearContentLoaded) return;
  globalThis.__RealityTearContentLoaded = true;

  const TearEngine = globalThis.__RealityTearEngineClass;
  if (!TearEngine) {
    console.error("Reality Tear: TearEngine was not injected.");
    return;
  }

  let state = "inactive";
  let targetElement = null;
  let currentInspection = null;
  let engine = null;
  let gesture = null;
  let activeTabName = "html";
  let hoverRaf = 0;
  let lastHoverEvent = null;
  let currentMode = "fabric";
  let currentStructure = null;
  let currentStacking = null;
  let inspectionPoint = null;
  let editBaselineStyle = null;
  let editUndoStack = [];
  let editPatch = "";
  let currentTrace = null;
  let traceClickSeen = false;
  let traceFinishTimer = 0;
  let activeTool = null;

  const MODE_META = Object.freeze({
    curl: { label: "Page Curl", arm: "Drag an element to peel the page back", drag: "Keep pulling to peel farther", revealed: "Drag the peeled surface to open it farther" },
    glass: { label: "Glass", arm: "Drag an element to fracture the page", drag: "Keep pulling to break through", revealed: "Drag the glass to fracture a wider area" },
    xray: { label: "X-Ray", arm: "Drag an element to open an X-ray lens", drag: "Move the lens and widen it", revealed: "Drag to move the X-ray lens" },
    fabric: { label: "Fabric", arm: "Drag an element to stretch the page", drag: "Keep pulling until the fabric frays", revealed: "Drag the fabric to widen the opening" }
  });

  const host = document.createElement("div");
  host.id = "__reality_tear_inspector__";
  host.style.cssText = [
    "all: initial",
    "position: fixed",
    "inset: 0",
    "z-index: 2147483647",
    "display: none",
    "pointer-events: none",
    "contain: layout style paint",
    "font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
  ].join(";");
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .stage { position: fixed; inset: 0; pointer-events: none; color: #e9eef7; }
      .substrate {
        position: absolute; inset: 0; z-index: 0; display: none; overflow: hidden;
        background:
          radial-gradient(circle at var(--tear-x, 50%) var(--tear-y, 50%), rgba(27,45,58,.42), transparent 32%),
          linear-gradient(135deg, #040608, #080c11 52%, #020304);
      }
      .substrate::before {
        content: ""; position: absolute; inset: 0; opacity: .16; pointer-events: none;
        background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
        background-size: 24px 24px;
      }
      canvas { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; display: none; pointer-events: none; }
      .blocker { position: absolute; inset: 0; z-index: 2; display: none; pointer-events: auto; cursor: grab; background: transparent; }
      .blocker.dragging { cursor: grabbing; }
      .selection {
        position: absolute; z-index: 3; display: none; pointer-events: none;
        border: 1px solid rgba(115, 220, 255, .95);
        background: rgba(81, 191, 230, .07);
        box-shadow: 0 0 0 1px rgba(0,0,0,.28), inset 0 0 22px rgba(72,205,255,.08);
        border-radius: 4px;
      }
      .selection-label {
        position: absolute; left: -1px; top: -25px; max-width: min(520px, calc(100vw - 24px));
        padding: 4px 7px; border-radius: 4px 4px 4px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        color: #dff8ff; background: rgba(5,12,17,.94); border: 1px solid rgba(115,220,255,.42);
        font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .hud {
        position: absolute; z-index: 5; top: 14px; left: 50%; transform: translateX(-50%);
        display: none; align-items: center; gap: 8px; max-width: calc(100vw - 24px); padding: 7px;
        border: 1px solid rgba(255,255,255,.13); border-radius: 11px; background: rgba(5,8,12,.91);
        box-shadow: 0 8px 30px rgba(0,0,0,.28); backdrop-filter: blur(10px);
        pointer-events: auto; color: #e8eef7;
      }
      .brand { display: flex; align-items: center; gap: 7px; padding: 0 8px 0 4px; min-width: 0; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #68d7ff; box-shadow: 0 0 12px rgba(104,215,255,.7); flex: 0 0 auto; }
      .status { max-width: 330px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 11px/1.2 ui-monospace, monospace; color: #dce7f5; }
      .tabs { display: none; gap: 4px; padding-left: 6px; border-left: 1px solid rgba(255,255,255,.1); }
      .effect-pill { flex: 0 0 auto; padding: 5px 7px; border-radius: 999px; border: 1px solid rgba(115,220,255,.24); color: #a7eaff; background: rgba(69,170,204,.08); font: 700 9px/1 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .05em; }
      button {
        appearance: none; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.055); color: #dce7f5;
        border-radius: 7px; min-height: 30px; padding: 5px 9px; font: 600 10px/1 ui-monospace, monospace; cursor: pointer;
      }
      button:hover { background: rgba(255,255,255,.10); }
      button:focus-visible { outline: 2px solid #73dcff; outline-offset: 2px; }
      button.active { background: rgba(84,199,238,.18); border-color: rgba(115,220,255,.48); color: #bcefff; }
      button.danger { color: #ffc1c1; }
      .actions { display: flex; gap: 4px; padding-left: 6px; border-left: 1px solid rgba(255,255,255,.1); }
      .code-card {
        position: absolute; width: min(700px, calc(100vw - 32px)); max-height: min(72vh, 760px); overflow: hidden;
        border: 1px solid rgba(126,211,235,.22); border-radius: 14px; background: rgba(4,7,10,.90);
        box-shadow: 0 26px 90px rgba(0,0,0,.50); color: #d8e4ef;
      }
      .code-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 15px 17px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .eyebrow { color: #6edbff; font: 700 10px/1.2 ui-monospace, monospace; text-transform: uppercase; letter-spacing: .12em; }
      .element-name { margin-top: 5px; max-width: 520px; color: #f2f6fb; font: 700 15px/1.25 ui-monospace, monospace; overflow-wrap: anywhere; }
      .mode { flex: 0 0 auto; border: 1px solid rgba(255,255,255,.1); border-radius: 999px; padding: 4px 7px; color: #9da9b7; font: 600 9px/1 ui-monospace, monospace; }
      pre { margin: 0; padding: 16px 18px 22px; max-height: min(60vh, 650px); overflow: auto; scrollbar-width: thin; white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 2; color: #cdd9e5; font: 12px/1.58 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      .code-fade { position: absolute; left: 0; right: 0; bottom: 0; height: 54px; pointer-events: none; background: linear-gradient(transparent, rgba(4,7,10,.98)); }
      .viz-overlay { position: absolute; inset: 0; z-index: 4; display: none; pointer-events: none; perspective: 900px; transform-style: preserve-3d; overflow: hidden; }
      .viz-box { position: absolute; border: 1px solid rgba(119,220,255,.72); background: rgba(20,74,94,.12); box-shadow: 0 12px 32px rgba(0,0,0,.24); transform-origin: 50% 50%; }
      .viz-box.layer { border-color: rgba(255,205,106,.72); background: rgba(118,78,15,.10); }
      .viz-label { position: absolute; left: 4px; top: 4px; max-width: min(360px, 70vw); padding: 3px 5px; border-radius: 4px; background: rgba(3,8,12,.90); color: #dff8ff; font: 600 9px/1.25 ui-monospace,monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tool-panel { position: absolute; z-index: 7; right: 14px; top: 62px; width: min(390px, calc(100vw - 28px)); max-height: calc(100vh - 84px); display: none; overflow: hidden; border: 1px solid rgba(255,255,255,.13); border-radius: 12px; background: rgba(5,8,12,.96); box-shadow: 0 22px 70px rgba(0,0,0,.46); pointer-events: auto; color: #e7eef8; }
      .tool-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 12px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
      .tool-title { color: #eef6ff; font: 700 12px/1.3 ui-monospace,monospace; }
      .tool-subtitle { margin-top: 3px; color: #8290a2; font: 10px/1.35 ui-monospace,monospace; }
      .tool-close { min-width: 30px; padding: 4px 7px; }
      .tool-body { max-height: calc(100vh - 150px); padding: 10px 12px 13px; overflow: auto; scrollbar-width: thin; font: 10px/1.45 ui-monospace,monospace; }
      .tool-section + .tool-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.07); }
      .tool-label { margin-bottom: 6px; color: #6edbff; font: 700 9px/1.2 ui-monospace,monospace; text-transform: uppercase; letter-spacing: .09em; }
      .tree-row, .layer-row, .listener-row, .request-row { margin: 3px 0; padding: 6px 7px; border: 1px solid rgba(255,255,255,.06); border-radius: 6px; background: rgba(255,255,255,.025); color: #cbd7e5; overflow-wrap: anywhere; }
      .tree-row strong, .layer-row strong, .listener-row strong, .request-row strong { color: #f0f5fb; font-weight: 700; }
      .muted { color: #7f8b9a; }
      .tool-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .editor { width: 100%; min-height: 190px; resize: vertical; padding: 10px; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; outline: none; background: #020406; color: #d9e5f2; font: 11px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; tab-size: 2; }
      .editor:focus { border-color: rgba(115,220,255,.58); box-shadow: 0 0 0 2px rgba(115,220,255,.08); }
      .editor-status { min-height: 16px; margin-top: 7px; color: #93a1b2; font: 9px/1.4 ui-monospace,monospace; }
      .trace-banner { position: absolute; z-index: 8; top: 14px; left: 50%; transform: translateX(-50%); display: none; max-width: calc(100vw - 28px); padding: 8px 11px; border: 1px solid rgba(255,205,106,.34); border-radius: 9px; background: rgba(24,17,5,.92); color: #ffe1a1; font: 700 10px/1.3 ui-monospace,monospace; pointer-events: none; }
      .toast {
        position: absolute; z-index: 6; bottom: 18px; left: 50%; transform: translateX(-50%); display: none;
        max-width: min(620px, calc(100vw - 30px)); padding: 8px 11px; border-radius: 8px;
        background: rgba(65,15,18,.94); border: 1px solid rgba(255,120,126,.24); color: #ffd4d6;
        font: 600 10px/1.4 ui-monospace, monospace; pointer-events: none;
      }
      @media (max-width: 720px) {
        .hud { left: 10px; right: 10px; transform: none; flex-wrap: wrap; }
        .status { max-width: 210px; }
        .code-card { width: calc(100vw - 20px); }
        .actions, .tabs { padding-left: 0; border-left: 0; }
        .tool-panel { left: 10px; right: 10px; top: 104px; width: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dot { box-shadow: none; }
      }
    </style>
    <div class="stage">
      <div class="substrate" id="substrate">
        <section class="code-card" id="codeCard" aria-hidden="true">
          <header class="code-head">
            <div>
              <div class="eyebrow" id="eyebrow">Runtime DOM</div>
              <div class="element-name" id="elementName">element</div>
            </div>
            <div class="mode" id="modeBadge">CDP</div>
          </header>
          <pre id="code"></pre>
          <div class="code-fade"></div>
        </section>
      </div>
      <canvas id="canvas"></canvas>
      <div class="blocker" id="blocker" aria-hidden="true"></div>
      <div class="selection" id="selection"><div class="selection-label" id="selectionLabel"></div></div>
      <div class="hud" id="hud">
        <div class="brand"><span class="dot"></span><span class="status" id="status">Drag an element to inspect it</span></div>
        <div class="effect-pill" id="effectPill">Fabric</div>
        <div class="tabs" id="tabs">
          <button type="button" data-tab="html" class="active">HTML</button>
          <button type="button" data-tab="css">CSS</button>
          <button type="button" data-tab="computed">Computed</button>
        </div>
        <div class="actions">
          <button type="button" id="explode">Explode DOM</button>
          <button type="button" id="layers">Layers</button>
          <button type="button" id="editCss">Edit CSS</button>
          <button type="button" id="trace">Trace</button>
          <button type="button" id="newTarget">New target</button>
          <button type="button" id="close" class="danger">Close</button>
        </div>
      </div>
      <div class="viz-overlay" id="vizOverlay"></div>
      <aside class="tool-panel" id="toolPanel" aria-hidden="true">
        <header class="tool-head">
          <div><div class="tool-title" id="toolTitle">Inspector tool</div><div class="tool-subtitle" id="toolSubtitle"></div></div>
          <button type="button" class="tool-close" id="toolClose" aria-label="Close tool panel">×</button>
        </header>
        <div class="tool-body" id="toolBody"></div>
      </aside>
      <div class="trace-banner" id="traceBanner">Tracing is armed — interact with the page once</div>
      <div class="toast" id="toast"></div>
    </div>
  `;

  const ui = {
    substrate: root.getElementById("substrate"),
    codeCard: root.getElementById("codeCard"),
    eyebrow: root.getElementById("eyebrow"),
    elementName: root.getElementById("elementName"),
    modeBadge: root.getElementById("modeBadge"),
    code: root.getElementById("code"),
    canvas: root.getElementById("canvas"),
    blocker: root.getElementById("blocker"),
    selection: root.getElementById("selection"),
    selectionLabel: root.getElementById("selectionLabel"),
    hud: root.getElementById("hud"),
    status: root.getElementById("status"),
    effectPill: root.getElementById("effectPill"),
    tabs: root.getElementById("tabs"),
    explode: root.getElementById("explode"),
    layers: root.getElementById("layers"),
    editCss: root.getElementById("editCss"),
    trace: root.getElementById("trace"),
    newTarget: root.getElementById("newTarget"),
    close: root.getElementById("close"),
    vizOverlay: root.getElementById("vizOverlay"),
    toolPanel: root.getElementById("toolPanel"),
    toolTitle: root.getElementById("toolTitle"),
    toolSubtitle: root.getElementById("toolSubtitle"),
    toolBody: root.getElementById("toolBody"),
    toolClose: root.getElementById("toolClose"),
    traceBanner: root.getElementById("traceBanner"),
    toast: root.getElementById("toast")
  };

  for (const button of ui.tabs.querySelectorAll("button[data-tab]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      setTab(button.dataset.tab);
    });
  }
  ui.explode.addEventListener("click", (event) => { event.stopPropagation(); toggleExplodedDOM(); });
  ui.layers.addEventListener("click", (event) => { event.stopPropagation(); toggleStackingLayers(); });
  ui.editCss.addEventListener("click", (event) => { event.stopPropagation(); openCssEditor(); });
  ui.trace.addEventListener("click", (event) => { event.stopPropagation(); openTracePanel(); });
  ui.toolClose.addEventListener("click", (event) => { event.stopPropagation(); clearTools(); });

  ui.newTarget.addEventListener("click", (event) => {
    event.stopPropagation();
    arm();
  });
  ui.close.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "RT_TOGGLE") {
      setMode(message.mode);
      if (state === "inactive") arm(currentMode);
      else close();
    }
    if (message?.type === "RT_ARM") {
      setMode(message.mode);
      arm(currentMode);
    }
    if (message?.type === "RT_SET_MODE") {
      const changed = setMode(message.mode);
      if (changed && state !== "inactive") arm(currentMode);
    }
  });

  window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
  window.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
  window.addEventListener("pointercancel", onPointerUp, { capture: true, passive: false });
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("resize", () => {
    if (engine) engine.resize();
    if (state === "armed" && targetElement?.isConnected) updateSelection(targetElement);
  });

  function arm(mode = currentMode) {
    if (state === "tracing") chrome.runtime.sendMessage({ type: "RT_FINISH_TRACE" }).catch(() => {});
    setMode(mode);
    state = "armed";
    currentInspection = null;
    targetElement = null;
    gesture = null;
    activeTabName = "html";
    currentStructure = null;
    currentStacking = null;
    inspectionPoint = null;
    editBaselineStyle = null;
    editUndoStack = [];
    editPatch = "";
    currentTrace = null;
    traceClickSeen = false;
    clearTimeout(traceFinishTimer);
    activeTool = null;
    host.style.display = "block";
    host.style.visibility = "visible";
    ui.substrate.style.display = "none";
    ui.canvas.style.display = "none";
    ui.blocker.style.display = "none";
    ui.blocker.classList.remove("dragging");
    ui.selection.style.display = "none";
    ui.hud.style.display = "flex";
    ui.tabs.style.display = "none";
    ui.status.textContent = modeMeta().arm;
    ui.effectPill.textContent = modeMeta().label;
    ui.toast.style.display = "none";
    ui.traceBanner.style.display = "none";
    clearTools();
    if (engine) {
      engine.stop();
      engine.setMode(currentMode);
      engine.reset();
    }
  }

  function close() {
    if (state === "tracing") chrome.runtime.sendMessage({ type: "RT_FINISH_TRACE" }).catch(() => {});
    state = "inactive";
    targetElement = null;
    currentInspection = null;
    gesture = null;
    host.style.display = "none";
    host.style.visibility = "visible";
    ui.selection.style.display = "none";
    ui.blocker.style.display = "none";
    ui.traceBanner.style.display = "none";
    clearTimeout(traceFinishTimer);
    clearTools();
    if (engine) engine.stop();
  }

  function onPointerMove(event) {
    if (state === "inactive" || state === "tracing") return;
    if (state !== "capturing" && state !== "dragging" && state !== "widening" && isControlPoint(event.clientX, event.clientY)) return;

    if (state === "armed") {
      lastHoverEvent = { x: event.clientX, y: event.clientY };
      if (!hoverRaf) {
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          if (state === "armed" && lastHoverEvent) inspectHover(lastHoverEvent.x, lastHoverEvent.y);
        });
      }
      return;
    }

    if (state === "capturing") {
      consume(event);
      updateGesture(event);
      return;
    }

    if (state === "dragging" || state === "widening") {
      consume(event);
      const moved = updateGesture(event);
      engine?.move(event.clientX, event.clientY, moved);
    }
  }

  function onPointerDown(event) {
    if (state === "tracing") {
      if (event.button === 0 && !traceClickSeen) {
        traceClickSeen = true;
        ui.traceBanner.textContent = `Observed ${DOMElementLabel(chooseInspectableElement(event.target))} · collecting requests…`;
        clearTimeout(traceFinishTimer);
        traceFinishTimer = setTimeout(() => finishInteractionTrace(false), 1800);
      }
      return;
    }
    if (event.button !== 0 || state === "inactive") return;
    if (state !== "capturing" && state !== "dragging" && state !== "widening" && isControlPoint(event.clientX, event.clientY)) return;

    if (state === "armed") {
      consume(event);
      beginInspectionTear(event).catch((error) => failAndRearm(error));
      return;
    }

    if (state === "revealed") {
      consume(event);
      gesture = newGesture(event);
      engine?.begin(event.clientX, event.clientY, currentMode === "curl");
      ui.blocker.classList.add("dragging");
      ui.status.textContent = modeMeta().drag;
      state = "widening";
      return;
    }

    if (state === "capturing" || state === "dragging" || state === "widening") {
      consume(event);
    }
  }

  function onPointerUp(event) {
    if (state === "tracing") return;
    if (state === "capturing") {
      consume(event);
      updateGesture(event);
      if (gesture) gesture.down = false;
      return;
    }

    if (state === "dragging" || state === "widening") {
      consume(event);
      updateGesture(event);
      if (gesture) gesture.down = false;
      engine?.end();
      ui.blocker.classList.remove("dragging");
      ui.status.textContent = `${elementLabel(currentInspection)} · ${modeMeta().revealed}`;
      state = "revealed";
    }
  }

  function onKeyDown(event) {
    if (state === "inactive") return;
    if (state === "tracing" && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finishInteractionTrace(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.composedPath?.().some((node) => node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node?.isContentEditable)) return;
    if (state === "revealed") {
      if (event.key === "1") setTab("html");
      if (event.key === "2") setTab("css");
      if (event.key === "3") setTab("computed");
      if (["PageDown", "PageUp", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const amount = event.key === "PageDown" ? 320 : event.key === "PageUp" ? -320 : event.key === "ArrowDown" ? 42 : -42;
        ui.code.scrollTop += amount;
      }
    }
  }

  function onWheel(event) {
    if (state !== "revealed" || isControlPoint(event.clientX, event.clientY)) return;
    consume(event);
    ui.code.scrollTop += event.deltaY;
  }

  async function beginInspectionTear(event) {
    targetElement = chooseInspectableElement(document.elementFromPoint(event.clientX, event.clientY));
    if (!targetElement) throw new Error("No inspectable element was found at that point.");

    inspectionPoint = { x: event.clientX, y: event.clientY };
    currentStructure = collectDOMStructure(targetElement);
    currentStacking = collectStackingContexts(targetElement);
    editBaselineStyle = targetElement.getAttribute("style");
    editUndoStack = [];
    editPatch = "";
    currentTrace = null;
    clearTools();

    gesture = newGesture(event);
    state = "capturing";
    ui.selection.style.display = "none";
    ui.status.textContent = `Freezing page + resolving DOM/CSS · ${modeMeta().label}…`;

    const fallback = buildFallbackInspection(targetElement);

    // Ensure neither our HUD nor hover box is baked into the captured page texture.
    host.style.visibility = "hidden";
    await nextPaint();
    await nextPaint();

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "RT_BEGIN_TEAR",
        x: gesture.startX,
        y: gesture.startY,
        fallback
      });
    } finally {
      host.style.visibility = "visible";
    }

    if (!response?.ok) throw new Error(response?.error || "Could not inspect this element.");

    currentInspection = response.inspection || fallback;
    renderInspection(currentInspection, gesture.startX, gesture.startY);

    if (!engine) {
      engine = new TearEngine(ui.canvas, {
        mode: currentMode,
        reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
      });
    }

    engine.stop();
    engine.setMode(currentMode);
    engine.reset();
    await engine.setScreenshot(response.screenshot);
    engine.begin(gesture.startX, gesture.startY);
    engine.move(gesture.lastX, gesture.lastY, gesture.totalDistance);

    ui.substrate.style.display = "block";
    ui.canvas.style.display = "block";
    ui.blocker.style.display = "block";
    ui.tabs.style.display = "flex";
    ui.status.textContent = `${elementLabel(currentInspection)} · ${modeMeta().drag}`;
    engine.start();

    if (response.debuggerError) {
      showToast(`CDP unavailable; using page-level fallback inspection. ${response.debuggerError}`, 5200);
    }

    if (gesture.down) {
      state = "dragging";
      ui.blocker.classList.add("dragging");
    } else {
      // Give the simulation one active frame even when the initial drag was released
      // before screenshot/inspection finished.
      state = "dragging";
      requestAnimationFrame(() => {
        engine?.end();
        ui.blocker.classList.remove("dragging");
        if (state === "dragging") {
          state = "revealed";
          ui.status.textContent = `${elementLabel(currentInspection)} · ${modeMeta().revealed}`;
        }
      });
    }
  }

  function inspectHover(x, y) {
    const raw = document.elementFromPoint(x, y);
    const el = chooseInspectableElement(raw);
    if (!el || el === host || !el.isConnected) {
      ui.selection.style.display = "none";
      targetElement = null;
      return;
    }
    targetElement = el;
    updateSelection(el);
  }

  function updateSelection(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      ui.selection.style.display = "none";
      return;
    }
    const x = Math.max(0, Math.min(window.innerWidth, rect.left));
    const y = Math.max(0, Math.min(window.innerHeight, rect.top));
    const right = Math.max(0, Math.min(window.innerWidth, rect.right));
    const bottom = Math.max(0, Math.min(window.innerHeight, rect.bottom));
    ui.selection.style.display = "block";
    ui.selection.style.left = `${x}px`;
    ui.selection.style.top = `${y}px`;
    ui.selection.style.width = `${Math.max(1, right - x)}px`;
    ui.selection.style.height = `${Math.max(1, bottom - y)}px`;
    ui.selectionLabel.textContent = DOMElementLabel(el);
    ui.selectionLabel.style.top = y < 31 ? "0" : "-25px";
  }

  function renderInspection(inspection, x, y) {
    const attrs = Object.fromEntries((inspection.attributes || []).map((a) => [a.name, a.value]));
    const tag = inspection.tagName || "element";
    const name = [
      tag,
      attrs.id ? `#${attrs.id}` : "",
      attrs.class ? `.${String(attrs.class).trim().split(/\s+/).slice(0, 3).join(".")}` : ""
    ].join("");

    ui.elementName.textContent = name || tag;
    ui.modeBadge.textContent = `${modeMeta().label} · ${inspection.mode === "cdp" ? "CDP" : "fallback"}`;
    ui.eyebrow.textContent = "Runtime DOM substrate";
    ui.substrate.style.setProperty("--tear-x", `${x}px`);
    ui.substrate.style.setProperty("--tear-y", `${y}px`);

    const panelWidth = Math.min(700, Math.max(320, window.innerWidth - 32));
    const estimatedHeight = Math.min(620, Math.max(260, window.innerHeight * 0.65));
    const left = clamp(x - 86, 10, Math.max(10, window.innerWidth - panelWidth - 10));
    const top = clamp(y - 84, 10, Math.max(10, window.innerHeight - estimatedHeight - 10));
    ui.codeCard.style.left = `${left}px`;
    ui.codeCard.style.top = `${top}px`;

    setTab(activeTabName);
  }

  function setTab(tabName) {
    if (!currentInspection) return;
    activeTabName = tabName;
    for (const button of ui.tabs.querySelectorAll("button[data-tab]")) {
      button.classList.toggle("active", button.dataset.tab === tabName);
    }

    if (tabName === "html") {
      ui.eyebrow.textContent = "Runtime HTML";
      ui.code.textContent = prettyHTML(currentInspection.html || "<!-- no HTML available -->");
    } else if (tabName === "css") {
      ui.eyebrow.textContent = "Matched authored CSS";
      ui.code.textContent = formatCSS(currentInspection);
    } else {
      ui.eyebrow.textContent = "Computed style";
      ui.code.textContent = formatComputed(currentInspection.computed || []);
    }
  }

  function formatCSS(inspection) {
    const chunks = [];
    if (inspection.inlineStyle?.length) {
      chunks.push("/* element.style */\n" + formatRule(":inline", inspection.inlineStyle));
    }
    if (inspection.attributesStyle?.length) {
      chunks.push("/* presentational attributes */\n" + formatRule(":attributes", inspection.attributesStyle));
    }

    for (const rule of inspection.matchedRules || []) {
      const source = formatSource(rule);
      chunks.push(`${source}\n${formatRule(rule.selector, rule.declarations)}`);
    }

    if (inspection.pseudoRules?.length) {
      chunks.push("/* ── pseudo-elements ───────────────────────── */");
      for (const rule of inspection.pseudoRules) {
        chunks.push(`${formatSource(rule)}\n${formatRule(`${rule.selector} /* ::${rule.pseudoType || "pseudo"} */`, rule.declarations)}`);
      }
    }

    if (inspection.inheritedRules?.length) {
      chunks.push("/* ── inherited matched rules ───────────────── */");
      for (const rule of inspection.inheritedRules) {
        chunks.push(`${formatSource(rule)}\n${formatRule(rule.selector, rule.declarations)}`);
      }
    }

    if (!chunks.length) return "/* No authored CSS rules were available for this element.\n   Switch to Computed to see the browser's final values. */";
    return chunks.join("\n\n");
  }

  function formatComputed(computed) {
    if (!computed.length) return "/* Computed style unavailable. */";
    return [...computed]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((prop) => `${prop.name}: ${prop.value};`)
      .join("\n");
  }

  function formatRule(selector, declarations = []) {
    const body = declarations
      .filter((prop) => prop?.name)
      .map((prop) => `  ${prop.name}: ${prop.value}${prop.important ? " !important" : ""};`)
      .join("\n");
    return `${selector || "<rule>"} {\n${body || "  /* empty */"}\n}`;
  }

  function formatSource(rule) {
    const location = rule.sourceURL || (rule.styleSheetId ? `stylesheet:${rule.styleSheetId}` : rule.origin || "author");
    const suffix = rule.line ? `:${rule.line}${rule.column ? `:${rule.column}` : ""}` : "";
    return `/* ${truncate(location, 150)}${suffix} · ${rule.origin || "regular"} */`;
  }

  function prettyHTML(html) {
    const source = truncate(String(html || ""), 50000).replace(/>\s*</g, "><");
    const tokens = source.replace(/></g, ">\n<").split("\n");
    let depth = 0;
    const out = [];
    const voidTag = /^<\s*(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i;
    for (const token of tokens) {
      const t = token.trim();
      if (!t) continue;
      const closing = /^<\s*\//.test(t);
      const comment = /^<\s*!/.test(t) || /^<\s*\?/.test(t);
      const selfClosing = /\/\s*>$/.test(t) || voidTag.test(t);
      if (closing) depth = Math.max(0, depth - 1);
      out.push(`${"  ".repeat(depth)}${t}`);
      const opening = /^<\s*[A-Za-z]/.test(t) && !closing && !selfClosing && !comment;
      const sameLineClosed = /^<[^>]+>.*<\//.test(t);
      if (opening && !sameLineClosed) depth = Math.min(24, depth + 1);
    }
    return out.join("\n");
  }

  function buildFallbackInspection(el) {
    const computed = getComputedStyle(el);
    const computedProps = [];
    for (let i = 0; i < computed.length; i++) {
      const name = computed[i];
      computedProps.push({ name, value: computed.getPropertyValue(name) });
    }

    const inlineStyle = [];
    for (let i = 0; i < el.style.length; i++) {
      const name = el.style[i];
      inlineStyle.push({
        name,
        value: el.style.getPropertyValue(name),
        important: el.style.getPropertyPriority(name) === "important"
      });
    }

    const rect = el.getBoundingClientRect();
    return {
      tagName: el.localName || "element",
      nodeName: el.nodeName,
      attributes: [...el.attributes].map((attr) => ({ name: attr.name, value: attr.value })),
      html: truncate(el.outerHTML || "", 60000),
      inlineStyle,
      computed: computedProps,
      matchedRules: collectAccessibleMatchedRules(el),
      eventListeners: [],
      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
    };
  }

  function collectAccessibleMatchedRules(el) {
    const matches = [];
    const limit = 80;

    function walk(ruleList, sourceURL, context = []) {
      if (!ruleList || matches.length >= limit) return;
      for (const rule of ruleList) {
        if (matches.length >= limit) break;
        try {
          if (rule.type === CSSRule.STYLE_RULE && rule.selectorText) {
            if (el.matches(rule.selectorText)) {
              const declarations = [];
              for (let i = 0; i < rule.style.length; i++) {
                const name = rule.style[i];
                declarations.push({
                  name,
                  value: rule.style.getPropertyValue(name),
                  important: rule.style.getPropertyPriority(name) === "important"
                });
              }
              matches.push({
                selector: rule.selectorText,
                origin: "regular",
                sourceURL,
                line: null,
                column: null,
                declarations,
                context: context.slice()
              });
            }
          } else if (rule.cssRules) {
            if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
              if (!matchMedia(rule.conditionText).matches) continue;
            }
            if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule) {
              try { if (!CSS.supports(rule.conditionText)) continue; } catch (_) {}
            }
            walk(rule.cssRules, sourceURL, context.concat(rule.cssText?.split("{")[0]?.trim() || "group"));
          }
        } catch (_) {
          // Invalid/unsupported selector for Element.matches: skip it.
        }
      }
    }

    for (const sheet of document.styleSheets) {
      if (matches.length >= limit) break;
      try {
        walk(sheet.cssRules, sheet.href || "<inline stylesheet>");
      } catch (_) {
        // Cross-origin stylesheets are deliberately opaque to page JavaScript.
      }
    }
    return matches;
  }

  function chooseInspectableElement(el) {
    if (!(el instanceof Element)) return null;
    if (el === host || host.contains(el)) return null;
    const interactive = el.closest?.("button, a, input, select, textarea, summary, [role='button'], [role='link'], [role='checkbox'], [role='tab']");
    if (interactive && interactive !== document.documentElement && interactive !== document.body) return interactive;
    if ((el.localName === "path" || el.localName === "use" || el.localName === "g") && el.closest("svg")) return el.closest("svg");
    return el;
  }

  function DOMElementLabel(el) {
    if (!el) return "element";
    const id = el.id ? `#${el.id}` : "";
    const classes = [...el.classList].filter(Boolean).slice(0, 3);
    const classPart = classes.length ? `.${classes.join(".")}` : "";
    const role = el.getAttribute("role");
    return `${el.localName || el.nodeName.toLowerCase()}${id}${classPart}${role ? ` [role=${role}]` : ""}`;
  }

  function elementLabel(inspection) {
    if (!inspection) return "element";
    const attrs = Object.fromEntries((inspection.attributes || []).map((a) => [a.name, a.value]));
    return `${inspection.tagName || "element"}${attrs.id ? `#${attrs.id}` : ""}`;
  }

  function newGesture(event) {
    return {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      totalDistance: 0,
      down: true
    };
  }

  function updateGesture(event) {
    if (!gesture) return 0;
    const dx = event.clientX - gesture.lastX;
    const dy = event.clientY - gesture.lastY;
    const distance = Math.hypot(dx, dy);
    gesture.totalDistance += distance;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    return distance;
  }

  function isControlPoint(x, y) {
    const candidates = [ui.hud, ui.toolPanel];
    for (const el of candidates) {
      if (!el || el.style.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
    return false;
  }

  function consume(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function showToast(message, duration = 3500) {
    ui.toast.textContent = message;
    ui.toast.style.display = "block";
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      ui.toast.style.display = "none";
    }, duration);
  }

  function clearTools() {
    activeTool = null;
    if (ui?.vizOverlay) {
      ui.vizOverlay.innerHTML = "";
      ui.vizOverlay.style.display = "none";
    }
    if (ui?.toolPanel) {
      ui.toolPanel.style.display = "none";
      ui.toolPanel.setAttribute("aria-hidden", "true");
      ui.toolBody.innerHTML = "";
    }
    for (const button of [ui?.explode, ui?.layers, ui?.editCss, ui?.trace]) {
      button?.classList.remove("active");
    }
  }

  function openToolPanel(kind, title, subtitle = "") {
    activeTool = kind;
    ui.toolTitle.textContent = title;
    ui.toolSubtitle.textContent = subtitle;
    ui.toolBody.innerHTML = "";
    ui.toolPanel.style.display = "block";
    ui.toolPanel.setAttribute("aria-hidden", "false");
    for (const [name, button] of [["explode", ui.explode], ["layers", ui.layers], ["edit", ui.editCss], ["trace", ui.trace]]) {
      button.classList.toggle("active", name === kind);
    }
  }

  function toggleExplodedDOM() {
    if (!currentInspection || !targetElement?.isConnected) return;
    if (activeTool === "explode") {
      clearTools();
      return;
    }
    openToolPanel("explode", "Exploded DOM", "Visible descendants are lifted away from the rendered surface.");
    currentStructure = collectDOMStructure(targetElement);
    renderExplodedVisualization(currentStructure);
    const section = createToolSection("DOM hierarchy");
    const rows = flattenStructure(currentStructure).slice(0, 60);
    for (const item of rows) {
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.marginLeft = `${Math.min(42, item.depth * 9)}px`;
      const prefix = item.depth ? "↳ " : "";
      row.textContent = `${prefix}${item.label}`;
      section.appendChild(row);
    }
    if (!rows.length) appendEmpty(section, "No visible element descendants were found.");
    ui.toolBody.appendChild(section);
  }

  function renderExplodedVisualization(structure) {
    ui.vizOverlay.innerHTML = "";
    ui.vizOverlay.style.display = "block";
    const items = flattenStructure(structure).filter((item) => item.rect && item.depth <= 2).slice(0, 14);
    items.forEach((item, index) => {
      const rect = item.rect;
      if (!rect || rect.width < 2 || rect.height < 2) return;
      const box = document.createElement("div");
      box.className = "viz-box";
      box.style.left = `${clamp(rect.left, 0, window.innerWidth)}px`;
      box.style.top = `${clamp(rect.top, 0, window.innerHeight)}px`;
      box.style.width = `${Math.max(1, Math.min(rect.width, window.innerWidth))}px`;
      box.style.height = `${Math.max(1, Math.min(rect.height, window.innerHeight))}px`;
      const lift = Math.min(120, item.depth * 34 + index * 4);
      box.style.transform = `translate3d(${item.depth * 9}px, ${-item.depth * 8}px, ${lift}px) rotateX(${Math.min(8, item.depth * 2.5)}deg)`;
      box.style.opacity = String(Math.max(0.34, 0.92 - item.depth * 0.16));
      const label = document.createElement("span");
      label.className = "viz-label";
      label.textContent = item.label;
      box.appendChild(label);
      ui.vizOverlay.appendChild(box);
    });
  }

  function toggleStackingLayers() {
    if (!currentInspection || !targetElement?.isConnected) return;
    if (activeTool === "layers") {
      clearTools();
      return;
    }
    openToolPanel("layers", "Stacking contexts", "Actual stacking-context triggers, not merely raw z-index values.");
    currentStacking = collectStackingContexts(targetElement);
    renderLayerVisualization(currentStacking);

    const section = createToolSection("Outer → selected element");
    for (const [index, item] of currentStacking.entries()) {
      const row = document.createElement("div");
      row.className = "layer-row";
      const strong = document.createElement("strong");
      strong.textContent = `${index + 1}. ${item.label}`;
      const meta = document.createElement("div");
      meta.className = "muted";
      meta.textContent = `z-index: ${item.zIndex} · ${item.reason}`;
      row.append(strong, meta);
      section.appendChild(row);
    }
    if (!currentStacking.length) appendEmpty(section, "No local stacking contexts were found beyond the root.");
    ui.toolBody.appendChild(section);
  }

  function renderLayerVisualization(items) {
    ui.vizOverlay.innerHTML = "";
    ui.vizOverlay.style.display = "block";
    items.slice(0, 14).forEach((item, index) => {
      const rect = item.rect;
      if (!rect || rect.width < 2 || rect.height < 2) return;
      const box = document.createElement("div");
      box.className = "viz-box layer";
      box.style.left = `${clamp(rect.left, 0, window.innerWidth)}px`;
      box.style.top = `${clamp(rect.top, 0, window.innerHeight)}px`;
      box.style.width = `${Math.max(1, Math.min(rect.width, window.innerWidth))}px`;
      box.style.height = `${Math.max(1, Math.min(rect.height, window.innerHeight))}px`;
      box.style.transform = `translate3d(${index * 7}px, ${-index * 7}px, ${index * 32}px) scale(${Math.max(.88, 1 - index * .006)})`;
      box.style.opacity = String(Math.max(.34, .88 - index * .055));
      const label = document.createElement("span");
      label.className = "viz-label";
      label.textContent = `${item.label} · z ${item.zIndex} · ${item.reason}`;
      box.appendChild(label);
      ui.vizOverlay.appendChild(box);
    });
  }

  function openCssEditor() {
    if (!currentInspection || !targetElement?.isConnected) return;
    clearTools();
    openToolPanel("edit", "Live CSS surgery", "Overrides are applied inline to the real selected element and reflected back into the frozen surface.");

    const section = createToolSection("Declaration overrides");
    const editor = document.createElement("textarea");
    editor.className = "editor";
    editor.spellcheck = false;
    editor.placeholder = "color: white;\nbackground: #111;\nborder-radius: 16px;";
    editor.value = editPatch || serializeDeclarations(currentInspection.inlineStyle || []);
    section.appendChild(editor);

    const actions = document.createElement("div");
    actions.className = "tool-actions";
    const apply = makeButton("Apply");
    const undo = makeButton("Undo");
    const reset = makeButton("Reset");
    const copy = makeButton("Copy patch");
    actions.append(apply, undo, reset, copy);
    section.appendChild(actions);

    const status = document.createElement("div");
    status.className = "editor-status";
    status.textContent = "Edit CSS declarations only; the page's authored stylesheet is not rewritten.";
    section.appendChild(status);
    ui.toolBody.appendChild(section);

    apply.addEventListener("click", async () => {
      try {
        const parsed = parseDeclarationPatch(editor.value);
        const before = targetElement.getAttribute("style");
        editUndoStack.push(before);
        restoreStyleAttribute(targetElement, editBaselineStyle);
        for (const prop of parsed) targetElement.style.setProperty(prop.name, prop.value, prop.important ? "important" : "");
        editPatch = editor.value;
        status.textContent = `Applied ${parsed.length} override${parsed.length === 1 ? "" : "s"}. Refreshing surface…`;
        await refreshAfterPageMutation();
        status.textContent = `Applied ${parsed.length} override${parsed.length === 1 ? "" : "s"}.`;
      } catch (error) {
        status.textContent = error?.message || String(error);
      }
    });

    undo.addEventListener("click", async () => {
      if (!editUndoStack.length) {
        status.textContent = "Nothing to undo in this inspection session.";
        return;
      }
      restoreStyleAttribute(targetElement, editUndoStack.pop());
      status.textContent = "Undo applied. Refreshing surface…";
      await refreshAfterPageMutation().catch((error) => { status.textContent = error?.message || String(error); });
      if (!status.textContent.includes("error")) status.textContent = "Previous inline style restored.";
    });

    reset.addEventListener("click", async () => {
      editUndoStack.push(targetElement.getAttribute("style"));
      restoreStyleAttribute(targetElement, editBaselineStyle);
      editPatch = "";
      status.textContent = "Original inline style restored. Refreshing surface…";
      try {
        await refreshAfterPageMutation();
        editor.value = serializeDeclarations(currentInspection.inlineStyle || []);
        status.textContent = "Reset to the inline style captured when this element was selected.";
      } catch (error) {
        status.textContent = error?.message || String(error);
      }
    });

    copy.addEventListener("click", async () => {
      try {
        const parsed = parseDeclarationPatch(editor.value);
        const selector = selectorForElement(targetElement);
        const css = `${selector} {\n${parsed.map((prop) => `  ${prop.name}: ${prop.value}${prop.important ? " !important" : ""};`).join("\n")}\n}`;
        await copyText(css);
        status.textContent = `Copied patch for ${selector}.`;
      } catch (error) {
        status.textContent = error?.message || String(error);
      }
    });
  }

  async function refreshAfterPageMutation() {
    if (!engine || !targetElement?.isConnected) return;
    const rect = targetElement.getBoundingClientRect();
    const point = {
      x: clamp(rect.left + rect.width / 2, 0, Math.max(0, window.innerWidth - 1)),
      y: clamp(rect.top + rect.height / 2, 0, Math.max(0, window.innerHeight - 1))
    };
    const fallback = buildFallbackInspection(targetElement);
    host.style.visibility = "hidden";
    await nextPaint();
    await nextPaint();
    let capture;
    let inspection;
    try {
      [capture, inspection] = await Promise.all([
        chrome.runtime.sendMessage({ type: "RT_CAPTURE_ONLY" }),
        chrome.runtime.sendMessage({ type: "RT_INSPECT_ONLY", x: point.x, y: point.y, fallback })
      ]);
    } finally {
      host.style.visibility = "visible";
    }
    if (capture?.ok && capture.screenshot) await engine.setScreenshot(capture.screenshot);
    if (inspection?.ok && inspection.inspection) {
      currentInspection = inspection.inspection;
      renderInspection(currentInspection, inspectionPoint?.x ?? point.x, inspectionPoint?.y ?? point.y);
    }
    currentStructure = collectDOMStructure(targetElement);
    currentStacking = collectStackingContexts(targetElement);
  }

  function openTracePanel() {
    if (!currentInspection) return;
    clearTools();
    openToolPanel("trace", "Events + network trace", "Listeners are exact CDP metadata; network requests are correlated by time after the interaction, not claimed as proven causality.");
    renderTracePanelBody(currentTrace);
  }

  function renderTracePanelBody(trace) {
    ui.toolBody.innerHTML = "";
    const listenersSection = createToolSection("Listeners on selected element");
    const listeners = currentInspection?.eventListeners || [];
    if (listeners.length) {
      for (const listener of listeners) {
        const row = document.createElement("div");
        row.className = "listener-row";
        const strong = document.createElement("strong");
        strong.textContent = listener.type;
        const meta = document.createElement("div");
        meta.className = "muted";
        const flags = [listener.useCapture ? "capture" : "bubble", listener.passive ? "passive" : "", listener.once ? "once" : ""].filter(Boolean).join(" · ");
        meta.textContent = `${flags}${listener.lineNumber ? ` · script:${listener.scriptId || "?"}:${listener.lineNumber}` : ""}`;
        row.append(strong, meta);
        if (listener.handler) {
          const handler = document.createElement("div");
          handler.className = "muted";
          handler.textContent = truncate(listener.handler, 220);
          row.appendChild(handler);
        }
        listenersSection.appendChild(row);
      }
    } else {
      appendEmpty(listenersSection, currentInspection?.mode === "fallback" ? "Listener metadata requires the DevTools Protocol." : "No direct listeners were reported for this node or its shallow listener graph.");
    }
    ui.toolBody.appendChild(listenersSection);

    const traceSection = createToolSection("Observed after interaction");
    if (!trace) {
      const intro = document.createElement("div");
      intro.className = "muted";
      intro.textContent = "Arm tracing, then perform one normal click on the live page. The overlay temporarily steps aside while Network events are recorded.";
      traceSection.appendChild(intro);
      const actions = document.createElement("div");
      actions.className = "tool-actions";
      const start = makeButton("Trace next interaction");
      actions.appendChild(start);
      traceSection.appendChild(actions);
      start.addEventListener("click", () => startInteractionTrace().catch((error) => showToast(error?.message || String(error))));
    } else {
      const requests = trace.requests || [];
      const summary = document.createElement("div");
      summary.className = "muted";
      summary.textContent = `${requests.length} request${requests.length === 1 ? "" : "s"} observed in ${Math.round(trace.durationMs || 0)} ms after the interaction.`;
      traceSection.appendChild(summary);
      for (const request of requests) {
        const row = document.createElement("div");
        row.className = "request-row";
        const strong = document.createElement("strong");
        strong.textContent = `${request.method || "GET"} ${request.status ?? (request.failed ? "ERR" : "…")}`;
        const url = document.createElement("div");
        url.textContent = truncate(request.url || "", 230);
        const meta = document.createElement("div");
        meta.className = "muted";
        meta.textContent = `${request.type || "Other"} · initiator: ${request.initiatorType || "other"}${request.hasUserGesture ? " · user gesture" : ""}${request.mimeType ? ` · ${request.mimeType}` : ""}`;
        row.append(strong, url, meta);
        traceSection.appendChild(row);
      }
      if (!requests.length) appendEmpty(traceSection, "No network requests were observed during the trace window.");
      const actions = document.createElement("div");
      actions.className = "tool-actions";
      const again = makeButton("Trace again");
      actions.appendChild(again);
      traceSection.appendChild(actions);
      again.addEventListener("click", () => startInteractionTrace().catch((error) => showToast(error?.message || String(error))));
    }
    ui.toolBody.appendChild(traceSection);
  }

  async function startInteractionTrace() {
    if (state !== "revealed") throw new Error("Reveal an element before tracing interactions.");
    const response = await chrome.runtime.sendMessage({ type: "RT_START_TRACE" });
    if (!response?.ok) throw new Error(response?.error || "Could not start network tracing.");

    clearTimeout(traceFinishTimer);
    traceClickSeen = false;
    state = "tracing";
    engine?.stop();
    ui.canvas.style.display = "none";
    ui.substrate.style.display = "none";
    ui.blocker.style.display = "none";
    ui.hud.style.display = "none";
    ui.toolPanel.style.display = "none";
    ui.vizOverlay.style.display = "none";
    if (targetElement?.isConnected) updateSelection(targetElement);
    ui.traceBanner.textContent = "Tracing armed — perform one normal click on the page (Esc cancels)";
    ui.traceBanner.style.display = "block";
    traceFinishTimer = setTimeout(() => finishInteractionTrace(false), 5200);
  }

  async function finishInteractionTrace(cancelled = false) {
    if (state !== "tracing") return;
    clearTimeout(traceFinishTimer);
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: "RT_FINISH_TRACE" });
    } catch (error) {
      response = { ok: false, error: error?.message || String(error) };
    }

    ui.traceBanner.style.display = "none";
    ui.selection.style.display = "none";
    ui.substrate.style.display = "block";
    ui.canvas.style.display = "block";
    ui.blocker.style.display = "block";
    ui.hud.style.display = "flex";
    ui.toolPanel.style.display = "block";
    ui.vizOverlay.style.display = "none";
    state = "revealed";
    engine?.start();

    if (!cancelled && response?.ok) {
      currentTrace = { requests: response.requests || [], durationMs: response.durationMs || 0 };
      await refreshAfterPageMutation().catch(() => {});
    }
    openTracePanel();
    if (!response?.ok) showToast(response?.error || "Network trace could not be completed.");
  }

  function collectDOMStructure(rootEl) {
    if (!rootEl?.isConnected) return null;
    let count = 0;
    function visit(el, depth) {
      if (!(el instanceof Element) || count >= 60 || depth > 4) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if ((rect.width <= 0 && rect.height <= 0) || style.display === "none") return null;
      count += 1;
      const item = {
        node: el,
        label: DOMElementLabel(el),
        depth,
        rect: snapshotRect(rect),
        children: []
      };
      for (const child of el.children) {
        if (count >= 60) break;
        const next = visit(child, depth + 1);
        if (next) item.children.push(next);
      }
      return item;
    }
    return visit(rootEl, 0);
  }

  function flattenStructure(structure) {
    const out = [];
    (function walk(item) {
      if (!item) return;
      out.push(item);
      for (const child of item.children || []) walk(child);
    })(structure);
    return out;
  }

  function collectStackingContexts(el) {
    if (!el?.isConnected) return [];
    const chain = [];
    let current = el;
    while (current && current instanceof Element) {
      const style = getComputedStyle(current);
      const reason = stackingContextReason(current, style);
      if (reason || current === el || current === document.documentElement) {
        chain.push({
          node: current,
          label: DOMElementLabel(current),
          zIndex: style.zIndex || "auto",
          position: style.position,
          reason: reason || (current === el ? "selected element" : "root"),
          rect: snapshotRect(current.getBoundingClientRect())
        });
      }
      current = current.parentElement;
    }
    return chain.reverse().slice(-18);
  }

  function stackingContextReason(el, style) {
    if (el === document.documentElement) return "root stacking context";
    if (style.position === "fixed" || style.position === "sticky") return `position:${style.position}`;
    if (style.position !== "static" && style.zIndex !== "auto") return `position:${style.position} + z-index`;
    const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
    if (parent && (parent.display.includes("flex") || parent.display.includes("grid")) && style.zIndex !== "auto") return "flex/grid item + z-index";
    if (Number(style.opacity) < 1) return `opacity:${style.opacity}`;
    if (style.transform !== "none") return "transform";
    if (style.filter !== "none") return "filter";
    if (style.perspective !== "none") return "perspective";
    if (style.mixBlendMode && style.mixBlendMode !== "normal") return `mix-blend-mode:${style.mixBlendMode}`;
    if (style.isolation === "isolate") return "isolation:isolate";
    if ((style.contain || "").match(/paint|layout|strict|content/)) return `contain:${style.contain}`;
    if ((style.willChange || "").match(/transform|opacity|filter|perspective/)) return `will-change:${style.willChange}`;
    return "";
  }

  function snapshotRect(rect) {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }

  function createToolSection(label) {
    const section = document.createElement("section");
    section.className = "tool-section";
    const heading = document.createElement("div");
    heading.className = "tool-label";
    heading.textContent = label;
    section.appendChild(heading);
    return section;
  }

  function appendEmpty(parent, text) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = text;
    parent.appendChild(empty);
  }

  function makeButton(label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    return button;
  }

  function parseDeclarationPatch(text) {
    const probe = document.createElement("div");
    probe.style.cssText = String(text || "");
    const declarations = [];
    for (let i = 0; i < probe.style.length; i++) {
      const name = probe.style[i];
      declarations.push({
        name,
        value: probe.style.getPropertyValue(name),
        important: probe.style.getPropertyPriority(name) === "important"
      });
    }
    if (String(text || "").trim() && !declarations.length) {
      throw new Error("No valid CSS declarations were found. Enter declarations such as `color: red;` rather than a full selector block.");
    }
    return declarations;
  }

  function serializeDeclarations(declarations) {
    return (declarations || []).filter((prop) => prop?.name).map((prop) => `${prop.name}: ${prop.value}${prop.important ? " !important" : ""};`).join("\n");
  }

  function restoreStyleAttribute(el, value) {
    if (value == null || value === "") el.removeAttribute("style");
    else el.setAttribute("style", value);
  }

  function selectorForElement(el) {
    if (el.id) return `#${cssEscape(el.id)}`;
    const classes = [...el.classList].filter(Boolean).slice(0, 3).map((name) => `.${cssEscape(name)}`).join("");
    if (classes) return `${el.localName}${classes}`;
    const parent = el.parentElement;
    if (!parent) return el.localName || "element";
    const same = [...parent.children].filter((child) => child.localName === el.localName);
    const index = Math.max(1, same.indexOf(el) + 1);
    return `${el.localName}:nth-of-type(${index})`;
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch (_) {}
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0";
    document.documentElement.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("Clipboard access was unavailable; select the text manually instead.");
  }

  function failAndRearm(error) {
    console.error("Reality Tear", error);
    host.style.visibility = "visible";
    showToast(error?.message || String(error));
    state = "armed";
    ui.status.textContent = `Inspection failed · ${modeMeta().arm}`;
    ui.blocker.style.display = "none";
    ui.substrate.style.display = "none";
    ui.canvas.style.display = "none";
  }


  function setMode(mode) {
    const next = MODE_META[mode] ? mode : "fabric";
    const changed = next !== currentMode;
    currentMode = next;
    ui.effectPill.textContent = MODE_META[currentMode].label;
    if (engine) engine.setMode(currentMode);
    return changed;
  }

  function modeMeta() {
    return MODE_META[currentMode] || MODE_META.fabric;
  }

  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function truncate(value, maxLength) {
    const text = String(value ?? "");
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n…` : text;
  }
})();
