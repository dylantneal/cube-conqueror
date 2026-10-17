// Explains a two-phase solution in plain language. The solver works in two
// stages: first it gets every piece pointing the right way (and the four
// middle-layer edges into the middle layer), then it moves pieces home using only
// turns that can't undo that. We replay the solution, track every piece, and
// group the moves into steps that each end with a move that visibly fixes
// something.

import { CubeModel } from './model.js';
import { CORNER_FACELETS, EDGE_FACELETS } from '../validate.js';

const FACES = 'URFDLB';
const slotFaces = (slot) => slot.map((i) => FACES[Math.floor(i / 9)]);
const isUD = (c) => c === 'U' || c === 'D';
const isFB = (c) => c === 'F' || c === 'B';

const SLOTS = [
  ...CORNER_FACELETS.map((facelets) => ({ type: 'corner', facelets, middleSlot: false })),
  ...EDGE_FACELETS.map((facelets, n) => ({ type: 'edge', facelets, middleSlot: n >= 8 })),
];

/** A piece is named by its colors, e.g. "DFR" for the yellow-green-red corner. */
export const pieceKey = (colors) => [...colors].sort().join('');

/** Status of every piece in a state, keyed by piece. */
function pieces(model) {
  const s = model.s;
  const out = new Map();
  for (const slot of SLOTS) {
    const colors = slot.facelets.map((i) => s[i]);
    const home = colors.every((c, k) => c === slotFaces(slot.facelets)[k]);
    let aligned;
    let isMiddlePiece = false;
    if (slot.type === 'corner') {
      aligned = isUD(colors[0]);
    } else {
      const [a, b] = colors;
      // An edge points the right way when its white/yellow color (or, for the
      // four middle edges, its green/blue color) is on the slot's reference side.
      const primary = isUD(a) || isUD(b) ? (isUD(a) ? a : b) : isFB(a) ? a : b;
      aligned = a === primary;
      isMiddlePiece = !isUD(a) && !isUD(b);
    }
    out.set(pieceKey(colors), {
      type: slot.type,
      aligned,
      isMiddlePiece,
      inMiddle: isMiddlePiece && slot.middleSlot,
      home,
    });
  }
  return out;
}

/** Progress measures for a cube state. */
export function measure(model) {
  let cornersAligned = 0;
  let edgesAligned = 0;
  let middleEdgesInMiddle = 0;
  let piecesHome = 0;
  for (const p of pieces(model).values()) {
    if (p.aligned) p.type === 'corner' ? cornersAligned++ : edgesAligned++;
    if (p.inMiddle) middleEdgesInMiddle++;
    if (p.home) piecesHome++;
  }
  return { cornersAligned, edgesAligned, middleEdgesInMiddle, piecesHome };
}

const isStageTwoMove = (m) => m[0] === 'U' || m[0] === 'D' || m.endsWith('2');
const inStageTwoGroup = (p) => p.cornersAligned === 8 && p.edgesAligned === 12 && p.middleEdgesInMiddle === 4;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const listing = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

/** What a single move fixes (and breaks), piece by piece. */
function gains(before, after, stage) {
  const fixed = { corners: [], edges: [], middles: [], home: [] };
  let broken = 0;
  for (const [key, a] of after) {
    const b = before.get(key);
    if (stage === 1) {
      if (a.aligned && !b.aligned) (a.type === 'corner' ? fixed.corners : fixed.edges).push(key);
      if (a.inMiddle && !b.inMiddle) fixed.middles.push(key);
      if ((b.aligned && !a.aligned) || (b.inMiddle && !a.inMiddle)) broken++;
    } else {
      if (a.home && !b.home) fixed.home.push(key);
      if (b.home && !a.home) broken++;
    }
  }
  const pieceSet = [...new Set([...fixed.corners, ...fixed.edges, ...fixed.middles, ...fixed.home])];
  return { fixed, broken, pieces: pieceSet };
}

function stageOneGoal(fixed, finishes) {
  const parts = [];
  if (fixed.corners.length) parts.push(`twist ${plural(fixed.corners.length, 'corner')} upright`);
  if (fixed.edges.length) parts.push(`flip ${plural(fixed.edges.length, 'edge')}`);
  if (fixed.middles.length) parts.push(`move ${plural(fixed.middles.length, 'middle edge')} into the middle layer`);
  const text = listing(parts);
  if (finishes) return { title: 'Finish stage 1', action: text || 'finish stage 1' };
  return { title: text[0].toUpperCase() + text.slice(1), action: text };
}

/**
 * Splits a solution into steps. Returns:
 * {
 *   split: index of the first stage-2 move,
 *   moves: [{ move, stage, step, role: 'setup' | 'payoff', before, after }],
 *   steps: [{ stage, start, end, title, detail, pieces }],
 * }
 * `before` and `after` are measure() results. `pieces` lists the piece keys the
 * step fixes, to highlight on the cube.
 */
export function explainSolution(state, moves) {
  const model = new CubeModel(state);
  const pieceStates = [pieces(model)];
  const measures = [measure(model)];
  for (const m of moves) {
    model.move(m);
    pieceStates.push(pieces(model));
    measures.push(measure(model));
  }

  // Stage 2 starts once the cube is in the restricted group and only stage-2
  // moves remain.
  let split = moves.length;
  while (split > 0 && isStageTwoMove(moves[split - 1]) && inStageTwoGroup(measures[split - 1])) split--;

  const steps = [];
  const out = [];
  let start = 0;
  moves.forEach((move, i) => {
    const stage = i < split ? 1 : 2;
    const g = gains(pieceStates[i], pieceStates[i + 1], stage);
    const lastOfStage = i === moves.length - 1 || i === split - 1;
    const payoff = g.pieces.length > 0 || lastOfStage;
    out.push({ move, stage, step: steps.length, role: payoff ? 'payoff' : 'setup', before: measures[i], after: measures[i + 1] });
    if (!payoff) return;

    const count = i - start + 1;
    const setupNote = count === 2
      ? 'The first move lines things up so the second one can do it. '
      : count > 2
        ? `The first ${count - 1} moves line things up so the last one can do it. `
        : '';
    let title;
    let detail;
    if (stage === 1) {
      const goal = stageOneGoal(g.fixed, i === split - 1);
      title = goal.title;
      detail = i === split - 1
        ? `${setupNote}This step will ${goal.action}. After it, every piece points the right way, and the solver can start bringing pieces home.`
        : `${setupNote}This step will ${goal.action}.`;
    } else if (i === moves.length - 1) {
      title = 'Solve the cube';
      detail = `${setupNote}The last move puts the final ${plural(g.pieces.length, 'piece')} home.`;
    } else {
      title = `Bring ${plural(g.pieces.length, 'piece')} home`;
      detail = `${setupNote}This step brings ${plural(g.pieces.length, 'piece')} to ${g.pieces.length === 1 ? 'its home spot' : 'their home spots'}.`;
    }
    // Count pieces knocked out of place across the whole step.
    let broken = 0;
    for (let k = start; k <= i; k++) broken += gains(pieceStates[k], pieceStates[k + 1], stage).broken;
    if (broken > 0) detail += ' A few other pieces get knocked out of place along the way. Later steps put them back.';

    steps.push({ stage, start, end: i, title, detail, pieces: g.pieces });
    start = i + 1;
  });

  return { split, moves: out, steps };
}

/** Facelet indices where a piece currently sits in a 54-letter state. */
export function locatePiece(state, key) {
  for (const slot of SLOTS) {
    if (pieceKey(slot.facelets.map((i) => state[i])) === key) return slot.facelets;
  }
  return [];
}

export const STAGES = {
  1: {
    title: 'Point every piece the right way',
    intro: [
      'The solver doesn\'t try to put pieces where they belong yet. First it makes sure every piece points the right way.',
      'Corners: the white or yellow sticker must face up or down.',
      'Edges: they must not be flipped backwards. Only quarter turns of the front or back face can flip an edge, so you\'ll see those here.',
      'The four edges with no white or yellow must sit in the middle layer.',
    ],
  },
  2: {
    title: 'Bring every piece home',
    intro: [
      'Every piece now points the right way. From here on the solver only turns the top and bottom, or gives a side a half turn.',
      'Those moves can never flip a piece back out of line, so every piece stays pointed the right way while it travels to its home spot.',
    ],
  },
};
