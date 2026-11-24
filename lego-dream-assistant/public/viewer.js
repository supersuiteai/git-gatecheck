import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// One stud of width is one world unit; a plate is 0.4 tall, a brick 1.2.
const PLATE = 0.4;
const GAP = 0.03;
const STUD_R = 0.3;
const STUD_H = 0.2;

export const COLOR_HEX = {
  red: 0xd3232b, blue: 0x1e6fd0, yellow: 0xf7c81e, green: 0x2a9d4b, lime: 0xa6ce39,
  orange: 0xf58220, white: 0xf4f4f0, black: 0x2a2a2e, gray: 0xa3a8ad, darkgray: 0x646a70,
  brown: 0x7a4a2b, tan: 0xdcc58f, pink: 0xf28cb8, purple: 0x7d4bb3, lightblue: 0x7fc4ee,
};

const heightOf = (kind) => (kind === 'plate' ? 1 : 3) * PLATE;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function stud(x, y, z) {
  const g = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 20).toNonIndexed();
  g.translate(x, y + STUD_H / 2, z);
  return g;
}

const geometryCache = new Map();

// Geometry is centred on the footprint in x/z with its bottom at y = 0.
function pieceGeometry({ kind, sizeX, sizeZ, facing }) {
  const id = [kind, sizeX, sizeZ, kind === 'slope' ? facing : ''].join('|');
  if (geometryCache.has(id)) return geometryCache.get(id);

  const h = heightOf(kind);
  let body;
  const parts = [];

  if (kind === 'slope') {
    // Modelled with the low edge toward +x, then turned to its facing.
    const alongX = facing === '+x' || facing === '-x';
    const depth = (alongX ? sizeX : sizeZ) - GAP;
    const width = (alongX ? sizeZ : sizeX) - GAP;
    const flat = depth > 1 ? 1 : 0.3;
    const shape = new THREE.Shape();
    shape.moveTo(-depth / 2, 0);
    shape.lineTo(depth / 2, 0);
    shape.lineTo(depth / 2, 0.25);
    shape.lineTo(-depth / 2 + flat, h);
    shape.lineTo(-depth / 2, h);
    shape.closePath();
    body = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    body.translate(0, 0, -width / 2);
    parts.push(body);
    if (depth > 1) {
      const n = Math.round(width + GAP);
      for (let i = 0; i < n; i++) parts.push(stud(-depth / 2 + 0.5 - GAP / 2, h, i - (n - 1) / 2));
    }
    const turn = { '+x': 0, '-x': Math.PI, '+z': -Math.PI / 2, '-z': Math.PI / 2 }[facing];
    for (const g of parts) g.rotateY(turn);
  } else {
    body = new THREE.BoxGeometry(sizeX - GAP, h, sizeZ - GAP).toNonIndexed();
    body.translate(0, h / 2, 0);
    parts.push(body);
    for (let i = 0; i < sizeX; i++) {
      for (let j = 0; j < sizeZ; j++) {
        parts.push(stud(i - (sizeX - 1) / 2, h, j - (sizeZ - 1) / 2));
      }
    }
  }

  const entry = {
    solid: mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))),
    edges: new THREE.EdgesGeometry(body, 30),
  };
  geometryCache.set(id, entry);
  return entry;
}

const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 });

function makePiece(piece) {
  const { solid, edges } = pieceGeometry(piece);
  const material = new THREE.MeshStandardMaterial({
    color: COLOR_HEX[piece.color] ?? COLOR_HEX.gray,
    roughness: 0.35,
    metalness: 0.02,
  });
  material.emissive.copy(material.color);
  material.emissiveIntensity = 0;
  const mesh = new THREE.Mesh(solid, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(edges, edgeMaterial));
  return mesh;
}

function addLights(scene, shadows) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4d6, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(8, 16, 10);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    sun.shadow.bias = -0.0005;
  }
  scene.add(sun);
  return sun;
}

const bounce = (t) => {
  if (t < 0.6) return (t / 0.6) ** 2;
  if (t < 0.85) return 1 - 0.12 * (1 - ((t - 0.725) / 0.125) ** 2);
  return 1 - 0.03 * (1 - ((t - 0.925) / 0.075) ** 2);
};

// The interactive model: drag to spin it in place, pinch to zoom.
export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
    this.sun = addLights(this.scene, true);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 48),
      new THREE.ShadowMaterial({ opacity: 0.18 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false; // the model stays put; only the view turns
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.9;

    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.steps = [];
    this.current = [];
    this.animStart = 0;
    this.radius = 5;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitDistance();
  }

  // Distance at which the whole finished model fits, whatever the screen shape.
  fitDistance() {
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const fit = Math.min(half, Math.atan(Math.tan(half) * this.camera.aspect));
    this.distance = (this.radius / Math.sin(fit)) * 1.08;
    this.controls.minDistance = this.distance * 0.45;
    this.controls.maxDistance = this.distance * 1.8;
  }

  load(plan, { keepView = false } = {}) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    for (const s of this.steps) for (const m of s) m.material.dispose();
    this.model.clear();
    const box = new THREE.Box3();
    this.steps = plan.steps.map((step) =>
      step.pieces.map((piece) => {
        const mesh = makePiece(piece);
        mesh.position.set(piece.x + piece.sizeX / 2, piece.y * PLATE, piece.z + piece.sizeZ / 2);
        mesh.userData.restY = mesh.position.y;
        mesh.visible = false;
        this.model.add(mesh);
        box.union(new THREE.Box3().setFromObject(mesh));
        return mesh;
      }),
    );
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.radius = Math.max(sphere.radius, 2);
    this.controls.target.copy(sphere.center);
    this.sun.target.position.copy(sphere.center);
    this.scene.add(this.sun.target);
    this.fitDistance();
    if (keepView) {
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    } else {
      this.resetView();
    }
  }

  resetView() {
    const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, this.distance);
    this.controls.update();
  }

  // Shows everything built so far and drops this step's pieces into place.
  showStep(index) {
    this.steps.forEach((meshes, i) => {
      for (const m of meshes) {
        m.visible = i <= index;
        m.position.y = m.userData.restY;
        m.material.emissiveIntensity = 0;
        m.material.transparent = false;
        m.material.opacity = 1;
      }
    });
    this.current = this.steps[index] ?? [];
    this.animStart = performance.now();
    this.animate = !reducedMotion();
  }

  // The finished model with nothing highlighted.
  showAll() {
    this.showStep(this.steps.length - 1);
    this.current = [];
  }

  frame(now) {
    const dropHeight = this.radius * 1.2 + 3;
    this.current.forEach((m, i) => {
      const t = this.animate ? THREE.MathUtils.clamp((now - this.animStart - i * 280) / 750, 0, 1) : 1;
      m.position.y = m.userData.restY + (1 - bounce(t)) * dropHeight;
      m.material.transparent = t < 0.3;
      m.material.opacity = Math.min(1, t / 0.3);
      m.visible = t > 0;
      m.material.emissiveIntensity = this.animate ? 0.22 + 0.14 * Math.sin(now / 260) : 0.25;
    });
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

// Small still pictures of single pieces, for the parts lists.
let iconKit = null;
const iconCache = new Map();

export function pieceIcon({ kind, color, sizeA, sizeB }) {
  const id = [kind, color, sizeA, sizeB].join('|');
  if (iconCache.has(id)) return iconCache.get(id);

  if (!iconKit) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(160, 160);
    const scene = new THREE.Scene();
    addLights(scene, false);
    iconKit = { renderer, scene, camera: new THREE.PerspectiveCamera(30, 1, 0.1, 200) };
  }
  const { renderer, scene, camera } = iconKit;
  const mesh = makePiece({ kind, color, sizeX: sizeB, sizeZ: sizeA, facing: '+z' });
  scene.add(mesh);
  const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02;
  camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.7, 0.75, 1).normalize(), distance);
  camera.lookAt(sphere.center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(mesh);
  mesh.material.dispose();
  iconCache.set(id, url);
  return url;
}
