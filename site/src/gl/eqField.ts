import * as THREE from 'three';

/**
 * Hero equalizer: a field of rounded cells (same proportions as the
 * BandWith mark: 88px tiles, 30px radius) drawn as one instanced mesh.
 * Columns are spectrum bands; lit cells pop toward the camera.
 */

const MAX_COLS = 64;

const vertex = /* glsl */ `
  attribute vec2 aCell;
  uniform float uLevels[${MAX_COLS}];
  uniform float uPeaks[${MAX_COLS}];
  uniform float uCols;
  uniform float uRows;
  uniform float uCell;
  uniform float uIntro;
  uniform float uSpan;
  uniform float uLift;
  uniform vec2 uPointer;
  uniform float uPointerOn;
  varying vec2 vUv;
  varying float vLit;
  varying float vPeak;
  varying float vFade;
  varying float vHot;
  varying float vH;

  void main() {
    int ci = int(aCell.x);
    float colN = aCell.x / max(uCols - 1.0, 1.0);
    float intro = smoothstep(colN - 0.2, colN, uIntro * 1.2);
    float level = uLevels[ci] * intro;
    float peak = uPeaks[ci] * intro;

    float h = (aCell.y + 0.5) / (uRows * uSpan);
    float lit = step(h, level) * step(0.0001, level);
    float peakRow = floor(peak * uRows * uSpan);
    float isPeak = (1.0 - step(0.5, abs(aCell.y - peakRow))) * step(0.03, peak) * (1.0 - lit);

    vec2 grid = vec2((aCell.x - (uCols - 1.0) * 0.5) * uCell, (aCell.y - (uRows - 1.0) * 0.5) * uCell);
    vec2 gN = vec2(colN, aCell.y / max(uRows - 1.0, 1.0));
    float d = distance(gN * vec2(uCols / uRows, 1.0), uPointer * vec2(uCols / uRows, 1.0));
    float hot = exp(-d * d * 18.0) * uPointerOn;

    vec3 pos = position * uCell;
    pos.xy += grid;
    pos.z += (lit * (0.35 + h * 0.65) + isPeak * 0.6) * uLift * uCell + hot * uCell * 0.6;

    vUv = position.xy;
    vLit = lit;
    vPeak = isPeak;
    vHot = hot;
    vH = h;
    // Fade the far top rows and the side edges.
    float edge = smoothstep(0.0, 0.08, colN) * smoothstep(1.0, 0.92, colN);
    vFade = edge * (1.0 - smoothstep(0.75, 1.0, gN.y) * 0.85) * intro;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform vec3 uOff;
  uniform vec3 uOn;
  uniform vec3 uHigh;
  uniform vec3 uPeakCol;
  uniform float uFadeOut;
  varying vec2 vUv;
  varying float vLit;
  varying float vPeak;
  varying float vFade;
  varying float vHot;
  varying float vH;

  float sdRound(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    // Quad spans -0.8..0.8 cell units, tile half-size .42, radius .29 (≈ 30/88).
    float d = sdRound(vUv, vec2(0.42), 0.29);
    float aa = fwidth(d) * 1.2;
    float body = 1.0 - smoothstep(-aa, aa, d);
    float on = max(vLit, vPeak);
    vec3 lit = mix(uOn, uHigh, smoothstep(0.55, 1.0, vH));
    lit = mix(lit, uPeakCol, vPeak);
    vec3 off = uOff + vHot * vec3(0.16);
    vec3 col = mix(off, lit, on);
    float glow = exp(-max(d, 0.0) * 10.0) * on * (1.0 - body) * 0.55;
    float alpha = (body * mix(0.85, 1.0, on) + glow) * vFade * uFadeOut;
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

const hex = (h: string) => {
  const c = new THREE.Color(h);
  // Shader writes raw values: keep sRGB numbers as-is.
  return new THREE.Vector3(c.r, c.g, c.b);
};

export interface EqField {
  /** Per-frame level target (0..1) for each column; length = columns. */
  setFrame(levels: Float32Array): void;
  columns(): number;
  pointer(x: number, y: number, on: boolean): void;
  /** Keep bars below `bottom` (canvas px) for columns between `left` and `right`; null clears it. */
  setKeepOut(rect: { left: number; right: number; bottom: number } | null): void;
  setScroll(p: number): void;
  renderOnce(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

export function createEqField(canvas: HTMLCanvasElement, onFrame: (dt: number, field: EqField) => void): EqField | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const uniforms = {
    uLevels: { value: new Float32Array(MAX_COLS) },
    uPeaks: { value: new Float32Array(MAX_COLS) },
    uCols: { value: 1 },
    uRows: { value: 1 },
    uCell: { value: 1 },
    uIntro: { value: 0 },
    uSpan: { value: 0.78 },
    uLift: { value: 0.9 },
    uPointer: { value: new THREE.Vector2(-10, -10) },
    uPointerOn: { value: 0 },
    uFadeOut: { value: 1 },
    uOff: { value: hex('#161616') },
    uOn: { value: hex('#d5fb46') },
    uHigh: { value: hex('#f1ffb8') },
    uPeakCol: { value: hex('#f3ffc4') },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
  });

  let mesh: THREE.Mesh | null = null;
  let geo: THREE.InstancedBufferGeometry | null = null;
  let cols = 0;
  let rows = 0;
  const levels = new Float32Array(MAX_COLS);
  const peaks = new Float32Array(MAX_COLS);
  const peakHold = new Float32Array(MAX_COLS);
  const target = new Float32Array(MAX_COLS);
  const cap = new Float32Array(MAX_COLS).fill(1);
  let keepOut: { left: number; right: number; bottom: number } | null = null;
  const v3 = new THREE.Vector3();
  const pointer = { x: -10, y: -10, on: 0, want: 0 };
  let scroll = 0;
  let raf = 0;
  let last = performance.now();
  let running = false;
  const DIST = 10;

  function build(c: number, r: number) {
    if (mesh) { group.remove(mesh); geo?.dispose(); }
    cols = c; rows = r;
    const base = new THREE.PlaneGeometry(1.6, 1.6);
    geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const cells = new Float32Array(c * r * 2);
    let k = 0;
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) { cells[k++] = x; cells[k++] = y; }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = c * r;
    mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    uniforms.uCols.value = c;
    uniforms.uRows.value = r;
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth || window.innerWidth || 1280);
    const h = Math.max(1, canvas.clientHeight || window.innerHeight || 800);
    const dpr = Math.min(window.devicePixelRatio || 1, w < 720 ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const c = Math.min(MAX_COLS, w < 520 ? 20 : w < 900 ? 30 : w < 1400 ? 44 : 54);
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * DIST;
    const visW = visH * camera.aspect;
    const gridW = visW * 1.08;
    const cell = gridW / c;
    const r = Math.min(120, Math.max(4, Math.ceil((visH * 1.1) / cell)));
    uniforms.uCell.value = cell;
    if (c !== cols || r !== rows) build(c, r);
    // Tall phones: bars span less of the screen so the copy stays clear.
    uniforms.uSpan.value = camera.aspect < 0.8 ? 0.34 : 0.4;
    computeCaps(w, h);
  }

  /** Per-column ceiling so lit cells never rise under the hero copy and CTAs. */
  function computeCaps(w: number, h: number) {
    cap.fill(1);
    if (!keepOut || !cols) return;
    const saved = scroll;
    scroll = 0;
    layout();
    scroll = saved;
    group.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const cell = uniforms.uCell.value;
    const span = rows * uniforms.uSpan.value;
    const project = (x: number, y: number) => {
      v3.set(x, y, cell * 0.6).applyMatrix4(group.matrixWorld).project(camera);
      return { sx: (v3.x + 1) / 2 * w, sy: (1 - v3.y) / 2 * h };
    };
    for (let ci = 0; ci < cols; ci++) {
      const x = (ci - (cols - 1) * 0.5) * cell;
      const { sx } = project(x, 0);
      if (sx < keepOut.left - cell * 0.6 || sx > keepOut.right + cell * 0.6) continue;
      let top = -1;
      for (let ry = 0; ry < rows; ry++) {
        // Top edge of the cell (tile half-size .42 + glow) must stay below the line.
        const { sy } = project(x, (ry - (rows - 1) * 0.5) * cell + cell * 0.6);
        if (sy < keepOut.bottom) break;
        top = ry;
      }
      // Lit rows: h <= level. Peak row = floor(peak * span) must stay <= top - 1.
      cap[ci] = top < 1 ? 0 : Math.max(0, top) / span;
    }
  }

  function layout() {
    const tilt = -0.18 - scroll * 0.55;
    group.rotation.x = tilt;
    group.position.y = -scroll * 2.2;
    camera.position.set(0, -0.6, DIST);
    camera.lookAt(0, -0.2, 0);
    uniforms.uFadeOut.value = 1 - Math.max(0, scroll - 0.35) / 0.65;
  }

  const field: EqField = {
    setFrame(input) {
      for (let i = 0; i < cols; i++) target[i] = input[i] ?? 0;
    },
    columns: () => cols,
    pointer(x, y, on) {
      pointer.x = x; pointer.y = y; pointer.want = on ? 1 : 0;
    },
    setKeepOut(rect) {
      keepOut = rect;
      computeCaps(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    },
    setScroll(p) { scroll = p; },
    renderOnce() {
      resize();
      for (let i = 0; i < cols; i++) target[i] = Math.min(target[i], cap[i]);
      uniforms.uLevels.value.set(target);
      uniforms.uPeaks.value.set(target.map((v, i) => Math.min(cap[i], v + 0.08)));
      uniforms.uIntro.value = 1;
      layout();
      renderer.render(scene, camera);
    },
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    dispose() {
      field.stop();
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      geo?.dispose();
      material.dispose();
      renderer.dispose();
    },
  };

  function loop(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    onFrame(dt, field);
    for (let i = 0; i < cols; i++) {
      const t = Math.min(target[i], cap[i]);
      levels[i] += (t - levels[i]) * (t > levels[i] ? 0.55 : 0.14);
      if (levels[i] >= peaks[i]) { peaks[i] = levels[i]; peakHold[i] = 0.35; }
      else if ((peakHold[i] -= dt) < 0) peaks[i] = Math.max(levels[i], peaks[i] - dt * 0.42);
      peaks[i] = Math.min(peaks[i], cap[i]);
    }
    uniforms.uLevels.value.set(levels);
    uniforms.uPeaks.value.set(peaks);
    pointer.on += (pointer.want - pointer.on) * 0.08;
    uniforms.uPointer.value.set(pointer.x, pointer.y);
    uniforms.uPointerOn.value = pointer.on;
    if (uniforms.uIntro.value < 1) uniforms.uIntro.value = Math.min(1, uniforms.uIntro.value + dt * 0.75);
    layout();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  let resizeT = 0;
  const onResize = () => { clearTimeout(resizeT); resizeT = window.setTimeout(resize, 120); };
  window.addEventListener('resize', onResize);
  const ro = new ResizeObserver(onResize);
  ro.observe(canvas);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    field.stop();
    canvas.closest('.hero')?.classList.remove('gl-ready');
  });

  resize();
  return field;
}

/** For reduced motion: show the field fully drawn, frozen. */
export function staticLevels(n: number, out: Float32Array) {
  for (let i = 0; i < n; i++) {
    const x = i / n;
    out[i] = 0.22 + 0.42 * Math.pow(1 - x, 1.6) + 0.12 * Math.sin(x * 11) + 0.08 * Math.sin(x * 29);
  }
}
