import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const zoneIds = ['roasting', 'packing', 'green', 'dispatch', 'lab', 'purchases'];
const overviewDirection = new THREE.Vector3(1, 1.05, 1.3).normalize();
const overviewTarget = new THREE.Vector3(0, 1.3, 2);
const floorBounds = new THREE.Box3(new THREE.Vector3(-19, -.6, -11.5), new THREE.Vector3(19, 9, 17.5));

export function createWarehouseScene({ container, onSelect, onReady, onError, reducedMotion = false }) {
  if (!container?.appendChild) throw new Error('A container is needed for the warehouse view.');

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    queueMicrotask(() => onError?.(error));
    return { setData() {}, focus() {}, setPaused() {}, setReducedMotion() {}, resize() {}, dispose() {}, projectPins: () => [] };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, .2, 240);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', 'Interactive illustration of the Black Market Coffee roastery');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.cursor = 'grab';
  container.appendChild(canvas);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0xe9e7df, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedMotion;
  controls.dampingFactor = .075;
  controls.minDistance = 9;
  controls.maxDistance = 165;
  controls.minPolarAngle = .38;
  controls.maxPolarAngle = 1.25;
  controls.minAzimuthAngle = -.15;
  controls.maxAzimuthAngle = 1.35;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.target.copy(overviewTarget);

  const geometries = new Set();
  const materials = new Set();
  const workers = [];
  const zones = new Map();
  const pins = new Map();
  const wheels = [];
  const activities = { roasting: .55, packing: .5, green: .35, dispatch: .4, lab: .35, purchases: .25 };
  let disposed = false;
  let paused = false;
  let contextLost = false;
  let inViewport = true;
  let frameId;
  let lastTime = 0;
  let elapsed = 0;
  let ready = false;
  let width = 1;
  let height = 1;
  let selectedZone = 'overview';
  let cameraTween;
  let pointerStart;
  let hoverAt = 0;
  let dataReceived = false;

  function geometry(value) { geometries.add(value); return value; }
  function material(color, options = {}) {
    const value = new THREE.MeshStandardMaterial({ color, roughness: .8, ...options });
    materials.add(value);
    return value;
  }
  const palette = {
    plaster: material(0xe7e0d3), concrete: material(0xc8c5b9), floor: material(0xd8d4c6),
    steel: material(0x343e3b, { metalness: .45, roughness: .5 }), ink: material(0x222c29, { metalness: .3 }),
    copper: material(0xb86e43, { metalness: .65, roughness: .34 }), copperLight: material(0xd79560, { metalness: .6, roughness: .3 }),
    silver: material(0xaab1aa, { metalness: .7, roughness: .28 }), wood: material(0xb38c5a), woodLight: material(0xc9aa7f),
    green: material(0x425c49), greenLight: material(0x819476), sage: material(0xb7c0ac),
    burlap: material(0xc9b48c), burlapLight: material(0xdbcaab), sackSeam: material(0x8f805e),
    white: material(0xf0eee4), red: material(0xa72f32), road: material(0x727972),
    window: material(0xadc8c8, { metalness: .16, roughness: .3 }), glass: material(0x425c62, { metalness: .3, roughness: .22 }),
    tire: material(0x30352f), skin: material(0xc88f69), skinLight: material(0xe1b490), skinDark: material(0x986846),
    navy: material(0x354c5b), cream: material(0xd7cbb6), apron: material(0x496954), hair: material(0x3d332c),
    coffee: material(0x553829), light: material(0xffe7b4, { emissive: 0xffe7b4, emissiveIntensity: .3 }),
  };
  const boxGeometry = geometry(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = geometry(new THREE.CylinderGeometry(1, 1, 1, 20));
  const sphereGeometry = geometry(new THREE.SphereGeometry(1, 16, 12));
  const ringGeometry = geometry(new THREE.TorusGeometry(1, .045, 6, 36));

  function mesh(shape, surface, parent, position, scale, shadows = true) {
    const object = new THREE.Mesh(shape, surface);
    if (position) object.position.set(...position);
    if (scale) object.scale.set(...scale);
    object.castShadow = shadows;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function box(parent, surface, size, position, shadows = true) {
    return mesh(boxGeometry, surface, parent, position, size, shadows);
  }
  function cylinder(parent, surface, radius, length, position, shadows = true) {
    return mesh(cylinderGeometry, surface, parent, position, [radius, length, radius], shadows);
  }
  function sphere(parent, surface, radius, position, scale = [1, 1, 1]) {
    return mesh(sphereGeometry, surface, parent, position, scale.map(value => value * radius));
  }
  function pipe(parent, surface, start, end, radius = .09) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const object = cylinder(parent, surface, radius, a.distanceTo(b), a.clone().add(b).multiplyScalar(.5).toArray());
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    return object;
  }
  function group(parent, position = [0, 0, 0]) {
    const object = new THREE.Group();
    object.position.set(...position);
    parent.add(object);
    return object;
  }
  function torus(parent, surface, radius, position, rotation = [Math.PI / 2, 0, 0]) {
    const object = mesh(ringGeometry, surface, parent, position, [radius, radius, radius]);
    object.rotation.set(...rotation);
    return object;
  }
  function makeZone(id, position, pinPosition, footprint) {
    const root = group(scene, position);
    root.userData.zone = id;
    const tint = new THREE.MeshBasicMaterial({ color: 0x718475, transparent: true, opacity: .075, depthWrite: false });
    materials.add(tint);
    const pad = box(root, tint, [footprint[0], .025, footprint[1]], [0, .018, 0], false);
    pad.receiveShadow = false;
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x617c67, transparent: true, opacity: .2 });
    materials.add(outlineMaterial);
    const [x, z] = [footprint[0] / 2, footprint[1] / 2];
    const lineGeometry = geometry(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-x, .045, -z), new THREE.Vector3(x, .045, -z),
      new THREE.Vector3(x, .045, z), new THREE.Vector3(-x, .045, z),
    ]));
    root.add(new THREE.LineLoop(lineGeometry, outlineMaterial));
    zones.set(id, { root, tint, outlineMaterial });
    pins.set(id, new THREE.Vector3(...pinPosition));
    return root;
  }

  scene.add(new THREE.HemisphereLight(0xf6f1dc, 0x81907e, 2.1));
  const sunlight = new THREE.DirectionalLight(0xffeed3, 3.2);
  sunlight.position.set(-13, 24, 16);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunlight.shadow.camera, { left: -28, right: 28, top: 24, bottom: -25, near: .5, far: 65 });
  sunlight.shadow.normalBias = .04;
  sunlight.shadow.bias = -.0002;
  scene.add(sunlight);
  const fill = new THREE.DirectionalLight(0xd7e6e5, 1.35);
  fill.position.set(16, 14, -6);
  scene.add(fill);

  // The cutaway keeps the front and right edges open to every work area.
  box(scene, palette.concrete, [36, .65, 27], [0, -.48, 1.6]);
  box(scene, palette.floor, [32, .22, 22], [0, -.08, 0]);
  box(scene, palette.plaster, [32, 7.2, .32], [0, 3.55, -10.8]);
  box(scene, palette.plaster, [.32, 5.6, 22], [-15.8, 2.75, 0]);
  box(scene, palette.concrete, [.4, .75, 22], [-15.7, .3, 0]);
  for (const x of [-15.5, -5.1, 5.1, 15.5]) {
    box(scene, palette.steel, [.22, 7.5, .26], [x, 3.65, -10.45]);
  }
  box(scene, palette.steel, [31.4, .3, .34], [0, 7.4, -10.45]);
  box(scene, palette.steel, [.28, .32, 21.5], [-15.5, 5.5, 0]);
  for (const z of [-9.6, -2, 6]) {
    pipe(scene, palette.steel, [-15.4, 4.5, z], [-14.3, 5.5, z], .055);
  }
  for (const x of [-10.2, -2.8, 5.5, 12.1]) {
    box(scene, palette.white, [5.3, 2.45, .18], [x, 4.8, -10.55]);
    box(scene, palette.window, [5.03, 2.16, .12], [x, 4.8, -10.42], false);
    for (const dx of [-.83, .83]) box(scene, palette.white, [.08, 2.2, .16], [x + dx, 4.8, -10.3], false);
    box(scene, palette.white, [5.05, .08, .16], [x, 4.8, -10.3], false);
    box(scene, palette.concrete, [5.45, .16, .55], [x, 3.56, -10.25]);
  }
  for (const z of [-5, 3.5]) {
    box(scene, palette.white, [.16, 2.5, 5.2], [-15.58, 3.75, z]);
    box(scene, palette.window, [.12, 2.23, 4.94], [-15.45, 3.75, z], false);
    box(scene, palette.white, [.16, 2.25, .09], [-15.34, 3.75, z]);
    box(scene, palette.white, [.16, .09, 5], [-15.34, 3.75, z]);
  }
  for (const x of [-12, -8, -4, 0, 4, 8, 12]) {
    box(scene, palette.concrete, [.018, .012, 21], [x, .04, 0], false);
  }
  for (const z of [-7, -3, 1, 5, 9]) box(scene, palette.concrete, [31, .012, .018], [0, .04, z], false);
  // A clear travel lane connects the roaster to packing and the loading bay.
  for (const x of [2.8, 3.8, 4.8, 5.8, 6.8, 7.8, 8.8, 9.8, 10.8]) {
    box(scene, palette.white, [.55, .02, .075], [x, .055, 4.55], false);
  }

  const roasting = makeZone('roasting', [-1, 0, -1.5], [-1, 7.1, -1.7], [7.5, 9.2]);
  box(roasting, palette.ink, [3.75, .32, 4], [0, .25, -.65]);
  for (const x of [-1.25, 1.25]) {
    box(roasting, palette.steel, [.28, 1.8, 2.5], [x, 1.12, -.7]);
    box(roasting, palette.ink, [.65, .13, 2.8], [x, .14, -.7]);
  }
  const drum = cylinder(roasting, palette.ink, 1.48, 2.8, [0, 2.45, -.85]);
  drum.rotation.x = Math.PI / 2;
  const backCollar = cylinder(roasting, palette.copper, 1.54, .24, [0, 2.45, -2.18]);
  backCollar.rotation.x = Math.PI / 2;
  const frontPlate = cylinder(roasting, palette.copper, 1.55, .23, [0, 2.45, .64]);
  frontPlate.rotation.x = Math.PI / 2;
  torus(roasting, palette.copperLight, 1.43, [0, 2.45, .79], [0, 0, 0]);
  const door = cylinder(roasting, palette.ink, .64, .16, [0, 2.45, .85]);
  door.rotation.x = Math.PI / 2;
  torus(roasting, palette.silver, .6, [0, 2.45, .96], [0, 0, 0]);
  const doorGlass = cylinder(roasting, palette.glass, .43, .05, [0, 2.45, .96]);
  doorGlass.rotation.x = Math.PI / 2;
  box(roasting, palette.steel, [.15, .48, .12], [.7, 2.46, .96]);
  pipe(roasting, palette.wood, [.7, 2.63, 1.04], [1.08, 2.63, 1.04], .09);
  for (let index = 0; index < 14; index++) {
    const angle = index / 14 * Math.PI * 2;
    sphere(roasting, palette.silver, .055, [Math.cos(angle) * 1.28, 2.45 + Math.sin(angle) * 1.28, .81]);
  }
  pipe(roasting, palette.silver, [-.55, 3.6, .85], [-.55, 3.97, .85], .045);
  const gauge = cylinder(roasting, palette.white, .18, .075, [-.55, 3.94, .88]);
  gauge.rotation.x = Math.PI / 2;
  pipe(roasting, palette.ink, [-.55, 3.94, .94], [-.48, 4.04, .94], .015);
  const chute = geometry(new THREE.ConeGeometry(.72, .9, 4));
  const discharge = mesh(chute, palette.copper, roasting, [0, 1.6, 1.25], [1, 1, .8]);
  discharge.rotation.x = -.35;
  cylinder(roasting, palette.steel, 1.64, .65, [0, 1.08, 2.62]);
  cylinder(roasting, palette.coffee, 1.52, .06, [0, 1.42, 2.62], false);
  torus(roasting, palette.silver, 1.61, [0, 1.43, 2.62]);
  const coolingArms = group(roasting, [0, 1.48, 2.62]);
  box(coolingArms, palette.silver, [2.92, .07, .12], [0, 0, 0]);
  box(coolingArms, palette.silver, [.12, .07, 2.92], [0, 0, 0]);
  cylinder(coolingArms, palette.copper, .18, .2, [0, .08, 0]);
  for (const [x, z] of [[-1.1, 1.7], [1.1, 1.7], [-1.1, 3.4], [1.1, 3.4]]) {
    cylinder(roasting, palette.steel, .09, .85, [x, .48, z]);
  }
  cylinder(roasting, palette.ink, .46, 1.1, [0, 4.02, -1.15]);
  const hopper = geometry(new THREE.CylinderGeometry(1.14, .35, 1.25, 24, 1, true));
  mesh(hopper, palette.copper, roasting, [0, 4.9, -1.15]);
  cylinder(roasting, palette.coffee, 1.05, .035, [0, 5.52, -1.15], false);
  torus(roasting, palette.copperLight, 1.14, [0, 5.55, -1.15]);
  pipe(roasting, palette.steel, [.95, 3.15, -2.2], [.95, 6.7, -2.2], .22);
  pipe(roasting, palette.steel, [.95, 6.7, -2.2], [.95, 6.7, -5.1], .22);
  cylinder(roasting, palette.silver, .28, .13, [.95, 5.6, -2.2]);
  box(roasting, palette.steel, [.65, 1.02, .6], [2.05, 2, .05]);
  box(roasting, palette.glass, [.43, .3, .04], [2.05, 2.25, .37]);
  for (const [x, surface] of [[1.9, palette.red], [2.13, palette.greenLight]]) {
    const button = cylinder(roasting, surface, .055, .055, [x, 1.92, .37]);
    button.rotation.x = Math.PI / 2;
  }
  pipe(roasting, palette.steel, [2.05, .18, .05], [2.05, 1.6, .05], .09);
  const motor = cylinder(roasting, palette.steel, .4, .9, [-1.9, 1.35, -.8]);
  motor.rotation.z = Math.PI / 2;
  roasting.scale.setScalar(1.18);

  const green = makeZone('green', [-10, 0, -5.1], [-10.2, 3.7, -5.5], [8.4, 7]);
  const sackShape = geometry(new THREE.LatheGeometry([
    new THREE.Vector2(.12, 0), new THREE.Vector2(.37, .07), new THREE.Vector2(.45, .24),
    new THREE.Vector2(.44, .65), new THREE.Vector2(.32, .86), new THREE.Vector2(.14, .96),
    new THREE.Vector2(.1, 1.05), new THREE.Vector2(.16, 1.1),
  ], 12));
  function pallet(parent, position, size = [2.65, 2.1]) {
    const base = group(parent, position);
    for (const x of [-.9, 0, .9]) box(base, palette.wood, [.2, .3, size[1]], [x, .16, 0]);
    for (let index = 0; index < 5; index++) {
      box(base, palette.woodLight, [size[0], .12, .3], [0, .37, -size[1] / 2 + .19 + index * (size[1] - .38) / 4]);
    }
    return base;
  }
  for (const [index, position] of [[0, [-2.1, 0, -1.25]], [1, [1.7, 0, -1.4]], [2, [-1.9, 0, 1.65]]]) {
    const base = pallet(green, position);
    for (let level = 0; level < 2; level++) {
      for (let indexInLayer = 0; indexInLayer < 5; indexInLayer++) {
        const x = indexInLayer % 3 * .81 - .81;
        const z = Math.floor(indexInLayer / 3) * .85 - .4;
        const sack = mesh(sackShape, (index + indexInLayer) % 3 ? palette.burlap : palette.burlapLight,
          base, [x + level * .08, .43 + level * .86, z], [.95, .85, .83]);
        sack.rotation.y = .2 + indexInLayer * .26;
        const band = torus(base, palette.green, .4, [x + level * .08, .8 + level * .86, z]);
        band.scale.z *= .82;
      }
    }
  }
  const palletJack = group(green, [2.1, 0, 2]);
  box(palletJack, palette.red, [1.55, .22, .65], [0, .22, 0]);
  for (const x of [-.55, .55]) box(palletJack, palette.red, [.18, .12, 1.6], [x, .16, -.8]);
  pipe(palletJack, palette.ink, [0, .35, .25], [0, 1.7, .75], .065);
  pipe(palletJack, palette.ink, [-.35, 1.7, .75], [.35, 1.7, .75], .07);
  cylinder(palletJack, palette.tire, .2, .2, [0, .2, .35]).rotation.z = Math.PI / 2;

  const packing = makeZone('packing', [8.3, 0, .2], [8.5, 3.2, .2], [7.9, 9.6]);
  function table(parent, position, size = [4.9, 1.9], surface = palette.woodLight) {
    const root = group(parent, position);
    box(root, surface, [size[0], .18, size[1]], [0, 1.45, 0]);
    for (const x of [-size[0] / 2 + .2, size[0] / 2 - .2]) {
      for (const z of [-size[1] / 2 + .2, size[1] / 2 - .2]) box(root, palette.steel, [.12, 1.35, .12], [x, .72, z]);
    }
    box(root, palette.steel, [size[0] - .3, .09, .1], [0, .45, 0]);
    return root;
  }
  function coffeeBag(parent, position, surface = palette.cream) {
    const bag = group(parent, position);
    box(bag, surface, [.34, .59, .22], [0, .3, 0]);
    box(bag, surface, [.32, .08, .1], [0, .64, 0]);
    box(bag, palette.red, [.21, .23, .015], [0, .35, .12], false);
    box(bag, palette.white, [.14, .035, .016], [0, .37, .13], false);
    return bag;
  }
  function carton(parent, position, size = [.95, .7, .72], opened = false) {
    const root = group(parent, position);
    box(root, palette.woodLight, size, [0, size[1] / 2, 0]);
    box(root, palette.burlapLight, [.12, size[1] + .015, size[2] + .02], [0, size[1] / 2, 0], false);
    box(root, palette.white, [.27, .18, .015], [.16, size[1] * .6, size[2] / 2 + .015], false);
    if (opened) {
      const flap = box(root, palette.woodLight, [size[0], .035, size[2] / 2], [0, size[1] + .12, size[2] / 2]);
      flap.rotation.x = -.55;
    }
    return root;
  }
  for (const z of [-2.25, 2]) {
    const bench = table(packing, [0, 0, z]);
    box(bench, palette.ink, [1.1, .14, .85], [-1.45, 1.6, 0]);
    box(bench, palette.silver, [.9, .08, .68], [-1.45, 1.7, 0]);
    box(bench, palette.glass, [.38, .13, .07], [-1.45, 1.65, .45], false);
    for (const x of [-.2, .3, .8, 1.3]) coffeeBag(bench, [x, 1.55, 0], z < 0 ? palette.cream : palette.green);
    carton(bench, [1.65, 1.55, -.15], [.75, .6, .65], true);
  }
  const shelf = group(packing, [2.65, 0, -1.9]);
  for (const y of [.4, 1.45, 2.5]) {
    box(shelf, palette.woodLight, [1.5, .1, 4.3], [0, y, 0]);
    for (const z of [-1.4, 0, 1.4]) carton(shelf, [0, y + .06, z], [1.05, .68, .82]);
  }
  for (const x of [-.65, .65]) for (const z of [-2, 2]) box(shelf, palette.steel, [.09, 2.8, .09], [x, 1.4, z]);
  const rollerTable = table(packing, [0, -.35, 4], [4.6, 1.2], palette.steel);
  for (let index = 0; index < 13; index++) {
    const roller = cylinder(rollerTable, palette.silver, .075, 1.05, [-2.1 + index * .35, 1.6, 0]);
    roller.rotation.x = Math.PI / 2;
  }
  carton(rollerTable, [-1.2, 1.68, 0], [.8, .65, .7]);
  carton(rollerTable, [.6, 1.68, 0], [.8, .65, .7]);

  const lab = makeZone('lab', [-10, 0, 5.4], [-10, 3.2, 5.5], [7.6, 6.6]);
  const cuppingTable = table(lab, [0, 0, 0], [5.8, 2.3], palette.white);
  const cupGeometry = geometry(new THREE.CylinderGeometry(.16, .12, .18, 16, 1, true));
  for (let index = 0; index < 6; index++) {
    const x = -1.45 + index % 3 * .85;
    const z = Math.floor(index / 3) * .6 - .3;
    mesh(cupGeometry, palette.white, cuppingTable, [x, 1.65, z]);
    cylinder(cuppingTable, palette.coffee, .145, .018, [x, 1.72, z], false);
    torus(cuppingTable, palette.white, .16, [x, 1.74, z]);
    pipe(cuppingTable, palette.silver, [x + .22, 1.56, z], [x + .22, 1.56, z + .28], .018);
    sphere(cuppingTable, palette.silver, .055, [x + .22, 1.56, z], [1, .2, 1.5]);
  }
  const kettle = group(cuppingTable, [1.7, 1.55, 0]);
  sphere(kettle, palette.copperLight, .3, [0, .24, 0], [1, .9, 1]);
  cylinder(kettle, palette.ink, .17, .07, [0, .52, 0]);
  pipe(kettle, palette.copperLight, [-.2, .25, 0], [-.5, .42, 0], .055);
  pipe(kettle, palette.copperLight, [-.5, .42, 0], [-.6, .56, 0], .045);
  const handle = torus(kettle, palette.ink, .22, [.25, .29, 0], [0, 0, 0]);
  handle.scale.x = .7;
  const grinder = group(lab, [-2.1, 0, -1.9]);
  box(grinder, palette.ink, [.65, 1.6, .65], [0, .85, 0]);
  cylinder(grinder, palette.glass, .3, .65, [0, 1.95, 0]);
  cylinder(grinder, palette.ink, .34, .08, [0, 2.3, 0]);
  box(grinder, palette.silver, [.38, .07, .65], [0, .48, .35]);
  const stool = group(lab, [1.7, 0, 2]);
  cylinder(stool, palette.wood, .35, .14, [0, 1, 0]);
  for (const [x, z] of [[-.23, -.18], [.23, -.18], [0, .25]]) pipe(stool, palette.steel, [x, .94, z], [x * 1.5, .1, z * 1.5], .045);

  const purchases = makeZone('purchases', [6.2, 0, -7.7], [5.8, 3.3, -7.4], [5.1, 3.8]);
  const planningDesk = table(purchases, [0, 0, 0], [3.3, 1.5], palette.woodLight);
  box(planningDesk, palette.steel, [1.15, .76, .1], [-.65, 2.13, -.35]);
  box(planningDesk, palette.window, [1.02, .64, .035], [-.65, 2.13, -.28], false);
  pipe(planningDesk, palette.steel, [-.65, 1.52, -.35], [-.65, 1.85, -.35], .05);
  box(planningDesk, palette.steel, [.6, .04, .35], [-.65, 1.57, -.35]);
  box(planningDesk, palette.cream, [.85, .04, .5], [.65, 1.57, .2]);
  for (const z of [.04, .16, .28]) box(planningDesk, palette.white, [.66, .015, .055], [.65, 1.6, z], false);
  box(purchases, palette.wood, [2.8, 1.5, .12], [0, 3.1, -1.3]);
  box(purchases, palette.burlapLight, [2.62, 1.32, .04], [0, 3.1, -1.22], false);
  for (const [x, y, surface] of [[-.82, 3.35, palette.white], [0, 3.35, palette.sage], [.82, 3.35, palette.white], [-.82, 2.85, palette.white], [0, 2.85, palette.cream]]) {
    box(purchases, surface, [.58, .35, .025], [x, y, -1.18], false);
  }
  const officeChair = group(purchases, [0, 0, 1.1]);
  box(officeChair, palette.green, [.65, .12, .65], [0, 1, 0]);
  box(officeChair, palette.green, [.65, .7, .12], [0, 1.37, .3]);
  cylinder(officeChair, palette.steel, .07, .8, [0, .52, 0]);
  for (const [x, z] of [[-.4, -.3], [.4, -.3], [0, .45]]) pipe(officeChair, palette.steel, [0, .16, 0], [x, .12, z], .04);

  const dispatch = makeZone('dispatch', [11, 0, 8.8], [11.2, 3.5, 8.4], [6.7, 5.1]);
  // The loading frame stays open, with a rolled shutter above the bay.
  for (const x of [-3, 3]) box(dispatch, palette.steel, [.2, 4.6, .3], [x, 2.3, 1.9]);
  box(dispatch, palette.steel, [6.2, .32, .3], [0, 4.52, 1.9]);
  cylinder(dispatch, palette.concrete, .36, 6.1, [0, 4.8, 1.9]).rotation.z = Math.PI / 2;
  for (const x of [-2.95, 2.95]) {
    cylinder(dispatch, palette.red, .11, .9, [x, .45, 2.6]);
    cylinder(dispatch, palette.light, .115, .12, [x, .7, 2.6]);
  }
  const shippingPallet = pallet(dispatch, [-1.8, 0, -.8]);
  for (const [x, y, z] of [[-.55, .43, -.4], [.5, .43, -.4], [-.55, .43, .4], [.5, .43, .4], [0, 1.15, 0]]) {
    carton(shippingPallet, [x, y, z], [.9, .7, .7]);
  }
  const trolley = group(dispatch, [1.2, 0, -.4]);
  box(trolley, palette.steel, [1.1, .13, 1.5], [0, .3, 0]);
  pipe(trolley, palette.steel, [-.5, .3, -.6], [-.5, 1.3, -.6], .045);
  pipe(trolley, palette.steel, [.5, .3, -.6], [.5, 1.3, -.6], .045);
  pipe(trolley, palette.steel, [-.5, 1.3, -.6], [.5, 1.3, -.6], .045);
  for (const x of [-.4, .4]) for (const z of [-.55, .55]) sphere(trolley, palette.tire, .13, [x, .15, z]);
  carton(trolley, [0, .38, 0], [.8, .7, 1]);
  carton(trolley, [0, 1.08, -.15], [.7, .6, .65]);

  box(scene, palette.road, [49, .16, 6.8], [0, -.35, 15.3]);
  box(scene, palette.plaster, [42, .1, .28], [0, -.21, 11.85], false);
  for (let index = -5; index <= 5; index++) box(scene, palette.white, [1.5, .025, .11], [index * 4.7, -.25, 16.5], false);
  for (const x of [-17.2, 17.2]) {
    box(scene, palette.concrete, [1.3, .8, 1.3], [x, .2, 9.7]);
    sphere(scene, palette.green, .82, [x, .9, 9.7], [1, .85, 1]);
    sphere(scene, palette.greenLight, .55, [x + .15, 1.3, 9.55]);
  }

  function createVan() {
    const root = group(scene, [-10, 0, 14]);
    root.userData.zone = 'dispatch';
    box(root, palette.ink, [4.65, .25, 1.8], [0, .63, 0]);
    box(root, palette.white, [3.35, 1.92, 1.95], [-.7, 1.62, 0]);
    const profile = new THREE.Shape();
    profile.moveTo(1, .72); profile.lineTo(2.5, .72); profile.lineTo(2.5, 1.3);
    profile.lineTo(1.95, 2.35); profile.lineTo(1, 2.48); profile.closePath();
    const body = geometry(new THREE.ExtrudeGeometry(profile, { depth: 1.9, bevelEnabled: false }));
    mesh(body, palette.white, root, [0, 0, -.95]);
    for (const z of [-.99, .99]) {
      box(root, palette.glass, [.72, .64, .028], [1.46, 1.96, z]);
      box(root, palette.red, [3.1, .2, .035], [-.65, 1.55, z], false);
      box(root, palette.steel, [.28, .035, .045], [.42, 1.6, z * 1.02]);
      box(root, palette.steel, [.035, 1.55, .03], [.8, 1.6, z * 1.01], false);
      box(root, palette.steel, [.21, .27, .18], [2.03, 1.93, z * 1.1]);
    }
    const windscreen = box(root, palette.glass, [.035, .83, 1.65], [2.2, 1.8, 0]);
    windscreen.rotation.z = .48;
    for (const x of [-1.5, 1.55]) for (const z of [-1, 1]) {
      const wheel = cylinder(root, palette.tire, .43, .24, [x, .48, z]);
      wheel.rotation.x = Math.PI / 2;
      const hub = cylinder(root, palette.silver, .23, .255, [x, .48, z]);
      hub.rotation.x = Math.PI / 2;
      wheels.push(wheel, hub);
    }
    for (const z of [-.7, .7]) {
      box(root, palette.light, [.065, .24, .34], [2.52, 1.02, z]);
      box(root, palette.red, [.04, .42, .18], [-2.4, 1.12, z]);
    }
    box(root, palette.ink, [.12, .16, 1.95], [2.52, .73, 0]);
    box(root, palette.ink, [.12, .16, 1.95], [-2.4, .73, 0]);
    box(root, palette.steel, [.03, 1.6, .035], [-2.39, 1.7, 0]);
    return root;
  }
  const van = createVan();
  let vanTravel = .28;

  const headGeometry = sphereGeometry;
  const capGeometry = geometry(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  function createWorker({ path, zone, shirt = palette.cream, skin = palette.skin, offset = 0, apron = true }) {
    const root = group(scene);
    root.userData.zone = zone;
    const body = group(root);
    const torsoGeometry = geometry(new THREE.CylinderGeometry(.22, .27, .59, 10));
    mesh(torsoGeometry, shirt, body, [0, 1.03, 0]);
    cylinder(body, skin, .09, .12, [0, 1.39, 0]);
    mesh(headGeometry, skin, body, [0, 1.62, .01], [.22, .245, .22]);
    mesh(capGeometry, palette.hair, body, [0, 1.67, 0], [.23, .21, .23]);
    box(body, zone === 'dispatch' ? palette.red : palette.green, [.28, .045, .23], [0, 1.82, .15]);
    for (const x of [-.073, .073]) sphere(body, palette.ink, .019, [x, 1.65, .215]);
    if (apron) {
      box(body, palette.apron, [.38, .48, .035], [0, .98, .235]);
      box(body, palette.woodLight, [.2, .15, .045], [0, .97, .26]);
    }
    const legs = [];
    const arms = [];
    for (const side of [-1, 1]) {
      const leg = group(body, [side * .13, .73, 0]);
      cylinder(leg, palette.navy, .085, .5, [0, -.25, 0]);
      box(leg, palette.ink, [.18, .14, .3], [0, -.59, .065]);
      legs.push(leg);
      const arm = group(body, [side * .29, 1.28, 0]);
      arm.rotation.z = side * .12;
      cylinder(arm, shirt, .08, .28, [0, -.14, 0]);
      cylinder(arm, skin, .065, .28, [0, -.39, .015]);
      sphere(arm, skin, .075, [0, -.54, .02]);
      arms.push(arm);
    }
    const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const worker = { root, body, legs, arms, curve, zone, progress: offset, length: curve.getLength(), phase: offset * Math.PI * 10 };
    workers.push(worker);
    moveWorker(worker, 0);
    return worker;
  }
  function moveWorker(worker, delta) {
    const intensity = activities[worker.zone] || 0;
    worker.progress = (worker.progress + delta * intensity * 1.15 / worker.length) % 1;
    const point = worker.curve.getPointAt(worker.progress);
    const direction = worker.curve.getTangentAt(worker.progress);
    worker.root.position.copy(point);
    worker.root.rotation.y = Math.atan2(direction.x, direction.z);
    const stride = Math.sin(elapsed * 6 * intensity + worker.phase) * Math.min(1, intensity * 2);
    worker.legs[0].rotation.x = stride * .57;
    worker.legs[1].rotation.x = -stride * .57;
    worker.arms[0].rotation.x = -stride * .45;
    worker.arms[1].rotation.x = stride * .45;
    worker.body.position.y = Math.abs(stride) * .035;
  }
  createWorker({ zone: 'roasting', offset: .18, shirt: palette.cream,
    path: [[2.8, 2.5], [3.8, .8], [3.3, -2.5], [2.3, -4.7], [3.2, -1.3]] });
  createWorker({ zone: 'green', offset: .54, shirt: palette.navy, skin: palette.skinDark,
    path: [[-5.8, -5.8], [-5.2, -2.4], [-8, -1.7], [-7.1, -3.5]] });
  createWorker({ zone: 'packing', offset: .1, shirt: palette.red, skin: palette.skinLight,
    path: [[6.2, .1], [8.8, .1], [10.4, 1.2], [7, 1.1]] });
  createWorker({ zone: 'packing', offset: .69, shirt: palette.greenLight,
    path: [[5.4, 3.1], [7.5, 3.1], [9.9, 3.3], [7.7, 4.1], [5.7, 4.1]] });
  createWorker({ zone: 'lab', offset: .13, shirt: palette.white, skin: palette.skinDark,
    path: [[-11.5, 7.1], [-9.3, 7.3], [-7.6, 6.6], [-9.5, 6.5]] });
  createWorker({ zone: 'dispatch', offset: .47, shirt: palette.navy, skin: palette.skinLight,
    path: [[9.6, 7], [12.5, 7], [13, 9.5], [11.8, 11.5], [10.7, 9.8]] });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  function hitZone(event) {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(scene.children, true);
    for (const hit of intersections) {
      let object = hit.object;
      while (object && !object.userData.zone) object = object.parent;
      if (object?.userData.zone) return object.userData.zone;
      // A wall or foreground object blocks picking objects behind it.
      if (!hit.object.isLine && !hit.object.material?.transparent) return null;
    }
    return null;
  }
  function highlight(id) {
    for (const [key, zone] of zones) {
      zone.tint.opacity = key === id ? .19 : .075;
      zone.outlineMaterial.opacity = key === id ? .75 : .2;
      zone.outlineMaterial.color.setHex(key === id ? 0xaa6b43 : 0x617c67);
    }
    requestFrame();
  }
  function onPointerDown(event) {
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    canvas.style.cursor = 'grabbing';
  }
  function onPointerUp(event) {
    canvas.style.cursor = 'grab';
    if (!pointerStart || event.pointerId !== pointerStart.id) return;
    const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = undefined;
    if (moved > 7) return;
    const id = hitZone(event);
    if (id) { highlight(id); onSelect?.(id); }
  }
  function onPointerMove(event) {
    if (pointerStart || performance.now() - hoverAt < 65) return;
    hoverAt = performance.now();
    canvas.style.cursor = hitZone(event) ? 'pointer' : 'grab';
  }
  function onPointerCancel() { pointerStart = undefined; canvas.style.cursor = 'grab'; }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointercancel', onPointerCancel);

  function overviewPosition() {
    const right = new THREE.Vector3().crossVectors(camera.up, overviewDirection).normalize();
    const up = new THREE.Vector3().crossVectors(overviewDirection, right).normalize();
    const tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tangentX = tangentY * camera.aspect;
    let distance = 0;
    for (const x of [floorBounds.min.x, floorBounds.max.x]) {
      for (const y of [floorBounds.min.y, floorBounds.max.y]) {
        for (const z of [floorBounds.min.z, floorBounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(overviewTarget);
          const depth = corner.dot(overviewDirection);
          distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tangentX,
            depth + Math.abs(corner.dot(up)) / tangentY);
        }
      }
    }
    return overviewTarget.clone().addScaledVector(overviewDirection, distance * 1.06);
  }
  function focus(id = 'overview') {
    if (disposed || contextLost) return;
    selectedZone = zoneIds.includes(id) ? id : 'overview';
    const target = selectedZone === 'overview' ? overviewTarget.clone()
      : zones.get(selectedZone).root.position.clone().add(new THREE.Vector3(0, 1.2, .5));
    const position = selectedZone === 'overview' ? overviewPosition()
      : target.clone().addScaledVector(overviewDirection, Math.max(17, 15 / camera.aspect));
    highlight(selectedZone);
    if (reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      cameraTween = undefined;
      controls.update();
    } else {
      cameraTween = { from: camera.position.clone(), to: position, targetFrom: controls.target.clone(), targetTo: target, start: performance.now() };
    }
    requestFrame();
  }
  function resize() {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 600 ? 1.5 : 1.8));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (selectedZone === 'overview') {
      cameraTween = undefined;
      camera.position.copy(overviewPosition());
      controls.target.copy(overviewTarget);
    }
    controls.update();
    requestFrame();
  }
  function projectPins() {
    if (disposed || contextLost) return [];
    camera.updateMatrixWorld();
    return [...pins].map(([id, position]) => {
      projected.copy(position).project(camera);
      const x = (projected.x + 1) / 2 * width;
      const y = (1 - projected.y) / 2 * height;
      return { id, x, y, visible: projected.z > -1 && projected.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height };
    });
  }

  function knownIntensity(value, scale) {
    return Number.isFinite(value) && value >= 0 ? Math.min(.95, Math.sqrt(value / scale) * .65) : 0;
  }
  function setData(data = {}) {
    if (disposed) return;
    dataReceived = true;
    const weekly = data.weekly?.metrics || {};
    activities.roasting = knownIntensity(weekly.production?.roastedKg, 600);
    activities.packing = knownIntensity(data.packing?.packedKg, 500);
    activities.green = knownIntensity(weekly.green?.kg, 12000);
    activities.dispatch = knownIntensity(weekly.wholesale?.done, 80);
    activities.lab = knownIntensity(data.lab?.consumption?.averageKg, 4000);
    activities.purchases = 0;
    for (const worker of workers) moveWorker(worker, 0);
    requestFrame();
  }
  function setPaused(value) {
    paused = Boolean(value);
    lastTime = 0;
    requestFrame();
  }
  function setReducedMotion(value) {
    reducedMotion = Boolean(value);
    controls.enableDamping = !reducedMotion;
    if (reducedMotion && cameraTween) {
      camera.position.copy(cameraTween.to);
      controls.target.copy(cameraTween.targetTo);
      cameraTween = undefined;
      controls.update();
    }
    lastTime = 0;
    requestFrame();
  }
  function isVisible() { return !document.hidden && inViewport && !contextLost && !disposed; }
  function requestFrame() {
    if (frameId === undefined && isVisible()) frameId = requestAnimationFrame(render);
  }
  function stopFrame() {
    if (frameId !== undefined) cancelAnimationFrame(frameId);
    frameId = undefined;
    lastTime = 0;
  }
  function render(time) {
    frameId = undefined;
    if (!isVisible()) { lastTime = 0; return; }
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0;
    lastTime = time;
    const animate = !paused && !reducedMotion;
    if (animate) {
      elapsed += delta;
      for (const worker of workers) moveWorker(worker, delta);
      coolingArms.rotation.y += delta * activities.roasting * .8;
      const driving = activities.dispatch;
      vanTravel = (vanTravel + delta * driving / 34) % 1;
      // The illustrative van stops outside the loading bay before continuing.
      let travel;
      if (vanTravel < .55) travel = vanTravel / .55 * .7;
      else if (vanTravel < .76) travel = .7;
      else travel = .7 + (vanTravel - .76) / .24 * .3;
      van.position.x = -24 + travel * 48;
      van.position.z = 14.05;
      if (vanTravel < .55 || vanTravel > .76) {
        for (const wheel of wheels) wheel.rotateY(-delta * driving * 3.3);
      }
    }
    if (cameraTween) {
      const progress = Math.min((time - cameraTween.start) / 800, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(cameraTween.from, cameraTween.to, eased);
      controls.target.lerpVectors(cameraTween.targetFrom, cameraTween.targetTo, eased);
      if (progress === 1) cameraTween = undefined;
    }
    controls.update();
    try {
      renderer.render(scene, camera);
    } catch (error) {
      contextLost = true;
      stopFrame();
      onError?.(error);
      return;
    }
    if (!ready) { ready = true; queueMicrotask(() => { if (!disposed) onReady?.(); }); }
    if (cameraTween || animate && (!dataReceived || Object.values(activities).some(value => value > 0))) requestFrame();
  }
  function onVisibilityChange() { if (isVisible()) requestFrame(); else stopFrame(); }
  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stopFrame();
    onError?.(new Error('The 3D view lost its graphics connection. Reload the page to reopen it.'));
  }
  function onContextRestored() {
    if (disposed) return;
    contextLost = false;
    ready = false;
    requestFrame();
  }
  function onControlStart() { cameraTween = undefined; }
  controls.addEventListener('change', requestFrame);
  controls.addEventListener('start', onControlStart);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  document.addEventListener('visibilitychange', onVisibilityChange);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);
  if (!resizeObserver) window.addEventListener('resize', resize);
  const intersectionObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    inViewport = entries[0]?.isIntersecting !== false;
    onVisibilityChange();
  }, { rootMargin: '80px' }) : null;
  intersectionObserver?.observe(container);

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopFrame();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    controls.removeEventListener('change', requestFrame);
    controls.removeEventListener('start', onControlStart);
    controls.dispose();
    for (const shape of geometries) shape.dispose();
    for (const surface of materials) surface.dispose();
    sunlight.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    scene.clear();
  }

  resize();
  camera.lookAt(controls.target);
  requestFrame();
  return { setData, focus, setPaused, setReducedMotion, resize, dispose, projectPins };
}
