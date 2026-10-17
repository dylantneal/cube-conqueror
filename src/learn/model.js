// A lightweight cube model for planning the teaching solution. The state is 54
// letters in Kociemba facelet order (faces U R F D L B, each read left to right,
// top to bottom), naming the face whose color each sticker shows.

const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];

// Position on the cube (-1..1 per axis) and outward normal of each facelet.
function faceletGeometry(face, row, col) {
  const r = row - 1;
  const c = col - 1;
  switch (face) {
    case 'U': return { p: [c, 1, r], n: [0, 1, 0] };
    case 'D': return { p: [c, -1, -r], n: [0, -1, 0] };
    case 'F': return { p: [c, -r, 1], n: [0, 0, 1] };
    case 'B': return { p: [-c, -r, -1], n: [0, 0, -1] };
    case 'R': return { p: [1, -r, -c], n: [1, 0, 0] };
    case 'L': return { p: [-1, -r, c], n: [-1, 0, 0] };
  }
}

const GEOMETRY = [];
for (const face of FACES) {
  for (let i = 0; i < 9; i++) GEOMETRY.push(faceletGeometry(face, Math.floor(i / 3), i % 3));
}
const key = (g) => `${g.p}|${g.n}`;
const INDEX_OF = new Map(GEOMETRY.map((g, i) => [key(g), i]));

// Axis index, which layer turns ('all' for whole-cube rotations), and the
// quarter-turn sign of a clockwise turn about the positive axis.
const TURNS = {
  R: [0, 1, -1], L: [0, -1, 1], U: [1, 1, -1], D: [1, -1, 1], F: [2, 1, -1], B: [2, -1, 1],
  x: [0, 'all', -1], y: [1, 'all', -1], z: [2, 'all', -1],
};

/** Rotates vector v a quarter turn about `axis`, `sign` = +1 counterclockwise. */
function quarter(v, axis, sign) {
  const [a, b] = [[1, 2], [2, 0], [0, 1]][axis];
  const out = [...v];
  out[a] = -sign * v[b];
  out[b] = sign * v[a];
  return out;
}

const PERMS = {};
for (const [name, [axis, layer, sign]] of Object.entries(TURNS)) {
  // perm[dest] = source
  const perm = new Array(54);
  GEOMETRY.forEach((g, src) => {
    let dest = src;
    if (layer === 'all' || g.p[axis] === layer) {
      dest = INDEX_OF.get(key({ p: quarter(g.p, axis, sign), n: quarter(g.n, axis, sign) }));
    }
    perm[dest] = src;
  });
  PERMS[name] = perm;
}

export function parse(moves) {
  return (Array.isArray(moves) ? moves : moves.split(/\s+/)).filter(Boolean);
}

export class CubeModel {
  constructor(state = FACES.map((f) => f.repeat(9)).join('')) {
    this.s = [...state];
  }

  clone() {
    return new CubeModel(this.s.join(''));
  }

  move(m) {
    const name = m[0];
    const times = m.endsWith('2') ? 2 : m.endsWith("'") ? 3 : 1;
    const perm = PERMS[name];
    if (!perm) throw new Error(`Unknown move ${m}`);
    for (let t = 0; t < times; t++) {
      const prev = this.s;
      this.s = perm.map((src) => prev[src]);
    }
    return this;
  }

  apply(moves) {
    for (const m of parse(moves)) this.move(m);
    return this;
  }

  /** Color of the center on a face. */
  center(face) {
    return this.s[FACES.indexOf(face) * 9 + 4];
  }

  at(face, n) {
    return this.s[FACES.indexOf(face) * 9 + n - 1];
  }

  isSolved() {
    return FACES.every((f, i) => this.s.slice(i * 9, i * 9 + 9).every((c) => c === this.s[i * 9 + 4]));
  }
}

export const f = (face, n) => FACES.indexOf(face) * 9 + n - 1;
