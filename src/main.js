import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RubiksCube, randomScramble, invertMove, FACE_COLORS } from './cube.js';
import { validateFacelets, COLOR_NAMES, FACE_ORDER } from './validate.js';
import { solve } from './solver.js';
import { TurnArrow } from './arrow.js';
import { explainSolution, locatePiece, STAGES } from './learn/explain.js';

const $ = (id) => document.getElementById(id);

const FACE_NAMES = { U: 'top', D: 'bottom', L: 'left', R: 'right', F: 'front', B: 'back' };
const GUIDE_TURN_MS = 450;

function describeMove(move) {
  const face = FACE_NAMES[move[0]];
  if (move.endsWith('2')) return `Turn the ${face} face twice (a half turn)`;
  return `Turn the ${face} face ${move.endsWith("'") ? 'counterclockwise' : 'clockwise'}`;
}

const stage = $('stage');

// ---- Scene ----

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

// A soft shadow under the cube so it sits in the space instead of floating.
const shadowCanvas = document.createElement('canvas');
shadowCanvas.width = shadowCanvas.height = 128;
const sctx = shadowCanvas.getContext('2d');
const gradient = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
gradient.addColorStop(1, 'rgba(0,0,0,0)');
sctx.fillStyle = gradient;
sctx.fillRect(0, 0, 128, 128);
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(5.5, 5.5),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = -2.3;
scene.add(shadow);

const HOME_VIEW = new THREE.Vector3(5.2, 4.2, 6.4);
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.copy(HOME_VIEW);

const cube = new RubiksCube();
scene.add(cube.group);

const arrow = new TurnArrow();
scene.add(arrow.group);

// 'play' turns layers; 'paint' colors stickers to match the user's cube;
// 'guide' walks through a solution one move at a time.
let mode = 'play';
let selectedColor = 'U';
let savedFacelets = null;
let notice = { text: '', tone: '' };
let highlighted = [];
let cameraTween = null;
let justSolved = false;

// ---- Pointer input ----

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let drag = null;
let tap = null;

function toNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  return pointer;
}

function toScreen(point) {
  const p = point.clone().project(camera);
  return new THREE.Vector2(p.x, p.y);
}

function hitCube(event) {
  raycaster.setFromCamera(toNdc(event), camera);
  return raycaster.intersectObjects(cube.group.children, true)[0];
}

/** Rounds a vector to the nearest axis-aligned unit vector. */
function snapToAxis(v) {
  const abs = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)];
  const i = abs.indexOf(Math.max(...abs));
  const out = new THREE.Vector3();
  out.setComponent(i, Math.sign(v.getComponent(i)));
  return out;
}

// Registered before the orbit controls so a drag on the cube can claim the
// pointer before the controls start orbiting.
renderer.domElement.addEventListener('pointerdown', (event) => {
  cameraTween = null;
  // While guiding, the cube must follow the solution, so drags only look around.
  if (mode === 'guide') return;
  if (mode === 'paint') {
    // In paint mode every drag orbits; a tap without movement paints.
    tap = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    return;
  }
  const hit = hitCube(event);
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

window.addEventListener('pointerup', (event) => {
  drag = null;
  controls.enabled = true;
  if (mode === 'paint' && tap && tap.pointerId === event.pointerId) {
    const isTap = Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 6;
    tap = null;
    if (isTap) paintAt(event);
  }
});

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 16;

/** Glides the camera back to the standard front-right-top view. */
function resetView() {
  cameraTween = { from: camera.position.clone(), start: performance.now(), duration: 700 };
}
$('view-reset').addEventListener('click', resetView);

// ---- Panels and status ----

const hintEl = $('hint');
const statusEl = $('status');
const panels = { play: $('play-panel'), paint: $('paint-panel'), guide: $('guide-panel') };
const flowEl = $('flow');
const stripEl = $('move-strip');

const HINTS = {
  play: 'Drag a face to turn it. Drag the background to look around.',
  paint: 'Tap a sticker to paint it. Drag to look around.',
  guide: 'White on top, green facing you. Follow the arrows.',
};

function setNotice(text, tone = '') {
  notice = { text, tone };
  renderStatus();
}

function renderStatus() {
  statusEl.textContent = notice.text;
  statusEl.className = `status ${notice.tone}`;
}

function renderFlow() {
  const current = mode === 'paint' ? 'enter' : mode === 'guide' ? 'learn' : cube.isSolved() ? null : 'solve';
  const order = ['enter', 'solve', 'learn'];
  const index = order.indexOf(current);
  for (const li of flowEl.children) {
    const i = order.indexOf(li.dataset.flow);
    li.classList.toggle('current', i === index);
    li.classList.toggle('done', index > -1 && i < index);
  }
}

function setMode(next) {
  mode = next;
  hintEl.textContent = HINTS[mode];
  for (const [name, el] of Object.entries(panels)) el.hidden = name !== mode;
  stripEl.hidden = mode !== 'guide';
  if (mode !== 'guide') {
    arrow.show(null);
    cube.spotlight(null);
  }
  setHighlight([]);
  renderPlayPanel();
  renderFlow();
  renderStatus();
}

// ---- Play mode ----

function renderPlayPanel() {
  if (mode !== 'play') return;
  const solved = cube.isSolved();
  const eyebrow = $('play-eyebrow');
  const title = $('play-title');
  const lede = $('play-lede');
  if (!solved) {
    eyebrow.textContent = 'Ready';
    title.textContent = 'Let\'s solve it';
    lede.textContent = 'Tap Solve it to get the shortest solution. You\'ll go through it one move at a time, with an explanation of what each move does.';
  } else if (justSolved) {
    eyebrow.textContent = 'Solved';
    title.textContent = 'Nice work!';
    lede.textContent = 'Your cube is solved. Enter another one, or try a random scramble.';
  } else {
    eyebrow.textContent = 'Welcome';
    title.textContent = 'Solve any Rubik\'s cube';
    lede.textContent = 'Paint your cube\'s colors onto the 3D cube, get the shortest solution, and learn what every move is doing.';
  }
  $('solve').hidden = solved;
  $('enter').classList.toggle('primary', solved);
}

cube.onChange = () => {
  if (mode !== 'play') return;
  if (cube.history.length) {
    // A turn makes earlier messages stale.
    justSolved = false;
    notice = { text: '', tone: '' };
  }
  renderPlayPanel();
  renderFlow();
  renderStatus();
};

const movesEl = $('moves');
for (const face of ['U', 'D', 'L', 'R', 'F', 'B']) {
  for (const move of [face, `${face}'`]) {
    const button = document.createElement('button');
    button.textContent = move;
    button.title = describeMove(move);
    button.addEventListener('click', () => cube.play(move));
    movesEl.appendChild(button);
  }
}

$('scramble').addEventListener('click', () => {
  if (cube.isBusy) return;
  setNotice('');
  cube.play(randomScramble(), { duration: 110 });
});

const solveButton = $('solve');
solveButton.addEventListener('click', async () => {
  if (cube.isBusy) return;
  const state = cube.getStateString();
  const check = validateFacelets([...state]);
  if (!check.ok) {
    setNotice(check.message, 'error');
    return;
  }
  solveButton.disabled = true;
  solveButton.textContent = 'Finding the shortest solution...';
  try {
    const moves = await solve(state);
    if (moves.length) startGuide(moves, state);
  } catch (err) {
    setNotice(`The solver couldn't solve this cube (${err.message}).`, 'error');
  } finally {
    solveButton.disabled = false;
    solveButton.textContent = 'Solve it';
  }
});

$('undo').addEventListener('click', () => cube.undo());
$('reset').addEventListener('click', () => {
  setNotice('');
  cube.reset();
});

// Keyboard: a letter turns that face, Shift turns it counterclockwise.
// While guiding, the arrow keys step through the solution.
window.addEventListener('keydown', (event) => {
  if (mode === 'guide') {
    if (event.key === 'ArrowRight') nextStep();
    else if (event.key === 'ArrowLeft') previousStep();
    else return;
    event.preventDefault();
    return;
  }
  if (mode !== 'play') return;
  const face = event.key.toUpperCase();
  if (!'UDLRFBMES'.includes(face) || event.metaKey || event.ctrlKey || event.key.length !== 1) return;
  cube.play(event.shiftKey ? `${face}'` : face);
});

// ---- Paint mode ----

const paletteEl = $('palette');
const swatches = {};
for (const color of FACE_ORDER) {
  const button = document.createElement('button');
  button.className = 'swatch';
  button.style.setProperty('--swatch', FACE_COLORS[color]);
  button.setAttribute('aria-label', COLOR_NAMES[color]);
  button.innerHTML = '<span class="chip"></span><span class="count"></span>';
  button.addEventListener('click', () => selectColor(color));
  paletteEl.appendChild(button);
  swatches[color] = button;
}

function selectColor(color) {
  selectedColor = color;
  for (const [c, button] of Object.entries(swatches)) button.classList.toggle('selected', c === color);
}

function updatePalette() {
  const counts = Object.fromEntries(FACE_ORDER.map((c) => [c, 0]));
  let painted = 0;
  for (const c of cube.getFacelets()) {
    if (!c) continue;
    counts[c]++;
    painted++;
  }
  for (const [c, button] of Object.entries(swatches)) {
    button.querySelector('.count').textContent = `${counts[c]}/9`;
    button.classList.toggle('full', counts[c] >= 9);
    button.classList.toggle('over', counts[c] > 9);
  }
  // The six centers come pre-painted.
  $('paint-count').textContent = `${painted - 6} of 48 stickers painted`;
  $('paint-bar').style.width = `${((painted - 6) / 48) * 100}%`;
  return counts;
}

function blankAll() {
  for (const sticker of cube.stickers) {
    if (!cube.isCenter(sticker)) cube.setStickerColor(sticker, null);
  }
}

function paintAt(event) {
  const hit = hitCube(event);
  const sticker = hit && cube.stickers.includes(hit.object) ? hit.object : null;
  if (!sticker) return;
  if (cube.isCenter(sticker)) {
    setNotice('Centers never move on a real cube, so they set the color of each face.');
    return;
  }
  cube.setStickerColor(sticker, selectedColor);
  setHighlight([]);
  setNotice('');
  const counts = updatePalette();
  // Once a color has all nine stickers, move on to the next unfinished one.
  if (counts[selectedColor] === 9) {
    const next = FACE_ORDER.find((c) => counts[c] < 9);
    if (next) selectColor(next);
  }
}

function setHighlight(stickers) {
  for (const s of highlighted) s.material.emissiveIntensity = 0;
  highlighted = stickers;
  for (const s of highlighted) s.material.emissive.set(0xffffff);
}

$('enter').addEventListener('click', () => {
  if (cube.isBusy) return;
  savedFacelets = cube.getFacelets();
  cube.reset();
  blankAll();
  notice = { text: '', tone: '' };
  setMode('paint');
  selectColor('U');
  updatePalette();
  resetView();
});

$('check').addEventListener('click', () => {
  const result = validateFacelets(cube.getFacelets());
  if (!result.ok) {
    const stickers = cube.getFaceletStickers();
    setHighlight(result.stickers.map((i) => stickers[i]));
    setNotice(result.message, 'error');
    return;
  }
  cube.history = [];
  justSolved = false;
  notice = { text: '', tone: '' };
  setMode('play');
});

$('clear').addEventListener('click', () => {
  blankAll();
  setHighlight([]);
  setNotice('');
  selectColor('U');
  updatePalette();
});

$('cancel').addEventListener('click', () => {
  cube.reset();
  if (savedFacelets) cube.setFacelets(savedFacelets);
  cube.history = [];
  notice = { text: '', tone: '' };
  setMode('play');
});

// ---- Guide mode ----

const guide = { moves: [], plan: null, step: 0 };
const chipEls = [];

function startGuide(moves, state) {
  guide.moves = moves;
  guide.plan = explainSolution(state, moves);
  guide.step = 0;
  cube.history = [];
  chipEls.length = 0;
  stripEl.replaceChildren(
    ...guide.plan.steps.map((step) => {
      const li = document.createElement('li');
      li.className = `group stage-${step.stage}`;
      for (let i = step.start; i <= step.end; i++) {
        const button = document.createElement('button');
        button.textContent = moves[i];
        button.setAttribute('aria-label', `Go to move ${i + 1}: ${describeMove(moves[i])}`);
        button.addEventListener('click', () => goToStep(i));
        li.appendChild(button);
        chipEls.push(button);
      }
      return li;
    }),
  );
  $('about').open = false;
  setMode('guide');
  resetView();
  renderGuide();
}

function renderStages(index) {
  const { plan, moves } = guide;
  const ranges = { 1: [0, plan.split], 2: [plan.split, moves.length] };
  $('stages').replaceChildren(
    ...[1, 2].map((n) => {
      const [from, to] = ranges[n];
      const done = Math.min(Math.max(index - from, 0), to - from);
      const current = index < moves.length ? plan.moves[index].stage === n : n === 2;
      const seg = document.createElement('div');
      seg.className = `stage-seg${current ? ' current' : ''}`;
      seg.style.setProperty('--seg-color', n === 1 ? 'var(--stage-1)' : 'var(--stage-2)');
      seg.innerHTML = '<span class="seg-label"></span><span class="meter-bar"><span></span></span>';
      seg.querySelector('.seg-label').textContent = `Stage ${n} · ${STAGES[n].title}`;
      const finished = to > from ? done / (to - from) : index >= to ? 1 : 0;
      seg.querySelector('.meter-bar span').style.width = `${finished * 100}%`;
      return seg;
    }),
  );
}

const METERS = {
  1: [
    ['cornersAligned', 8, 'Corners upright'],
    ['edgesAligned', 12, 'Edges flipped right'],
    ['middleEdgesInMiddle', 4, 'Middle edges placed'],
  ],
  2: [['piecesHome', 20, 'Pieces home']],
};

function renderMeters(stageNumber, progress) {
  $('meters').replaceChildren(
    ...METERS[stageNumber].map(([key, total, label]) => {
      const meter = document.createElement('div');
      meter.className = `meter stage-${stageNumber}${progress[key] === total ? ' full' : ''}`;
      meter.innerHTML = '<span class="meter-label"></span><span class="meter-bar"><span></span></span>';
      meter.querySelector('.meter-label').textContent = `${label} ${progress[key]}/${total}`;
      meter.querySelector('.meter-bar span').style.width = `${(progress[key] / total) * 100}%`;
      return meter;
    }),
  );
}

function renderGuide() {
  const { moves, plan, step } = guide;
  const done = step >= moves.length;
  const info = plan.moves[Math.min(step, moves.length - 1)];
  const group = plan.steps[info.step];
  const stageNumber = info.stage;

  renderStages(step);

  if (done) {
    $('step-count').textContent = `All ${moves.length} moves done`;
    $('step-title').textContent = 'Solved!';
    $('step-detail').textContent = 'Every piece is home. Your cube should match the one on screen.';
  } else {
    $('step-count').textContent = `Step ${info.step + 1} of ${plan.steps.length} · Move ${step + 1} of ${moves.length}`;
    $('step-title').textContent = group.title;
    $('step-detail').textContent = group.detail;
  }
  $('glow-note').hidden = done;

  // The moves in this step, with the current one emphasized.
  $('step-moves').replaceChildren(
    ...moves.slice(group.start, group.end + 1).map((m, k) => {
      const span = document.createElement('span');
      const i = group.start + k;
      span.textContent = m;
      span.className = done || i < step ? 'done' : i === step ? 'current' : '';
      return span;
    }),
  );
  if (done) {
    $('step-text').textContent = 'That was the last move.';
    $('move-role').textContent = '';
  } else {
    $('step-text').textContent = describeMove(moves[step]);
    const role = info.role === 'payoff'
      ? 'This move completes the step.'
      : 'Setup move: it gets pieces into position for the end of this step.';
    $('move-role').textContent = step === 0 ? `${role} Clockwise means as you look straight at that face.` : role;
  }

  $('next').textContent = done ? 'Finish' : 'Next move';
  $('back').disabled = step === 0;
  $('show').disabled = done;

  renderMeters(stageNumber, done ? info.after : info.before);
  $('about-summary').textContent = `How does stage ${stageNumber} work?`;
  $('stage-intro').replaceChildren(
    ...STAGES[stageNumber].intro.map((text) => Object.assign(document.createElement('p'), { textContent: text })),
  );

  chipEls.forEach((chip, i) => {
    chip.classList.toggle('done', i < step);
    chip.classList.toggle('current', i === step);
  });
  [...stripEl.children].forEach((li, n) => li.classList.toggle('current', !done && n === info.step));
  chipEls[Math.min(step, moves.length - 1)]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });

  // Arrows and the spotlight appear once the cube has stopped turning.
  arrow.show(null);
  cube.spotlight(null);
  cube.whenIdle().then(() => {
    if (mode !== 'guide' || guide.step !== step || done) return;
    arrow.show(moves[step]);
    const state = cube.getStateString();
    const stickers = cube.getFaceletStickers();
    cube.spotlight(new Set(group.pieces.flatMap((key) => locatePiece(state, key)).map((i) => stickers[i])));
  });
}

function nextStep() {
  if (guide.step >= guide.moves.length) {
    exitGuide();
    return;
  }
  cube.play(guide.moves[guide.step], { duration: GUIDE_TURN_MS });
  guide.step++;
  renderGuide();
}

function previousStep() {
  if (guide.step === 0) return;
  guide.step--;
  cube.play(invertMove(guide.moves[guide.step]), { record: false, duration: GUIDE_TURN_MS });
  renderGuide();
}

function goToStep(target) {
  const fast = Math.abs(target - guide.step) > 1 ? 140 : GUIDE_TURN_MS;
  while (guide.step < target) cube.play(guide.moves[guide.step++], { duration: fast });
  while (guide.step > target) cube.play(invertMove(guide.moves[--guide.step]), { record: false, duration: fast });
  renderGuide();
}

/** Plays the upcoming move and then undoes it, so the user can watch it first. */
function showStep() {
  if (cube.isBusy || guide.step >= guide.moves.length) return;
  const move = guide.moves[guide.step];
  cube.play(move, { record: false, duration: 600 });
  cube.play(invertMove(move), { record: false, duration: 600 });
  renderGuide();
}

function exitGuide() {
  justSolved = guide.step >= guide.moves.length && cube.isSolved();
  cube.history = [];
  notice = { text: '', tone: '' };
  setMode('play');
}

$('next').addEventListener('click', nextStep);
$('back').addEventListener('click', previousStep);
$('show').addEventListener('click', showStep);
$('exit').addEventListener('click', exitGuide);

// ---- Rendering ----

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
setMode('play');

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

renderer.setAnimationLoop((now) => {
  cube.update(now);
  arrow.update(now);
  if (cameraTween) {
    const t = Math.min(1, (now - cameraTween.start) / cameraTween.duration);
    camera.position.lerpVectors(cameraTween.from, HOME_VIEW, easeInOut(t));
    camera.lookAt(0, 0, 0);
    if (t === 1) cameraTween = null;
  }
  // Gently pulse highlighted stickers.
  const pulse = 0.22 + 0.22 * Math.sin(now / 180);
  for (const s of highlighted) s.material.emissiveIntensity = pulse;
  controls.update();
  renderer.render(scene, camera);
});

// Handy for debugging from the browser console.
Object.assign(window, { cube, camera });
