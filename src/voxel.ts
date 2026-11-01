// Renders a CityModel as a colourful cube city (one column of blocks per cell).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CLASSES, NEW_STATION_COLOR, PIN_STICK_COLOR, STATION_COLOR } from "./classes";
import { CityModel } from "./classify";

const FADE = new THREE.Color("#e4e6ea");

/** Highlight colours of the overlays; everything not highlighted is faded. Shared with the legend. */
export const OVERLAY_COLORS = {
  converted: "#ff1f8f",
  green: "#19c24a",
  grown: "#ff9a00",
  retrofit: "#2f80ed",
  tod: "#f5b700",
  protected: "#e5484d",
};
const CONVERTED = new THREE.Color(OVERLAY_COLORS.converted);
const GROWN = new THREE.Color(OVERLAY_COLORS.grown);
const NEW_GREEN = new THREE.Color(OVERLAY_COLORS.green);
const RETROFIT = new THREE.Color(OVERLAY_COLORS.retrofit);
const TOD = new THREE.Color(OVERLAY_COLORS.tod);
const PROTECTED = new THREE.Color(OVERLAY_COLORS.protected);

export type Overlay = "none" | "tod" | "zoning" | "changes";

/** Deterministic pseudo-random number in [0, 1) per cell and salt. */
function hash(i: number, salt: number) {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Unit cube with shaded faces baked into vertex colours: lit top, darker sides, like the illustrations. */
function shadedBox(): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const shade = [0.78, 0.78, 1.0, 0.5, 0.9, 0.9]; // +x, -x, +y, -y, +z, -z
  const colors: number[] = [];
  for (let face = 0; face < 6; face++) for (let v = 0; v < 4; v++) colors.push(shade[face], shade[face], shade[face]);
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

interface Block {
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  d: number;
  color: THREE.Color;
  /** grid cell the block stands on */
  cell?: number;
}

/** A new-station pin as a cursor: a grey stick with a red cube on top, pointing at its foot. */
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" viewBox="0 0 32 48"><rect x="14" y="16" width="4" height="30" fill="${PIN_STICK_COLOR}" stroke="#23262f" stroke-width="1.5"/><path d="M16 2 L29 9 L16 16 L3 9 Z" fill="#ff7a73" stroke="#23262f" stroke-width="1.5"/><path d="M3 9 L16 16 L16 30 L3 23 Z" fill="${NEW_STATION_COLOR}" stroke="#23262f" stroke-width="1.5"/><path d="M29 9 L16 16 L16 30 L29 23 Z" fill="#b51f1a" stroke="#23262f" stroke-width="1.5"/></svg>`;
const PIN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(PIN_SVG)}") 16 46, crosshair`;
export const PIN_ICON = PIN_SVG;

export class CubeCity {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private controls: OrbitControls;
  private ground?: THREE.InstancedMesh;
  private objects?: THREE.InstancedMesh;
  private model?: CityModel;
  private changed?: Uint8Array;
  private overlay: Overlay = "none";
  /** When true, the mouse wheel zooms without Ctrl/⌘. */
  wheelZooms = false;
  private groundBase: THREE.Color[] = [];
  private objectBase: THREE.Color[] = [];
  private objectCell: number[] = [];
  private raycaster = new THREE.Raycaster();
  private observer = new ResizeObserver(() => this.resize());
  private geometry = shadedBox();
  private material = new THREE.MeshBasicMaterial({ vertexColors: true });
  /** Called with the cell under a click (not a drag); set while the player places stations. */
  onPick?: (cell: number) => void;
  private downAt?: [number, number];
  /** Labels floating above the new stations' pins, and where each pin's head is. */
  private labelLayer = document.createElement("div");
  private pinTops = new Map<number, THREE.Vector3>();
  private pinLabels: { cell: number; el: HTMLElement }[] = [];
  /** Fingers on the city now, and whether this touch gesture has used two of them. */
  private touches = 0;
  private multiTouch = false;

  constructor(private container: HTMLElement, private onHover: (cell: number | null, x: number, y: number) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.labelLayer.className = "pin-labels";
    container.appendChild(this.labelLayer);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.45;
    this.controls.screenSpacePanning = false;
    // Drag turns the city; double-click and drag (or right-drag, Shift + drag) moves it.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    // On touch screens one finger turns the city; two fingers move and pinch-zoom it.
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.minZoom = 0.5;
    this.controls.maxZoom = 12;
    // A press that follows a click within a moment is the second half of a double click: that drag
    // moves the city. Registered for the capture phase so it runs before the controls see the press.
    let lastUp = 0, lastUpAt: [number, number] = [0, 0];
    this.renderer.domElement.addEventListener(
      "pointerdown",
      (e) => {
        const double = performance.now() - lastUp < 350 && Math.hypot(e.clientX - lastUpAt[0], e.clientY - lastUpAt[1]) < 20;
        this.controls.mouseButtons.LEFT = double ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
        // Pinching zooms; the mouse wheel is handled below.
        this.controls.enableZoom = e.pointerType === "touch";
      },
      { capture: true },
    );
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      lastUp = performance.now();
      lastUpAt = [e.clientX, e.clientY];
    });
    // Ctrl/⌘ + scroll zooms the city; plain scrolling moves the page unless the page cannot
    // scroll behind the city (wide screens), where plain scrolling zooms too.
    this.controls.enableZoom = false;
    this.renderer.domElement.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey && !this.wheelZooms) return;
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      },
      { passive: false },
    );
    this.observer.observe(container);
    // A mouse shows a cell's details on hover. A finger shows them only on a tap, so turning, moving
    // or zooming the city does not keep opening them.
    this.renderer.domElement.addEventListener("pointermove", (e) => e.pointerType !== "touch" && this.hover(e));
    this.renderer.domElement.addEventListener("pointerleave", (e) => e.pointerType !== "touch" && this.onHover(null, 0, 0));
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      this.downAt = [e.clientX, e.clientY];
      if (e.pointerType !== "touch") return;
      if (++this.touches > 1) this.multiTouch = true;
      this.onHover(null, 0, 0);
    });
    const touchEnd = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return false;
      this.touches = Math.max(0, this.touches - 1);
      const multi = this.multiTouch;
      if (!this.touches) this.multiTouch = false;
      return multi;
    };
    this.renderer.domElement.addEventListener("pointercancel", touchEnd);
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      const d = this.downAt;
      this.downAt = undefined;
      const multi = touchEnd(e);
      // A click moves the pointer a few pixels at most; anything more was a drag to turn the city.
      if (multi || !d || e.button !== 0 || Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
      if (e.pointerType === "touch") this.hover(e);
      const cell = this.onPick ? this.cellAt(e) : null;
      if (cell !== null) this.onPick!(cell);
    });
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.placeLabels();
    });
  }

  /** Moves the 3D view into another element, keeping the camera (used by the results page). */
  moveTo(container: HTMLElement) {
    if (container === this.container) return;
    this.observer.disconnect();
    this.container = container;
    container.appendChild(this.renderer.domElement);
    container.appendChild(this.labelLayer);
    this.observer.observe(container);
    this.fit();
  }

  /** Sizes the view to its container; called again once a hidden container is shown. */
  fit() {
    this.resize();
    requestAnimationFrame(() => this.resize());
  }

  /** Points the camera back at the whole city from the starting angle. */
  resetView() {
    if (this.model) this.show(this.model, this.changed, false);
  }

  /** The current view as a PNG data URL (rendered now, so the drawing buffer is still filled). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  private resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    const n = this.model?.grid.n ?? 100;
    const half = n * 0.5;
    const aspect = w / h;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  /** Builds the cube city. Pass `changed` to mark cells a strategy converted; keepView keeps the camera. */
  show(model: CityModel, changed?: Uint8Array, keepView = false) {
    this.model = model;
    this.changed = changed;
    const { n, cellM } = model.grid;
    for (const m of [this.ground, this.objects]) if (m) { this.scene.remove(m); m.dispose(); }

    const { elevation } = model.terrain;
    let minE = Infinity;
    for (const e of elevation) minE = Math.min(minE, e);
    // Terrain in half-block steps, exaggerated ×1.5 so hills read without dwarfing the city.
    const groundH = (i: number) => 0.5 + Math.min(8, Math.round(((elevation[i] - minE) / cellM) * 1.5 * 2) / 2);

    const ground: Block[] = [];
    const objects: Block[] = [];
    this.pinTops.clear();
    const stationCells = new Map(model.stations.map((s) => [s.cell, s]));
    const col = (hex: string, i: number, salt: number, amount = 0.08) => {
      const c = new THREE.Color(hex);
      return c.offsetHSL(0, 0, (hash(i, salt) - 0.5) * amount);
    };

    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const cls = CLASSES[model.cls[i]];
        const x = c - n / 2 + 0.5, z = r - n / 2 + 0.5;
        let gh = groundH(i);
        if (cls.id === 9) gh = Math.max(0.3, gh - 0.3);
        ground.push({ x, z, y: 0, w: 1, h: gh, d: 1, color: col(cls.ground, i, 1, cls.id === 9 ? 0.03 : 0.1) });

        if (cls.stack && cls.block) {
          const [lo, hi] = cls.stack;
          // One block per ~6 m (two floors) of real building height, kept within the class range.
          const h = model.height[i];
          const blocks = h > 0 ? Math.max(lo, Math.min(hi, Math.round(h / 6))) : lo + Math.floor(hash(i, 2) * (hi - lo + 1));
          const w = cls.id === 4 ? 0.9 : cls.id === 1 ? 0.8 : 0.7;
          for (let b = 0; b < blocks; b++)
            objects.push({ cell: i, x, z, y: gh + b * 0.8, w, h: 0.8, d: w, color: col(cls.block, i + b, 3, 0.06) });
          objects.push({ cell: i, x, z, y: gh + blocks * 0.8, w: w * (cls.id === 3 ? 1.05 : 0.9), h: cls.id === 3 ? 0.35 : 0.12, d: w * (cls.id === 3 ? 1.05 : 0.9), color: col(cls.roof!, i, 4, 0.06) });
        } else if ((cls.id === 7 && (hash(i, 5) < 0.55 || changed?.[i] === 4)) || (cls.id === 8 && hash(i, 5) < 0.04)) {
          // New green from a strategy always gets a tree, so green streets read as tree-lined.
          objects.push({ cell: i, x, z, y: gh, w: 0.18, h: 0.5, d: 0.18, color: new THREE.Color("#7a5230") });
          objects.push({ cell: i, x, z, y: gh + 0.4, w: 0.7, h: 0.7, d: 0.7, color: col("#3f8f2a", i, 6, 0.12) });
        }

        const station = stationCells.get(i);
        if (station?.added) {
          // A new station: a map pin in cubes, a thin grey stick with a red cube on top, standing
          // above the buildings so it reads from far away.
          // Sized to the city, so it reads at any frame size.
          const head = Math.max(1.5, n * 0.03), stick = Math.max(8, n * 0.12);
          objects.push({ cell: i, x, z, y: gh, w: head * 0.25, h: stick, d: head * 0.25, color: new THREE.Color(PIN_STICK_COLOR) });
          objects.push({ cell: i, x, z, y: gh + stick, w: head, h: head, d: head, color: new THREE.Color(NEW_STATION_COLOR) });
          this.pinTops.set(i, new THREE.Vector3(x, gh + stick + head * 1.15, z));
        } else if (station) {
          const rapid = station.kind === "rail" || station.kind === "brt";
          objects.push({ cell: i, x: x + 0.3, z: z + 0.3, y: gh, w: rapid ? 0.45 : 0.25, h: rapid ? 2.2 : 1.1, d: rapid ? 0.45 : 0.25, color: new THREE.Color(STATION_COLOR) });
        }
      }

    this.ground = this.instanced(ground);
    this.objects = this.instanced(objects);
    this.groundBase = ground.map((b) => b.color.clone());
    this.objectBase = objects.map((b) => b.color.clone());
    this.objectCell = objects.map((b) => b.cell ?? -1);
    this.scene.add(this.ground, this.objects);

    if (!keepView) {
      this.camera.position.set(n, n * 0.9, n);
      this.camera.zoom = 1;
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.resize();
    }
    this.setOverlay(this.overlay);
  }

  private instanced(blocks: Block[]): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, blocks.length);
    const m = new THREE.Matrix4();
    blocks.forEach((b, k) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, b.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  }

  /** While placing stations the pointer becomes a pin. */
  set placing(on: boolean) {
    this.renderer.domElement.style.cursor = on ? PIN_CURSOR : "";
  }

  /** Text above each new station's pin, e.g. the people it reaches. */
  setPinLabels(labels: { cell: number; text: string }[]) {
    this.labelLayer.replaceChildren();
    this.pinLabels = labels.map(({ cell, text }) => {
      const el = document.createElement("span");
      el.textContent = text;
      this.labelLayer.appendChild(el);
      return { cell, el };
    });
  }

  private placeLabels() {
    if (!this.pinLabels.length) return;
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const { cell, el } of this.pinLabels) {
      const top = this.pinTops.get(cell);
      if (!top) {
        el.style.display = "none";
        continue;
      }
      v.copy(top).project(this.camera);
      el.style.display = "";
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  zoomBy(factor: number) {
    this.camera.zoom = Math.max(0.5, Math.min(12, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
  }

  /** Turns the city around its centre of view (for the ↺ ↻ buttons, which touch screens need). */
  rotateBy(radians: number) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }

  setOverlay(mode: Overlay) {
    this.overlay = mode;
    if (!this.ground || !this.model) return;
    const m = this.model;
    // Every overlay works the same way: the selected cells take a bright colour, the rest is faded.
    const highlight = (i: number): THREE.Color | null => {
      if (i < 0) return null;
      if (mode === "tod") return m.todStd[i] ? TOD : null;
      if (mode === "zoning") return m.zoning[i] ? null : PROTECTED;
      const v = this.changed?.[i];
      return v === 1 ? CONVERTED : v === 2 ? GROWN : v === 3 ? RETROFIT : v === 4 ? NEW_GREEN : null;
    };
    const paint = (base: THREE.Color, i: number, strength: number, out: THREE.Color) => {
      out.copy(base);
      if (mode === "none") return out;
      const h = highlight(i);
      return out.lerp(h ?? FADE, h ? strength : 0.55);
    };
    const c = new THREE.Color();
    this.groundBase.forEach((base, i) => this.ground!.setColorAt(i, paint(base, i, 0.85, c)));
    this.ground.instanceColor!.needsUpdate = true;
    if (!this.objects) return;
    this.objectBase.forEach((base, k) => this.objects!.setColorAt(k, paint(base, this.objectCell[k], 0.8, c)));
    this.objects.instanceColor!.needsUpdate = true;
  }

  /** The ground cell under the pointer. */
  private cellAt(e: PointerEvent): number | null {
    if (!this.ground) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    return this.raycaster.intersectObject(this.ground)[0]?.instanceId ?? null;
  }

  private hover(e: PointerEvent) {
    if (!this.ground) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.onHover(this.cellAt(e), e.clientX - rect.left, e.clientY - rect.top);
  }
}
