(() => {
  if (globalThis.__RealityTearEngineClass) return;

  const MODE_INDEX = Object.freeze({ curl: 0, glass: 1, xray: 2, fabric: 3 });

  const FULLSCREEN_VERTEX = `#version 300 es
  precision highp float;
  const vec2 POSITIONS[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2( 3.0, -1.0),
    vec2(-1.0,  3.0)
  );
  out vec2 vUv;
  void main() {
    vec2 p = POSITIONS[gl_VertexID];
    vUv = p * 0.5 + 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
  }`;

  const SIM_FRAGMENT = `#version 300 es
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uResolution;
  uniform vec2 uFrom;
  uniform vec2 uTo;
  uniform float uAspect;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uActive;
  uniform float uHealRate;
  uniform float uDt;
  uniform float uSeed;
  uniform int uMode;
  in vec2 vUv;
  out vec4 outColor;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float sdSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float denom = max(dot(ba, ba), 1e-6);
    float h = clamp(dot(pa, ba) / denom, 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 texel = 1.0 / uResolution;
    float damage = texture(uPrev, vUv).r;

    float l = texture(uPrev, vUv - vec2(texel.x, 0.0)).r;
    float r = texture(uPrev, vUv + vec2(texel.x, 0.0)).r;
    float d = texture(uPrev, vUv - vec2(0.0, texel.y)).r;
    float u = texture(uPrev, vUv + vec2(0.0, texel.y)).r;
    float neighbor = max(max(l, r), max(d, u));

    // Curl and X-Ray are analytic effects; Glass and Fabric use persistent damage.
    bool destructive = (uMode == 1 || uMode == 3);
    if (destructive && uActive > 0.5) {
      vec2 p = vec2(vUv.x * uAspect, vUv.y);
      vec2 a = vec2(uFrom.x * uAspect, uFrom.y);
      vec2 b = vec2(uTo.x * uAspect, uTo.y);
      float dist = sdSegment(p, a, b);
      float n = hash(floor(vUv * uResolution * 0.31) + uSeed);

      float modeRadius = uMode == 1 ? uRadius * 0.74 : uRadius * 1.14;
      float outer = modeRadius * mix(0.78, 1.25, n);
      float inner = outer * mix(0.30, 0.56, n);
      float brush = 1.0 - smoothstep(inner, outer, dist);
      float ragged = mix(0.76, 1.0, hash(vUv * 913.7 + uSeed));
      damage = max(damage, brush * uStrength * ragged);

      float propagationNoise = hash(floor(vUv * uResolution * 0.55) - uSeed);
      float loss = uMode == 1 ? mix(0.004, 0.011, propagationNoise) : mix(0.010, 0.021, propagationNoise);
      float propagated = neighbor - loss;
      float propagationGate = uMode == 1 ? smoothstep(0.18, 0.70, uStrength) : smoothstep(0.42, 0.92, uStrength);
      damage = max(damage, propagated * propagationGate);
    }

    if (uHealRate > 0.0) {
      damage = max(0.0, damage - uHealRate * uDt);
    }

    outColor = vec4(clamp(damage, 0.0, 1.0), 0.0, 0.0, 1.0);
  }`;

  const SCREEN_FRAGMENT = `#version 300 es
  precision highp float;
  uniform sampler2D uPage;
  uniform sampler2D uDamage;
  uniform vec2 uDamageResolution;
  uniform vec2 uGrabOrigin;
  uniform vec2 uGrabCurrent;
  uniform float uGrabActive;
  uniform float uAspect;
  uniform float uTime;
  uniform float uReducedMotion;
  uniform float uEffectAmount;
  uniform float uSeed;
  uniform int uMode;
  in vec2 vUv;
  out vec4 outColor;

  const float PI = 3.141592653589793;
  const float TAU = 6.283185307179586;

  float hash(vec2 p) {
    p = fract(p * vec2(443.8975, 397.2973));
    p += dot(p, p.yx + 19.19);
    return fract((p.x + p.y) * p.x);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amp * noise(p);
      p = p * 2.03 + 17.7;
      amp *= 0.5;
    }
    return value;
  }

  vec2 aspectPoint(vec2 uv) {
    return vec2(uv.x * uAspect, uv.y);
  }

  vec2 safeNormalize(vec2 v, vec2 fallback) {
    float len = length(v);
    return len > 0.00001 ? v / len : fallback;
  }

  vec3 pageAt(vec2 uv) {
    return texture(uPage, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }

  float crackField(vec2 q, float radius) {
    float r = length(q);
    if (r > radius || r < 0.006) return 0.0;
    float angle = atan(q.y, q.x);
    float field = 0.0;
    for (int i = 0; i < 13; i++) {
      float fi = float(i);
      float jitter = (hash(vec2(fi, uSeed)) - 0.5) * 0.30;
      float a = TAU * (fi / 13.0) + jitter;
      float angularDistance = abs(sin(angle - a)) * r;
      float wobble = sin(r * (58.0 + fi * 2.7) + fi * 1.83 + uSeed) * 0.0018;
      float width = mix(0.0012, 0.0034, smoothstep(0.0, radius, r));
      float ray = 1.0 - smoothstep(width, width * 2.2, abs(angularDistance + wobble));
      float start = smoothstep(0.018, 0.045, r);
      float end = 1.0 - smoothstep(radius * 0.76, radius, r);
      field = max(field, ray * start * end);
    }

    float rings = 0.0;
    float rr = r * 26.0 + noise(vec2(angle * 4.0, r * 32.0 + uSeed)) * 0.7;
    float ringLine = abs(fract(rr) - 0.5);
    rings = (1.0 - smoothstep(0.015, 0.075, ringLine)) * smoothstep(0.04, radius * 0.85, r);
    rings *= 0.42 + 0.58 * step(0.47, hash(vec2(floor(rr), floor(angle * 7.0)) + uSeed));
    return clamp(max(field, rings), 0.0, 1.0);
  }

  void renderCurl() {
    vec2 originA = aspectPoint(uGrabOrigin);
    vec2 currentA = aspectPoint(uGrabCurrent);
    vec2 q = aspectPoint(vUv) - originA;
    vec2 drag = currentA - originA;
    float dragLen = max(length(drag), 0.012);
    vec2 dir = safeNormalize(drag, vec2(1.0, 0.0));
    vec2 perp = vec2(-dir.y, dir.x);

    float amount = clamp(0.20 + uEffectAmount * 0.88 + dragLen * 1.35, 0.20, 1.0);
    float radius = mix(0.075, 0.48, amount);
    vec2 center = drag * 0.26;
    vec2 rel = q - center;
    float along = dot(rel, dir);
    float side = dot(rel, perp);
    float ellipse = length(vec2(along / max(radius, 0.001), side / max(radius * 0.70, 0.001)));

    float peel = 1.0 - smoothstep(0.82, 1.0, ellipse);
    float edgeBand = 1.0 - smoothstep(0.035, 0.115, abs(ellipse - 0.91));
    float draggedSide = smoothstep(-radius * 0.35, radius * 0.48, along);
    float fold = edgeBand * draggedSide;

    vec2 dirUv = vec2(dir.x / max(uAspect, 0.001), dir.y);
    vec2 warped = vUv - dirUv * fold * mix(0.018, 0.055, amount);
    warped += vec2(perp.x / max(uAspect, 0.001), perp.y) * sin(side * 58.0) * fold * 0.004;
    vec3 base = pageAt(warped);

    float curvature = pow(clamp(fold, 0.0, 1.0), 0.65);
    float highlight = curvature * (0.38 + 0.28 * max(0.0, dot(dir, vec2(-0.55, 0.83))));
    float underside = fold * smoothstep(-radius * 0.08, radius * 0.45, along);
    base = mix(base, vec3(0.78, 0.81, 0.84), underside * 0.35);
    base += vec3(1.0) * highlight * 0.32;

    float insideLip = edgeBand * (1.0 - draggedSide * 0.55);
    base *= 1.0 - insideLip * 0.32;

    float alpha = 1.0 - peel;
    alpha = max(alpha, fold * 0.98);
    outColor = vec4(base, clamp(alpha, 0.0, 1.0));
  }

  void renderGlass() {
    vec2 texel = 1.0 / uDamageResolution;
    float damage = texture(uDamage, vUv).r;
    float dl = texture(uDamage, vUv - vec2(texel.x, 0.0)).r;
    float dr = texture(uDamage, vUv + vec2(texel.x, 0.0)).r;
    float dd = texture(uDamage, vUv - vec2(0.0, texel.y)).r;
    float du = texture(uDamage, vUv + vec2(0.0, texel.y)).r;
    vec2 gradient = vec2(dr - dl, du - dd);

    vec2 q = aspectPoint(vUv) - aspectPoint(uGrabOrigin);
    float crackRadius = mix(0.12, 0.62, clamp(uEffectAmount * 0.85 + 0.18, 0.0, 1.0));
    float cracks = crackField(q, crackRadius);
    float macro = fbm(vUv * vec2(8.0 * uAspect, 8.0) + uSeed * 0.01);
    float threshold = 0.53 + (macro - 0.5) * 0.09;
    float hole = smoothstep(threshold - 0.025, threshold + 0.035, damage);

    vec2 radial = safeNormalize(q, vec2(0.0, 1.0));
    vec2 radialUv = vec2(radial.x / max(uAspect, 0.001), radial.y);
    vec2 warped = vUv - gradient * (0.020 + damage * 0.026) + radialUv * cracks * 0.0035;
    vec3 base = pageAt(warped);

    float crackDark = crackField(q + vec2(0.0028, -0.002), crackRadius);
    base *= 1.0 - crackDark * 0.30;
    base += vec3(0.67, 0.90, 1.0) * cracks * (0.48 + 0.52 * smoothstep(0.0, 0.7, uEffectAmount));

    float edge = smoothstep(0.31, 0.53, damage) * (1.0 - smoothstep(0.55, 0.73, damage));
    base += vec3(0.48, 0.88, 1.0) * edge * 0.75;
    base *= 1.0 - edge * 0.13;
    outColor = vec4(base, 1.0 - hole);
  }

  void renderXray() {
    vec2 centerA = aspectPoint(uGrabCurrent);
    vec2 q = aspectPoint(vUv) - centerA;
    float radius = mix(0.095, 0.245, clamp(0.20 + uEffectAmount * 0.60, 0.0, 1.0));
    float d = length(q);
    float lens = 1.0 - smoothstep(radius - 0.010, radius + 0.004, d);
    float ring = 1.0 - smoothstep(0.006, 0.018, abs(d - radius));
    float innerRing = 1.0 - smoothstep(0.002, 0.009, abs(d - radius * 0.91));

    vec2 magnified = uGrabCurrent + (vUv - uGrabCurrent) * mix(1.0, 0.92, lens);
    vec3 base = pageAt(magnified);
    float gray = dot(base, vec3(0.299, 0.587, 0.114));
    vec3 xrayTint = mix(vec3(gray), vec3(0.45, 0.89, 1.0), 0.28);
    base = mix(base, xrayTint, lens * 0.65);
    base += vec3(0.68, 0.95, 1.0) * ring * 0.85;
    base += vec3(0.18, 0.55, 0.70) * innerRing * 0.25;

    float scanTime = mix(uTime, 0.0, uReducedMotion);
    float scan = 0.5 + 0.5 * sin((vUv.y - uGrabCurrent.y) * 520.0 + scanTime * 3.5);
    base += vec3(0.10, 0.34, 0.42) * scan * lens * 0.10;

    // The lens is nearly transparent so the live code substrate dominates inside it.
    float alpha = mix(1.0, 0.055, lens);
    alpha = max(alpha, ring * 0.98);
    outColor = vec4(base, alpha);
  }

  void renderFabric() {
    vec2 texel = 1.0 / uDamageResolution;
    float damage = texture(uDamage, vUv).r;
    float dl = texture(uDamage, vUv - vec2(texel.x, 0.0)).r;
    float dr = texture(uDamage, vUv + vec2(texel.x, 0.0)).r;
    float dd = texture(uDamage, vUv - vec2(0.0, texel.y)).r;
    float du = texture(uDamage, vUv + vec2(0.0, texel.y)).r;
    vec2 gradient = vec2(dr - dl, du - dd);

    vec2 q = aspectPoint(vUv) - aspectPoint(uGrabOrigin);
    vec2 drag = aspectPoint(uGrabCurrent) - aspectPoint(uGrabOrigin);
    vec2 dir = safeNormalize(drag, vec2(1.0, 0.0));
    vec2 perp = vec2(-dir.y, dir.x);
    float influence = exp(-dot(q, q) * 25.0);
    float strain = clamp(uEffectAmount * 0.85 + length(drag) * 1.3, 0.0, 1.0);
    float t = mix(uTime, 0.0, uReducedMotion);

    float along = dot(q, dir);
    float side = dot(q, perp);
    float wrinkle = sin(side * 92.0 + along * 11.0 + t * 1.1) * 0.55 + sin(side * 163.0 - along * 17.0) * 0.22;
    float fold = wrinkle * influence * strain;
    vec2 perpUv = vec2(perp.x / max(uAspect, 0.001), perp.y);
    vec2 dirUv = vec2(dir.x / max(uAspect, 0.001), dir.y);
    vec2 warped = vUv - drag * influence * 0.18;
    warped += perpUv * fold * 0.009;
    warped -= gradient * (0.020 + damage * 0.020);
    warped += dirUv * sin(side * 48.0) * influence * strain * 0.003;

    float macro = fbm(vUv * vec2(7.5 * uAspect, 7.5));
    float micro = noise(vUv * vec2(117.0 * uAspect, 117.0));
    float threshold = 0.46 + (macro - 0.5) * 0.17 + (micro - 0.5) * 0.07;
    float hole = smoothstep(threshold - 0.035, threshold + 0.040, damage);

    vec3 base = pageAt(warped);
    float weaveX = sin(vUv.x * uAspect * 1280.0);
    float weaveY = sin(vUv.y * 1280.0);
    float weave = weaveX * weaveY;
    base *= 1.0 + weave * 0.018 + fold * 0.05;

    float edge = smoothstep(0.22, 0.46, damage) * (1.0 - smoothstep(0.49, 0.72, damage));
    float fibers = pow(abs(sin((vUv.x * uAspect + vUv.y) * 510.0 + micro * 7.0)), 7.0);
    float fray = edge * mix(0.65, 1.35, fibers);
    base = mix(base, vec3(0.82, 0.84, 0.82), fray * 0.33);
    base *= 1.0 - edge * 0.16;
    base += vec3(0.25, 0.48, 0.53) * edge * 0.22;

    outColor = vec4(base, 1.0 - hole);
  }

  void main() {
    if (uMode == 0) {
      renderCurl();
    } else if (uMode == 1) {
      renderGlass();
    } else if (uMode == 2) {
      renderXray();
    } else {
      renderFabric();
    }
  }`;

  class TearEngine {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.options = {
        simBaseWidth: options.simBaseWidth || 520,
        healRate: options.healRate || 0,
        reducedMotion: Boolean(options.reducedMotion)
      };
      this.mode = sanitizeMode(options.mode || "fabric");

      const gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      });
      if (!gl) throw new Error("WebGL2 is unavailable on this page/device.");
      this.gl = gl;
      this.disposed = false;
      this.running = false;
      this.pointer = {
        active: false,
        origin: [0.5, 0.5],
        current: [0.5, 0.5],
        previous: [0.5, 0.5],
        totalDistance: 0
      };
      this.seed = Math.random() * 1000;

      this.simProgram = createProgram(gl, FULLSCREEN_VERTEX, SIM_FRAGMENT);
      this.screenProgram = createProgram(gl, FULLSCREEN_VERTEX, SCREEN_FRAGMENT);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);

      this.pageTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.pageTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

      this.resize();
      this.reset();
    }

    setMode(mode) {
      const next = sanitizeMode(mode);
      if (next === this.mode) return;
      this.mode = next;
      this.seed = Math.random() * 1000;
      this.reset();
    }

    async setScreenshot(dataUrl) {
      const image = new Image();
      image.decoding = "async";
      image.src = dataUrl;
      await image.decode();
      if (this.disposed) return;
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.pageTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.pageWidth = image.naturalWidth;
      this.pageHeight = image.naturalHeight;
    }

    resize() {
      if (this.disposed) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const width = Math.max(1, Math.round(window.innerWidth * dpr));
      const height = Math.max(1, Math.round(window.innerHeight * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.viewportWidth = Math.max(1, window.innerWidth);
      this.viewportHeight = Math.max(1, window.innerHeight);
      this.aspect = this.viewportWidth / this.viewportHeight;

      const simW = this.options.simBaseWidth;
      const simH = Math.max(260, Math.min(780, Math.round(simW / this.aspect)));
      if (simW !== this.simWidth || simH !== this.simHeight) {
        this.simWidth = simW;
        this.simHeight = simH;
        this._allocateSimulation();
      }
    }

    reset() {
      if (this.disposed || !this.framebuffers) return;
      const gl = this.gl;
      for (const fb of this.framebuffers) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.viewport(0, 0, this.simWidth, this.simHeight);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.pointer.active = false;
      this.pointer.totalDistance = 0;
    }

    begin(x, y, preserveOrigin = false) {
      const uv = this._toUv(x, y);
      this.pointer.active = true;
      if (!preserveOrigin) {
        this.pointer.origin = uv.slice();
        this.pointer.totalDistance = 0;
      }
      this.pointer.current = uv.slice();
      this.pointer.previous = uv.slice();
    }

    move(x, y, movementPx = 0) {
      if (!this.pointer.active) return;
      this.pointer.previous = this.pointer.current.slice();
      this.pointer.current = this._toUv(x, y);
      this.pointer.totalDistance += Math.max(0, movementPx || 0);
    }

    end() {
      this.pointer.active = false;
    }

    start() {
      if (this.running || this.disposed) return;
      this.running = true;
      this.lastTime = performance.now();
      const frame = (now) => {
        if (!this.running || this.disposed) return;
        const dt = Math.min(0.04, Math.max(0.001, (now - this.lastTime) / 1000));
        this.lastTime = now;
        this._render(dt, now / 1000);
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }

    dispose() {
      if (this.disposed) return;
      this.stop();
      const gl = this.gl;
      for (const tex of this.simTextures || []) gl.deleteTexture(tex);
      for (const fb of this.framebuffers || []) gl.deleteFramebuffer(fb);
      gl.deleteTexture(this.pageTexture);
      gl.deleteProgram(this.simProgram);
      gl.deleteProgram(this.screenProgram);
      gl.deleteVertexArray(this.vao);
      this.disposed = true;
    }

    _allocateSimulation() {
      const gl = this.gl;
      for (const tex of this.simTextures || []) gl.deleteTexture(tex);
      for (const fb of this.framebuffers || []) gl.deleteFramebuffer(fb);

      this.simTextures = [];
      this.framebuffers = [];
      for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.simWidth, this.simHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error("Could not create the effect simulation framebuffer.");
        }
        this.simTextures.push(tex);
        this.framebuffers.push(fb);
      }
      this.readIndex = 0;
      this.writeIndex = 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.reset();
    }

    _render(dt, time) {
      this.resize();
      const gl = this.gl;
      const modeIndex = MODE_INDEX[this.mode];
      gl.bindVertexArray(this.vao);

      gl.useProgram(this.simProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffers[this.writeIndex]);
      gl.viewport(0, 0, this.simWidth, this.simHeight);
      bindTexture(gl, this.simProgram, "uPrev", this.simTextures[this.readIndex], 0);
      set2f(gl, this.simProgram, "uResolution", this.simWidth, this.simHeight);
      set2f(gl, this.simProgram, "uFrom", this.pointer.previous[0], this.pointer.previous[1]);
      set2f(gl, this.simProgram, "uTo", this.pointer.current[0], this.pointer.current[1]);
      set1f(gl, this.simProgram, "uAspect", this.aspect);

      const baseStrength = this.mode === "glass" ? 0.10 : 0.13;
      const strength = Math.min(1, baseStrength + this.pointer.totalDistance / (this.mode === "glass" ? 92 : 132));
      const radius = Math.min(0.084, 0.025 + this.pointer.totalDistance / 12500);
      set1f(gl, this.simProgram, "uRadius", radius);
      set1f(gl, this.simProgram, "uStrength", strength);
      set1f(gl, this.simProgram, "uActive", this.pointer.active ? 1 : 0);
      set1f(gl, this.simProgram, "uHealRate", this.options.healRate);
      set1f(gl, this.simProgram, "uDt", dt);
      set1f(gl, this.simProgram, "uSeed", this.seed);
      set1i(gl, this.simProgram, "uMode", modeIndex);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      [this.readIndex, this.writeIndex] = [this.writeIndex, this.readIndex];

      gl.useProgram(this.screenProgram);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      bindTexture(gl, this.screenProgram, "uPage", this.pageTexture, 0);
      bindTexture(gl, this.screenProgram, "uDamage", this.simTextures[this.readIndex], 1);
      set2f(gl, this.screenProgram, "uDamageResolution", this.simWidth, this.simHeight);
      set2f(gl, this.screenProgram, "uGrabOrigin", this.pointer.origin[0], this.pointer.origin[1]);
      set2f(gl, this.screenProgram, "uGrabCurrent", this.pointer.current[0], this.pointer.current[1]);
      set1f(gl, this.screenProgram, "uGrabActive", this.pointer.active ? 1 : 0);
      set1f(gl, this.screenProgram, "uAspect", this.aspect);
      set1f(gl, this.screenProgram, "uTime", time);
      set1f(gl, this.screenProgram, "uReducedMotion", this.options.reducedMotion ? 1 : 0);
      set1f(gl, this.screenProgram, "uEffectAmount", Math.min(1.0, this.pointer.totalDistance / 240));
      set1f(gl, this.screenProgram, "uSeed", this.seed);
      set1i(gl, this.screenProgram, "uMode", modeIndex);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    _toUv(x, y) {
      return [
        Math.min(1, Math.max(0, x / Math.max(1, window.innerWidth))),
        Math.min(1, Math.max(0, 1 - y / Math.max(1, window.innerHeight)))
      ];
    }
  }

  function sanitizeMode(mode) {
    return Object.prototype.hasOwnProperty.call(MODE_INDEX, mode) ? mode : "fabric";
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`WebGL program link failed: ${info}`);
    }
    return program;
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL shader compile failed: ${info}`);
    }
    return shader;
  }

  function bindTexture(gl, program, name, texture, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const loc = gl.getUniformLocation(program, name);
    if (loc !== null) gl.uniform1i(loc, unit);
  }

  function set1f(gl, program, name, value) {
    const loc = gl.getUniformLocation(program, name);
    if (loc !== null) gl.uniform1f(loc, value);
  }

  function set1i(gl, program, name, value) {
    const loc = gl.getUniformLocation(program, name);
    if (loc !== null) gl.uniform1i(loc, value);
  }

  function set2f(gl, program, name, x, y) {
    const loc = gl.getUniformLocation(program, name);
    if (loc !== null) gl.uniform2f(loc, x, y);
  }

  globalThis.__RealityTearEngineClass = TearEngine;
})();
