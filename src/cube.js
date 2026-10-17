import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Standard color scheme: white top, green front, red right.
export const FACE_COLORS = {
  U: '#ffffff',
  D: '#ffd500',
  F: '#009b48',
  B: '#0046ad',
  R: '#b71234',
  L: '#ff5800',
};

// Shown on stickers the user hasn't painted yet.
export const BLANK_COLOR = '#3b3f4c';

// Face order used for facelet strings (Kociemba's layout).
const FACELET_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

// Outward normal of each face in cube coordinates.
const FACE_NORMALS = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0),
};

// Each move turns one layer: axis, layer coordinate, and the angle (in quarter
// turns, right-hand rule about the positive axis) of a clockwise turn.
const MOVE_DEFS = {
  R: { axis: 'x', layer: 1, dir: -1 },
  L: { axis: 'x', layer: -1, dir: 1 },
  M: { axis: 'x', layer: 0, dir: 1 },
  U: { axis: 'y', layer: 1, dir: -1 },
  D: { axis: 'y', layer: -1, dir: 1 },
  E: { axis: 'y', layer: 0, dir: 1 },
  F: { axis: 'z', layer: 1, dir: -1 },
  B: { axis: 'z', layer: -1, dir: 1 },
  S: { axis: 'z', layer: 0, dir: -1 },
};

const AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

/** Parses "R", "R'" or "R2" into { face, quarterTurns } (quarterTurns is 1, -1 or 2). */
export function parseMove(move) {
  const match = /^([RLUDFBMES])(2|'|)$/.exec(move.trim());
  if (!match) throw new Error(`Unknown move: ${move}`);
  const [, face, suffix] = match;
  return { face, quarterTurns: suffix === '2' ? 2 : suffix === "'" ? -1 : 1 };
}

export function invertMove(move) {
  const { face, quarterTurns } = parseMove(move);
  if (quarterTurns === 2) return `${face}2`;
  return quarterTurns === 1 ? `${face}'` : face;
}

/** Converts a turn of (axis, layer) by `angleQuarters` about the positive axis to notation. */
function toNotation(axis, layer, angleQuarters) {
  const face = Object.keys(MOVE_DEFS).find(
    (f) => MOVE_DEFS[f].axis === axis && MOVE_DEFS[f].layer === layer,
  );
  const turns = angleQuarters * MOVE_DEFS[face].dir;
  return turns === 1 ? face : `${face}'`;
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function roundedRectShape(size, radius) {
  const h = size / 2;
  const s = new THREE.Shape();
  s.moveTo(-h + radius, -h);
  s.lineTo(h - radius, -h);
  s.quadraticCurveTo(h, -h, h, -h + radius);
  s.lineTo(h, h - radius);
  s.quadraticCurveTo(h, h, h - radius, h);
  s.lineTo(-h + radius, h);
  s.quadraticCurveTo(-h, h, -h, h - radius);
  s.lineTo(-h, -h + radius);
  s.quadraticCurveTo(-h, -h, -h + radius, -h);
  return s;
}

export class RubiksCube {
  constructor() {
    this.group = new THREE.Group();
    this.cubies = [];
    this.stickers = [];
    this.queue = [];
    this.history = [];
    this.current = null;
    this.turnDuration = 260;
    this.onChange = () => {};
    this.idleWaiters = [];
    this.build();
  }

  build() {
    const bodyGeometry = new RoundedBoxGeometry(0.98, 0.98, 0.98, 4, 0.1);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.45, metalness: 0.1 });
    const stickerGeometry = new THREE.ShapeGeometry(roundedRectShape(0.84, 0.12), 6);

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          const cubie = new THREE.Group();
          cubie.position.set(x, y, z);
          const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
          body.userData.cubie = cubie;
          cubie.add(body);

          for (const [face, normal] of Object.entries(FACE_NORMALS)) {
            // Only outward-facing sides get a sticker.
            if (normal.dot(cubie.position) !== 1) continue;
            const sticker = new THREE.Mesh(
              stickerGeometry,
              new THREE.MeshPhysicalMaterial({
                color: FACE_COLORS[face],
                roughness: 0.25,
                clearcoat: 0.6,
                clearcoatRoughness: 0.2,
              }),
            );
            sticker.position.copy(normal).multiplyScalar(0.492);
            sticker.lookAt(normal.clone().multiplyScalar(2));
            sticker.userData = { cubie, color: face };
            cubie.add(sticker);
            this.stickers.push(sticker);
          }

          this.group.add(cubie);
          this.cubies.push(cubie);
        }
      }
    }
  }

  get isBusy() {
    return this.current !== null || this.queue.length > 0;
  }

  /** Queues one or more moves, e.g. "R U R' U'". */
  play(moves, { record = true, duration } = {}) {
    const list = Array.isArray(moves) ? moves : moves.split(/\s+/).filter(Boolean);
    for (const move of list) this.queue.push({ move, record, duration: duration ?? this.turnDuration });
  }

  /** Queues a turn described geometrically (used by drag-to-turn). */
  playTurn(axis, layer, angleQuarters) {
    this.play(toNotation(axis, layer, angleQuarters));
  }

  undo() {
    if (this.isBusy || this.history.length === 0) return;
    const last = this.history.pop();
    this.play(invertMove(last), { record: false });
    this.onChange();
  }

  reset() {
    this.queue = [];
    this.current = null;
    this.group.clear();
    this.cubies = [];
    this.stickers = [];
    this.history = [];
    this.build();
    this.onChange();
  }

  update(now) {
    if (!this.current && this.queue.length) this.startTurn(this.queue.shift(), now);
    const turn = this.current;
    if (!turn) return;

    const t = Math.min(1, (now - turn.start) / turn.duration);
    turn.pivot.quaternion.setFromAxisAngle(turn.axisVector, turn.angle * easeInOutCubic(t));
    if (t === 1) this.finishTurn();
  }

  startTurn({ move, record, duration }, now) {
    const { face, quarterTurns } = parseMove(move);
    const def = MOVE_DEFS[face];
    const pivot = new THREE.Group();
    this.group.add(pivot);
    for (const cubie of this.cubies) {
      if (Math.round(cubie.position[def.axis]) === def.layer) pivot.attach(cubie);
    }
    this.current = {
      move,
      record,
      pivot,
      axisVector: AXES[def.axis],
      angle: (def.dir * quarterTurns * Math.PI) / 2,
      start: now,
      // Half turns get a little extra time so they don't look rushed.
      duration: quarterTurns === 2 ? duration * 1.5 : duration,
    };
  }

  finishTurn() {
    const { pivot, move, record } = this.current;
    for (const cubie of [...pivot.children]) {
      this.group.attach(cubie);
      // Snap to the grid so rounding errors never accumulate.
      cubie.position.set(Math.round(cubie.position.x), Math.round(cubie.position.y), Math.round(cubie.position.z));
      const e = new THREE.Euler().setFromQuaternion(cubie.quaternion);
      const snap = (a) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
      cubie.rotation.set(snap(e.x), snap(e.y), snap(e.z));
    }
    this.group.remove(pivot);
    this.current = null;
    if (record) this.history.push(move);
    if (!this.isBusy) {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
    this.onChange();
  }

  /** Resolves once every queued move has finished. */
  whenIdle() {
    return this.isBusy ? new Promise((resolve) => this.idleWaiters.push(resolve)) : Promise.resolve();
  }

  setStickerColor(sticker, color) {
    sticker.userData.color = color;
    sticker.material.color.set(color ? FACE_COLORS[color] : BLANK_COLOR);
  }

  /** True for the six center stickers, which define each face's color. */
  isCenter(sticker) {
    const p = sticker.userData.cubie.position;
    return Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z) === 1;
  }

  /**
   * Returns all 54 stickers in facelet order: faces U R F D L B, each read left to
   * right, top to bottom as seen looking straight at that face.
   */
  getFaceletStickers() {
    const byFace = Object.fromEntries(FACELET_ORDER.map((f) => [f, []]));
    const worldPos = new THREE.Vector3();
    const worldNormal = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    for (const sticker of this.stickers) {
      sticker.getWorldPosition(worldPos);
      worldNormal.set(0, 0, 1).applyQuaternion(sticker.getWorldQuaternion(worldQuat));
      const face = FACELET_ORDER.find((f) => FACE_NORMALS[f].dot(worldNormal) > 0.9);
      byFace[face].push({ sticker, pos: worldPos.clone() });
    }
    // [row, column] of a sticker position on each face.
    const grid = {
      U: (p) => [p.z, p.x], D: (p) => [-p.z, p.x],
      F: (p) => [-p.y, p.x], B: (p) => [-p.y, -p.x],
      R: (p) => [-p.y, -p.z], L: (p) => [-p.y, p.z],
    };
    return FACELET_ORDER.flatMap((face) =>
      byFace[face]
        .map((s) => ({ ...s, key: grid[face](s.pos).map(Math.round) }))
        .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
        .map((s) => s.sticker),
    );
  }

  /** The color letter (or null if blank) at each of the 54 facelets. */
  getFacelets() {
    return this.getFaceletStickers().map((s) => s.userData.color);
  }

  /**
   * Facelets named by where each color's center currently sits, so the result
   * describes the cube correctly even after middle-layer turns move the centers.
   */
  getStateString() {
    const colors = this.getFacelets();
    const faceOf = {};
    FACELET_ORDER.forEach((face, i) => (faceOf[colors[i * 9 + 4]] = face));
    return colors.map((c) => faceOf[c] ?? '?').join('');
  }

  setFacelets(colors) {
    this.getFaceletStickers().forEach((s, i) => this.setStickerColor(s, colors[i]));
  }

  isSolved() {
    const colors = this.getFacelets();
    return FACELET_ORDER.every((_, face) => colors.slice(face * 9, face * 9 + 9).every((c) => c && c === colors[face * 9]));
  }
}

/** A random-move scramble that never turns the same face twice in a row. */
export function randomScramble(length = 20) {
  const faces = ['R', 'L', 'U', 'D', 'F', 'B'];
  const suffixes = ['', "'", '2'];
  const moves = [];
  let last = '';
  while (moves.length < length) {
    const face = faces[Math.floor(Math.random() * faces.length)];
    if (face === last) continue;
    last = face;
    moves.push(face + suffixes[Math.floor(Math.random() * 3)]);
  }
  return moves;
}
