// Checks whether a painted cube is one that can actually be reached by turning a
// real cube. Facelets use Kociemba's layout: 54 letters in face order U R F D L B,
// each face read left to right, top to bottom.

export const FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

export const COLOR_NAMES = {
  U: 'white',
  R: 'red',
  F: 'green',
  D: 'yellow',
  L: 'orange',
  B: 'blue',
};

const f = (face, n) => FACE_ORDER.indexOf(face) * 9 + n - 1;

// Sticker positions of each corner and edge slot, and the colors of the piece
// that belongs there.
export const CORNER_FACELETS = [
  [f('U', 9), f('R', 1), f('F', 3)],
  [f('U', 7), f('F', 1), f('L', 3)],
  [f('U', 1), f('L', 1), f('B', 3)],
  [f('U', 3), f('B', 1), f('R', 3)],
  [f('D', 3), f('F', 9), f('R', 7)],
  [f('D', 1), f('L', 9), f('F', 7)],
  [f('D', 7), f('B', 9), f('L', 7)],
  [f('D', 9), f('R', 9), f('B', 7)],
];
const CORNER_COLORS = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];

export const EDGE_FACELETS = [
  [f('U', 6), f('R', 2)],
  [f('U', 8), f('F', 2)],
  [f('U', 4), f('L', 2)],
  [f('U', 2), f('B', 2)],
  [f('D', 6), f('R', 8)],
  [f('D', 2), f('F', 8)],
  [f('D', 4), f('L', 8)],
  [f('D', 8), f('B', 8)],
  [f('F', 6), f('R', 4)],
  [f('F', 4), f('L', 6)],
  [f('B', 6), f('L', 4)],
  [f('B', 4), f('R', 6)],
];
const EDGE_COLORS = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

const names = (letters) => [...letters].map((c) => COLOR_NAMES[c]).join('-');

function parity(perm) {
  let swaps = 0;
  const seen = new Array(perm.length).fill(false);
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let length = 0;
    for (let j = i; !seen[j]; j = perm[j]) {
      seen[j] = true;
      length++;
    }
    swaps += length - 1;
  }
  return swaps % 2;
}

/**
 * Returns { ok: true } or { ok: false, message, stickers } where `stickers` lists
 * the facelet indices worth highlighting. A null facelet means "not painted yet".
 */
export function validateFacelets(facelets) {
  const blanks = facelets.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (blanks.length) {
    return {
      ok: false,
      message: `${blanks.length} sticker${blanks.length === 1 ? ' is' : 's are'} still blank. Paint every sticker before checking.`,
      stickers: blanks,
    };
  }

  const counts = Object.fromEntries(FACE_ORDER.map((c) => [c, 0]));
  for (const c of facelets) counts[c]++;
  const wrong = FACE_ORDER.filter((c) => counts[c] !== 9);
  if (wrong.length) {
    const detail = wrong.map((c) => `${counts[c]} ${COLOR_NAMES[c]}`).join(', ');
    return { ok: false, message: `Each color should appear exactly 9 times. You have ${detail}.`, stickers: [] };
  }

  const cp = [];
  const co = [];
  for (let i = 0; i < 8; i++) {
    const slot = CORNER_FACELETS[i];
    const colors = slot.map((idx) => facelets[idx]);
    const ori = colors.findIndex((c) => c === 'U' || c === 'D');
    const piece = ori < 0 ? -1 : CORNER_COLORS.findIndex(
      (p) => p[0] === colors[ori] && p[1] === colors[(ori + 1) % 3] && p[2] === colors[(ori + 2) % 3],
    );
    if (piece < 0) {
      return {
        ok: false,
        message: `There's a ${names(colors.join(''))} corner, and no real cube has one. Check those three stickers.`,
        stickers: slot,
      };
    }
    if (cp.includes(piece)) {
      const other = CORNER_FACELETS[cp.indexOf(piece)];
      return {
        ok: false,
        message: `The ${names(CORNER_COLORS[piece])} corner shows up twice. One of them has a wrong sticker.`,
        stickers: [...slot, ...other],
      };
    }
    cp.push(piece);
    co.push(ori);
  }

  const ep = [];
  const eo = [];
  for (let i = 0; i < 12; i++) {
    const slot = EDGE_FACELETS[i];
    const colors = slot.map((idx) => facelets[idx]).join('');
    let piece = EDGE_COLORS.indexOf(colors);
    let flip = 0;
    if (piece < 0) {
      piece = EDGE_COLORS.indexOf(colors[1] + colors[0]);
      flip = 1;
    }
    if (piece < 0) {
      return {
        ok: false,
        message: `There's a ${names(colors)} edge, and no real cube has one. Check those two stickers.`,
        stickers: slot,
      };
    }
    if (ep.includes(piece)) {
      const other = EDGE_FACELETS[ep.indexOf(piece)];
      return {
        ok: false,
        message: `The ${names(EDGE_COLORS[piece])} edge shows up twice. One of them has a wrong sticker.`,
        stickers: [...slot, ...other],
      };
    }
    ep.push(piece);
    eo.push(flip);
  }

  if (co.reduce((a, b) => a + b, 0) % 3 !== 0) {
    return {
      ok: false,
      message: 'One corner is twisted in place, which a real cube can\'t do by turning. Recheck the corner stickers, especially their order.',
      stickers: CORNER_FACELETS.flat(),
    };
  }
  if (eo.reduce((a, b) => a + b, 0) % 2 !== 0) {
    return {
      ok: false,
      message: 'One edge is flipped in place, which a real cube can\'t do by turning. Recheck the edge stickers.',
      stickers: EDGE_FACELETS.flat(),
    };
  }
  if (parity(cp) !== parity(ep)) {
    return {
      ok: false,
      message: 'Two pieces look swapped, which a real cube can\'t do by turning. Recheck where each piece sits.',
      stickers: [],
    };
  }
  return { ok: true };
}
