import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RubiksCube, randomScramble, invertMove, FACE_COLORS } from './cube.js';
import { validateFacelets, COLOR_NAMES, FACE_ORDER } from './validate.js';
import { solve } from './solver.js';
import { TurnArrow } from './arrow.js';
import { explainSolution, STAGES } from './learn/explain.js';

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

const arrow = new TurnArrow();
scene.add(arrow.group);

// 'play' turns layers; 'paint' colors stickers to match the user's cube;
// 'guide' walks through a solution one move at a time.
let mode = 'play';
let selectedColor = 'U';
let savedFacelets = null;
let notice = '';
let highlighted = [];

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

// ---- Panels and status ----

const hintEl = document.getElementById('hint');
const playPanel = document.getElementById('play-panel');
const paintPanel = document.getElementById('paint-panel');
const guidePanel = document.getElementById('guide-panel');
const statusEl = document.getElementById('status');
const paletteEl = document.getElementById('palette');

const HINTS = {
  play: 'Drag a face to turn it. Drag the background to look around.',
  guide: 'Hold your cube with white on top and green facing you. Do each move on your cube, then tap Next.',
  paint: 'Hold your cube with the white center on top and green facing you. Pick a color, then tap stickers to match. Drag to look around.',
};

function renderStatus() {
  statusEl.classList.remove('error', 'success');
  if (mode !== 'play') {
    statusEl.textContent = mode === 'paint' ? notice : '';
    return;
  }
  if (notice && !cube.history.length) {
    statusEl.textContent = notice;
    statusEl.classList.add('success');
  } else if (cube.history.length && !cube.isBusy && cube.isSolved()) {
    statusEl.textContent = 'Solved!';
    statusEl.classList.add('success');
  } else if (cube.history.length) {
    statusEl.textContent = `Moves: ${cube.history.slice(-24).join(' ')}`;
  } else {
    statusEl.textContent = 'Turn the cube, scramble it, or enter your own cube.';
  }
}

function showError(message) {
  notice = message;
  renderStatus();
  statusEl.classList.add('error');
}

function setMode(next) {
  mode = next;
  hintEl.textContent = HINTS[mode];
  playPanel.hidden = mode !== 'play';
  paintPanel.hidden = mode !== 'paint';
  guidePanel.hidden = mode !== 'guide';
  if (mode !== 'guide') arrow.show(null);
  setHighlight([]);
  renderStatus();
}

cube.onChange = renderStatus;

// ---- Play mode ----

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
  notice = '';
  cube.play(randomScramble(), { duration: 110 });
});
const solveButton = document.getElementById('solve');

solveButton.addEventListener('click', async () => {
  if (cube.isBusy) return;
  const state = cube.getStateString();
  const check = validateFacelets([...state]);
  if (!check.ok) {
    showError(check.message);
    return;
  }
  solveButton.disabled = true;
  notice = '';
  statusEl.classList.remove('error', 'success');
  statusEl.textContent = 'Finding the shortest solution...';
  try {
    const moves = await solve(state);
    if (moves.length) {
      startGuide(moves, state);
    } else {
      notice = 'Already solved!';
      cube.history = [];
      renderStatus();
    }
  } catch (err) {
    showError(`The solver couldn't solve this cube (${err.message}).`);
  } finally {
    solveButton.disabled = false;
  }
});

document.getElementById('undo').addEventListener('click', () => cube.undo());
document.getElementById('reset').addEventListener('click', () => {
  notice = '';
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

function colorCounts() {
  const counts = Object.fromEntries(FACE_ORDER.map((c) => [c, 0]));
  for (const c of cube.getFacelets()) if (c) counts[c]++;
  return counts;
}

function updatePalette() {
  const counts = colorCounts();
  for (const [c, button] of Object.entries(swatches)) {
    button.querySelector('.count').textContent = `${counts[c]}/9`;
    button.classList.toggle('full', counts[c] >= 9);
    button.classList.toggle('over', counts[c] > 9);
  }
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
    notice = 'Centers stay put on a real cube, so they set the color of each face.';
    renderStatus();
    return;
  }
  cube.setStickerColor(sticker, selectedColor);
  setHighlight([]);
  notice = '';
  renderStatus();
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

document.getElementById('enter').addEventListener('click', () => {
  if (cube.isBusy) return;
  savedFacelets = cube.getFacelets();
  cube.reset();
  blankAll();
  notice = '';
  setMode('paint');
  selectColor('U');
  updatePalette();
});

document.getElementById('check').addEventListener('click', () => {
  const result = validateFacelets(cube.getFacelets());
  if (!result.ok) {
    const stickers = cube.getFaceletStickers();
    setHighlight(result.stickers.map((i) => stickers[i]));
    showError(result.message);
    return;
  }
  cube.history = [];
  notice = 'Your cube is in! Tap Solve to find the shortest solution.';
  setMode('play');
});

document.getElementById('clear').addEventListener('click', () => {
  blankAll();
  setHighlight([]);
  notice = '';
  selectColor('U');
  updatePalette();
  renderStatus();
});

document.getElementById('cancel').addEventListener('click', () => {
  cube.reset();
  if (savedFacelets) cube.setFacelets(savedFacelets);
  cube.history = [];
  notice = '';
  setMode('play');
});

// ---- Guide mode ----

const FACE_NAMES = { U: 'top', D: 'bottom', L: 'left', R: 'right', F: 'front', B: 'back' };
const GUIDE_TURN_MS = 450;

const guide = { moves: [], explanations: [], step: 0, aboutOpen: false };
const stepCountEl = document.getElementById('step-count');
const stepMoveEl = document.getElementById('step-move');
const stepTextEl = document.getElementById('step-text');
const stripEl = document.getElementById('move-strip');
const nextButton = document.getElementById('next');
const backButton = document.getElementById('back');
const showButton = document.getElementById('show');
const stepStageEl = document.getElementById('step-stage');
const stepTipEl = document.getElementById('step-tip');
const stepWhyEl = document.getElementById('step-why');
const stageIntroEl = document.getElementById('stage-intro');
const aboutButton = document.getElementById('about-stage');
const metersEl = document.getElementById('meters');

const METERS = {
  1: [
    ['cornersAligned', 8, 'Corners pointing right'],
    ['edgesAligned', 12, 'Edges pointing right'],
    ['middleEdgesInMiddle', 4, 'Middle edges in place'],
  ],
  2: [['piecesHome', 20, 'Pieces home']],
};

function describeMove(move) {
  const face = FACE_NAMES[move[0]];
  if (move.endsWith('2')) return `Turn the ${face} face twice (a half turn)`;
  return `Turn the ${face} face ${move.endsWith("'") ? 'counterclockwise' : 'clockwise'}`;
}

function startGuide(moves, state) {
  guide.moves = moves;
  guide.explanations = explainSolution(state, moves);
  guide.step = 0;
  guide.aboutOpen = false;
  cube.history = [];
  stripEl.replaceChildren(
    ...moves.map((move, i) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = move;
      button.setAttribute('aria-label', `Go to move ${i + 1}: ${describeMove(move)}`);
      button.addEventListener('click', () => goToStep(i));
      li.appendChild(button);
      const stage = guide.explanations[i].stage;
      li.classList.add(`stage-${stage}`);
      if (i > 0 && stage !== guide.explanations[i - 1].stage) li.classList.add('stage-start');
      return li;
    }),
  );
  setMode('guide');
  renderGuide();
}

function renderGuide() {
  const { moves, step } = guide;
  const done = step >= moves.length;
  stepCountEl.textContent = done ? `All ${moves.length} moves done` : `Move ${step + 1} of ${moves.length}`;
  stepMoveEl.textContent = done ? 'Solved!' : moves[step];
  stepTextEl.textContent = done
    ? 'Your cube is solved. Nice work!'
    : `${describeMove(moves[step])}.`;
  const explanation = guide.explanations[step];
  const stage = done ? 2 : explanation.stage;
  const firstOfStage = !done && (step === 0 || guide.explanations[step - 1].stage !== stage);
  if (firstOfStage) guide.aboutOpen = false;
  stepStageEl.textContent = done ? 'Solved' : `Stage ${stage} of 2 · ${STAGES[stage].title}`;
  stepTipEl.hidden = step !== 0;
  stepWhyEl.textContent = done ? '' : explanation.why;
  stageIntroEl.textContent = STAGES[stage].intro;
  stageIntroEl.hidden = done || !(firstOfStage || guide.aboutOpen);
  aboutButton.hidden = done || !stageIntroEl.hidden;
  renderMeters(stage, done ? guide.explanations.at(-1).progress : explanation.before);
  nextButton.textContent = done ? 'Finish' : 'Next';
  backButton.disabled = step === 0;
  showButton.disabled = done;
  [...stripEl.children].forEach((li, i) => {
    li.classList.toggle('done', i < step);
    li.classList.toggle('current', i === step);
  });
  stripEl.children[Math.min(step, moves.length - 1)]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  // Show the arrow for the upcoming move once the cube has stopped turning.
  arrow.show(null);
  cube.whenIdle().then(() => {
    if (mode === 'guide' && guide.step === step && !done) arrow.show(moves[step]);
  });
}

function renderMeters(stage, progress) {
  metersEl.replaceChildren(
    ...METERS[stage].map(([key, total, label]) => {
      const meter = document.createElement('div');
      meter.className = 'meter';
      meter.innerHTML = '<span class="meter-label"></span><span class="meter-bar"><span></span></span>';
      meter.querySelector('.meter-label').textContent = `${label} ${progress[key]}/${total}`;
      meter.querySelector('.meter-bar span').style.width = `${(progress[key] / total) * 100}%`;
      meter.classList.toggle('full', progress[key] === total);
      return meter;
    }),
  );
}

aboutButton.addEventListener('click', () => {
  guide.aboutOpen = true;
  renderGuide();
});

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
  arrow.show(null);
  cube.play(move, { record: false, duration: 600 });
  cube.play(invertMove(move), { record: false, duration: 600 });
  renderGuide();
}

function exitGuide() {
  notice = guide.step >= guide.moves.length ? 'Solved! Scramble it again or enter another cube.' : '';
  cube.history = [];
  setMode('play');
}

nextButton.addEventListener('click', nextStep);
backButton.addEventListener('click', previousStep);
showButton.addEventListener('click', showStep);
document.getElementById('exit').addEventListener('click', exitGuide);

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

renderer.setAnimationLoop((now) => {
  cube.update(now);
  arrow.update(now);
  // Gently pulse any stickers flagged by the cube check.
  const pulse = 0.25 + 0.25 * Math.sin(now / 160);
  for (const s of highlighted) s.material.emissiveIntensity = pulse;
  controls.update();
  renderer.render(scene, camera);
});

// Handy for debugging from the browser console.
Object.assign(window, { cube, camera });
