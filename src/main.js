import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RubiksCube, randomScramble } from './cube.js';

const stage = document.getElementById('stage');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 8, 6);
scene.add(keyLight, new THREE.AmbientLight(0xffffff, 0.35));

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(5.2, 4.2, 6.4);

const cube = new RubiksCube();
scene.add(cube.group);

// Drag-to-turn needs to see the pointer before the orbit controls do, so this
// listener is registered first.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;

function toNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  return pointer;
}

function toScreen(point) {
  const p = point.clone().project(camera);
  return new THREE.Vector2(p.x, p.y);
}

/** Rounds a vector to the nearest axis-aligned unit vector. */
function snapToAxis(v) {
  const abs = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = abs.indexOf(Math.max(...abs));
  const out = new THREE.Vector3();
  out.setComponent(i, Math.sign(v.getComponent(i)));
  return out;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  raycaster.setFromCamera(toNdc(event), camera);
  const hit = raycaster.intersectObjects(cube.group.children, true)[0];
  if (!hit) return;
  const normal = snapToAxis(hit.face.normal.clone().transformDirection(hit.object.matrixWorld));
  drag = {
    pointerId: event.pointerId,
    start: new THREE.Vector2(event.clientX, event.clientY),
    point: hit.point.clone(),
    normal,
    cubie: hit.object.userData.cubie,
  };
  controls.enabled = false;
});

window.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const moved = new THREE.Vector2(event.clientX, event.clientY).sub(drag.start);
  if (moved.length() < 12) return;

  // Screen y grows downward; projected coordinates grow upward.
  const dragDir = new THREE.Vector2(moved.x, -moved.y).normalize();
  const origin = toScreen(drag.point);

  // Pick whichever in-plane direction on the touched face best matches the drag.
  let best = null;
  for (const axis of ['x', 'y', 'z']) {
    const t = new THREE.Vector3().setComponent('xyz'.indexOf(axis), 1);
    if (Math.abs(t.dot(drag.normal)) > 0.5) continue;
    const screen = toScreen(drag.point.clone().add(t)).sub(origin).normalize();
    const score = screen.dot(dragDir);
    if (!best || Math.abs(score) > Math.abs(best.score)) best = { t, score };
  }
  const direction = best.t.multiplyScalar(Math.sign(best.score));

  // Rotating about (normal x direction) moves the touched sticker along the drag.
  const rotationAxis = new THREE.Vector3().crossVectors(drag.normal, direction);
  const axisIndex = [0, 1, 2].find((i) => rotationAxis.getComponent(i) !== 0);
  const axis = 'xyz'[axisIndex];
  const layer = Math.round(drag.cubie.position.getComponent(axisIndex));
  cube.playTurn(axis, layer, Math.sign(rotationAxis.getComponent(axisIndex)));
  drag = null;
});

window.addEventListener('pointerup', () => {
  drag = null;
  controls.enabled = true;
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 16;

// Move buttons: each face clockwise and counterclockwise.
const movesEl = document.getElementById('moves');
for (const face of ['U', 'D', 'L', 'R', 'F', 'B']) {
  for (const move of [face, `${face}'`]) {
    const button = document.createElement('button');
    button.textContent = move;
    button.title = `Turn ${move}`;
    button.addEventListener('click', () => cube.play(move));
    movesEl.appendChild(button);
  }
}

document.getElementById('scramble').addEventListener('click', () => {
  if (cube.isBusy) return;
  cube.play(randomScramble(), { duration: 110 });
});
document.getElementById('undo').addEventListener('click', () => cube.undo());
document.getElementById('reset').addEventListener('click', () => cube.reset());

// Keyboard: a letter turns that face, Shift turns it counterclockwise.
window.addEventListener('keydown', (event) => {
  const face = event.key.toUpperCase();
  if (!'UDLRFBMES'.includes(face) || event.metaKey || event.ctrlKey || event.key.length !== 1) return;
  cube.play(event.shiftKey ? `${face}'` : face);
});

const historyEl = document.getElementById('history');
cube.onChange = () => {
  const recent = cube.history.slice(-24).join(' ');
  historyEl.textContent = cube.history.length ? `Moves: ${recent}` : 'Solved cube. Scramble it or start turning.';
  if (cube.history.length && !cube.isBusy && cube.isSolved()) historyEl.textContent = 'Solved!';
};
cube.onChange();

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // Pull back on narrow screens so the whole cube stays visible.
  camera.zoom = Math.min(1, w / h / 1.05);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

renderer.setAnimationLoop((now) => {
  cube.update(now);
  controls.update();
  renderer.render(scene, camera);
});

// Handy for debugging from the browser console.
Object.assign(window, { cube, camera });
