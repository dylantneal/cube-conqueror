// Explains a two-phase solution in plain language. The solver works in two
// stages: first it gets every piece pointing the right way (and the four
// middle-layer edges into the middle layer), then it moves pieces home using only
// turns that can't undo that. For each move we measure what changed and say so.

import { CubeModel } from './model.js';
import { CORNER_FACELETS, EDGE_FACELETS } from '../validate.js';

const SLOT_FACES = (slot) => slot.map((i) => 'URFDLB'[Math.floor(i / 9)]);
const isUD = (c) => c === 'U' || c === 'D';
const isFB = (c) => c === 'F' || c === 'B';

/** Progress measures for a cube state. */
export function measure(model) {
  const s = model.s;
  let cornersAligned = 0;
  let edgesAligned = 0;
  let middleEdgesInMiddle = 0;
  let piecesHome = 0;

  for (const slot of CORNER_FACELETS) {
    if (isUD(s[slot[0]])) cornersAligned++;
    if (slot.every((i, k) => s[i] === SLOT_FACES(slot)[k])) piecesHome++;
  }
  EDGE_FACELETS.forEach((slot, n) => {
    const [a, b] = slot.map((i) => s[i]);
    // An edge points the right way when its top/bottom color (or, for the four
    // middle-layer edges, its front/back color) sits on the slot's reference side.
    const primary = isUD(a) || isUD(b) ? (isUD(a) ? a : b) : isFB(a) ? a : b;
    if (a === primary) edgesAligned++;
    const isMiddlePiece = !isUD(a) && !isUD(b);
    if (isMiddlePiece && n >= 8) middleEdgesInMiddle++;
    if (slot.every((i, k) => s[i] === SLOT_FACES(slot)[k])) piecesHome++;
  });
  return { cornersAligned, edgesAligned, middleEdgesInMiddle, piecesHome };
}

const isStageTwoMove = (m) => m[0] === 'U' || m[0] === 'D' || m.endsWith('2');

const inStageTwoGroup = (p) => p.cornersAligned === 8 && p.edgesAligned === 12 && p.middleEdgesInMiddle === 4;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "a", "a and b", "a, b and c". */
const listing = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

function stageOneGains(before, after) {
  const parts = [];
  const dc = after.cornersAligned - before.cornersAligned;
  const de = after.edgesAligned - before.edgesAligned;
  const dm = after.middleEdgesInMiddle - before.middleEdgesInMiddle;
  if (dc > 0) parts.push(`turns ${plural(dc, 'corner')} so white or yellow faces up or down`);
  if (de > 0) parts.push(`flips ${plural(de, 'edge')} to point the right way`);
  if (dm > 0) parts.push(`drops ${plural(dm, 'middle edge')} into the middle layer`);
  return { parts, lost: dc < 0 || de < 0 || dm < 0 };
}

function describeStageOne(before, after, setsUp) {
  const { parts, lost } = stageOneGains(before, after);
  if (inStageTwoGroup(after)) {
    return 'This finishes stage 1: every piece now points the right way and the middle edges are in the middle layer.';
  }
  if (parts.length) {
    return `This move ${listing(parts)}.${lost ? ' A few others get knocked out of line, which the next moves fix.' : ''}`;
  }
  if (setsUp) {
    return `This move doesn't fix anything by itself. It lines pieces up so that move ${setsUp.index + 1} (${setsUp.move}) ${setsUp.text}.`;
  }
  return 'This move doesn\'t fix anything by itself. It lines pieces up so later turns can fix several at once.';
}

function describeStageTwo(before, after, move, setsUp) {
  const gained = after.piecesHome - before.piecesHome;
  if (after.piecesHome === 20) return 'This is the last move: every piece is home and the cube is solved.';
  const safe = move[0] === 'U' || move[0] === 'D'
    ? 'Turning the top or bottom can\'t flip anything out of line.'
    : 'A half turn keeps every piece pointing the right way.';
  if (gained > 0) return `This move brings ${plural(gained, 'more piece')} home. ${safe}`;
  const next = setsUp ? ` It sets up move ${setsUp.index + 1} (${setsUp.move}), which ${setsUp.text}.` : '';
  if (gained < 0) return `This move borrows ${plural(-gained, 'piece')} out of place to make room.${next} ${safe}`;
  return `This move lines pieces up without bringing any home yet.${next} ${safe}`;
}

/**
 * Returns one explanation per move:
 * { stage: 1 | 2, why: string, progress: measure() after the move }.
 * `state` is the 54-letter facelet string the solver was given.
 */
export function explainSolution(state, moves) {
  // Stage 2 starts at the first point from which the cube is in the restricted
  // group and only stage-2 moves remain.
  const model = new CubeModel(state);
  const snapshots = [measure(model)];
  for (const m of moves) snapshots.push(measure(model.move(m)));

  let split = moves.length;
  while (split > 0 && isStageTwoMove(moves[split - 1]) && inStageTwoGroup(snapshots[split - 1])) split--;

  // What each move achieves, so a setup move can say what it is setting up.
  const payoff = moves.map((move, i) => {
    const [before, after] = [snapshots[i], snapshots[i + 1]];
    if (i < split) {
      if (inStageTwoGroup(after)) return 'finishes stage 1';
      const { parts } = stageOneGains(before, after);
      return parts.length ? listing(parts) : null;
    }
    const gained = after.piecesHome - before.piecesHome;
    if (after.piecesHome === 20) return 'solves the cube';
    return gained > 0 ? `brings ${plural(gained, 'piece')} home` : null;
  });
  const nextPayoff = (i) => {
    const stageEnd = i < split ? split : moves.length;
    for (let j = i + 1; j < stageEnd; j++) {
      if (payoff[j]) return { index: j, move: moves[j], text: payoff[j] };
    }
    return null;
  };

  return moves.map((move, i) => {
    const stage = i < split ? 1 : 2;
    const before = snapshots[i];
    const after = snapshots[i + 1];
    return {
      stage,
      why: stage === 1
        ? describeStageOne(before, after, nextPayoff(i))
        : describeStageTwo(before, after, move, nextPayoff(i)),
      progress: after,
      before,
    };
  });
}

export const STAGES = {
  1: {
    title: 'Point every piece the right way',
    intro:
      'The solver works like a speedcuber planning ahead. First it doesn\'t care where pieces are, only which way they point: every corner with its white or yellow sticker on the top or bottom, every edge facing the right way, and the four middle edges (the ones with no white or yellow) in the middle layer.',
  },
  2: {
    title: 'Bring every piece home',
    intro:
      'Now every piece points the right way. From here the solver only turns the top and bottom, or gives a side a half turn, because those moves can never flip a piece back out of line. It just moves pieces to their home spots.',
  },
};
