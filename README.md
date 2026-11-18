# Reality Tear Inspector v0.3

Reality Tear is a Manifest V3 Chrome extension that treats the rendered webpage as a physical surface. Drag an element, manipulate the frozen page with a shader effect, and reveal the runtime HTML/CSS beneath it.

v0.3 keeps the four surface modes from v0.2 and adds a second layer of visual debugging tools: exploded DOM structure, stacking-context visualization, live CSS overrides, event-listener inspection, and a short network-observation trace around a real page interaction.

## Surface modes

Choose a mode from the extension popup. The choice is persisted in `chrome.storage.local` and is also used by `Ctrl+Shift+X` / `Command+Shift+X`.

- **Page Curl** — peel the screenshot back like a local sheet.
- **Glass** — radial/concentric fractures plus persistent break-through damage.
- **X-Ray** — a non-destructive inspection lens.
- **Fabric** — directional stretch/wrinkle deformation followed by fraying.

## New in v0.3

After an element has been revealed, the HUD now exposes four additional tools.

### Explode DOM

- Walks the selected element's visible descendant tree (bounded to avoid pathological pages).
- Renders the selected node and descendants as lifted screen-space layers.
- Shows a compact hierarchy panel alongside the spatial visualization.
- Uses live DOM geometry rather than inferring structure from the screenshot.

### Layers

- Walks from the root stacking context down to the selected element.
- Detects stacking-context triggers including positioned `z-index`, `fixed`/`sticky`, flex/grid items with `z-index`, opacity, transforms, filters, perspective, blend modes, isolation, contain, and relevant `will-change` values.
- Visualizes those contexts as offset spatial planes.
- Reports the reason each context exists; it does not pretend raw `z-index` alone defines paint order.

### Edit CSS

- Opens a declaration editor for the selected element.
- Applies changes as reversible inline overrides to the **real page element**.
- Silently recaptures the viewport after each change so the frozen tear surface reflects the edited page.
- Supports **Apply**, **Undo**, **Reset**, and **Copy patch**.
- `Copy patch` generates a practical selector plus the current declaration patch.

The editor does not rewrite the site's original stylesheet. That is deliberate: edits are session-local runtime overrides, similar in spirit to DevTools element-style experiments.

### Trace

The trace panel has two different evidence types and labels them separately:

1. **Event listeners** — retrieved from Chrome DevTools Protocol (`DOMDebugger.getEventListeners`) for the selected element/shallow listener graph.
2. **Network requests observed after an interaction** — the overlay steps aside, you perform one normal click, and the extension records `Network.*` events for a short window.

The network list is a temporal correlation, not a proof that every request was caused by that click. This distinction is important on pages with polling, analytics, background fetches, service workers, or concurrent UI work.

## Install

1. Extract the extension folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder.
6. Open a normal `http://` or `https://` page.
7. Click the extension icon, choose a surface mode, then click **Inspect this page**.

For `file://` pages, enable **Allow access to file URLs** for the extension in Chrome's extension details page.

Chrome internal pages, the Chrome Web Store, and other browser-protected surfaces cannot be injected into by a normal extension.

## Basic interaction

1. Arm the extension.
2. Move over the page; a subtle rectangle identifies the target element.
3. Drag an element.
4. Reality Tear locks a semantic target, captures the viewport, and resolves runtime DOM/CSS.
5. The selected shader effect reveals the code substrate.
6. Use **HTML**, **CSS**, and **Computed** to inspect source/runtime styles.
7. Use **Explode DOM**, **Layers**, **Edit CSS**, or **Trace** for deeper inspection.
8. Use **New target** to inspect another element or **Esc / Close** to exit.

Nested spans/icons inside common interactive controls are promoted to their semantic control. For example, dragging an SVG path inside a button normally inspects the button rather than the path.

## What “actual code” means

The preferred path uses `chrome.debugger` and Chrome DevTools Protocol to retrieve:

- node at the interaction coordinate;
- runtime `outerHTML`;
- matched authored CSS rules;
- inline/presentational styles;
- inherited matched rules;
- pseudo-element rules;
- computed style;
- box geometry;
- stylesheet/source metadata where Chrome exposes it;
- event-listener metadata.

The debugger is attached only while a CDP operation or explicit network trace is active.

If CDP cannot attach, the extension falls back to runtime DOM APIs (`elementFromPoint`, `outerHTML`, `getComputedStyle`, inline style, and accessible stylesheet rules). Cross-origin stylesheet rules and event-listener metadata are less complete in fallback mode.

Reality Tear exposes the browser's **runtime DOM + runtime CSS**. It does not automatically recover original React JSX, Vue/Svelte source, TypeScript, or pre-build component files. Recovering those reliably requires source maps and framework-specific adapters.

## Architecture

```text
popup/
  popup.html       surface-mode selector + activation
  popup.css
  popup.js         persisted mode selection

src/background.js
  ├─ activation + script injection
  ├─ viewport capture
  ├─ CDP DOM/CSS inspection
  ├─ CDP event-listener retrieval
  ├─ short-lived Network tracing
  └─ normalized inspection payloads

src/content.js
  ├─ hover target selection
  ├─ semantic target elevation fallback
  ├─ tear interaction state machine
  ├─ HTML/CSS/computed code substrate
  ├─ exploded DOM visualization
  ├─ stacking-context visualization
  ├─ live CSS override editor
  └─ event/network trace UI

src/tear-engine.js
  ├─ fullscreen WebGL2 renderer
  ├─ ping-pong persistent damage FBO
  ├─ Page Curl shader
  ├─ Glass shader
  ├─ X-Ray shader
  └─ Fabric shader
```

## GPU design

The webpage is captured to a texture when inspection starts. Glass/Fabric use a bounded ping-pong damage texture; Curl/X-Ray are mostly analytic screen-space effects. The WebGL canvas is transparent, so removed/transparent surface pixels expose the ordinary extension DOM substrate beneath it.

CSS edits cause an intentional recapture because the real page changed. This is different from continuously capturing the tab: normal tearing still uses one frozen page texture.

## Permissions

```json
"permissions": [
  "activeTab",
  "scripting",
  "debugger",
  "storage"
]
```

- `activeTab` — temporary user-granted page access.
- `scripting` — inject the content renderer/inspector.
- `debugger` — DevTools-quality DOM/CSS/event/network information.
- `storage` — remember the selected shader mode.

The extension does not request persistent `<all_urls>` host access.

## Development

There is no package manager, bundler, or build step. Edit the files and reload the unpacked extension from `chrome://extensions`.

Useful test files:

- `test-harness.html` — WebGL shader compilation/render smoke test.
- `demo-page.html` — nested DOM, stacking contexts, CSS editing targets, event listeners, and a same-origin request trigger when served over HTTP.

To use the demo's network action:

```bash
cd reality-tear
python -m http.server 8080
```

Then open `http://localhost:8080/demo-page.html`.

## Current limitations

- Page Curl is an analytic local curl, not a true subdivided cylindrical sheet.
- Fabric uses analytic screen-space deformation rather than spring/PBD cloth physics.
- Glass visually fractures but does not yet detach independent rigid shards.
- Exploded DOM is a screen-space visualization, not literal browser compositing layers.
- The stacking-context tool focuses on the selected element's local ancestry rather than reconstructing the complete browser paint-order graph.
- Network tracing is temporal correlation. Background traffic can appear in the same trace window.
- A trace that causes full navigation may unload the content script before the result panel can be restored.

## Strong next steps

1. Clickable exploded-DOM layers that retarget inspection without closing the current reveal.
2. Full paint-order / containing-block graph rather than only stacking-context ancestry.
3. CSS declaration-level cascade winners/losers with specificity visualization.
4. Source-map adapters for React/Vue/Svelte component source.
5. True cloth/PBD and detachable glass-shard simulations.
