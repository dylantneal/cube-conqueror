// Runs the two-phase solver off the main thread so the page stays smooth.
// It posts a first solution right away, then keeps searching for shorter ones
// until it can't find any; the page decides how long to wait.
import min2phase from 'min2phase.js';

// Search only with white/yellow as the up-down axis and no "pre-moves", so every
// solution is a clean stage 1 (point pieces the right way) followed by stage 2
// (bring them home). That costs about one extra move on average but lets the
// guide explain what each move is doing.
const initSearch = min2phase.Search.prototype.initSearch;
min2phase.Search.prototype.initSearch = function () {
  initSearch.call(this);
  this.conjMask = 0x3e;
  this.maxPreMoves = 0;
};

min2phase.initFull();

const moveCount = (solution) => solution.trim().split(/\s+/).filter(Boolean).length;

self.onmessage = ({ data: { id, facelets } }) => {
  let best = new min2phase.Search().solution(facelets);
  if (best.startsWith('Error')) {
    self.postMessage({ id, error: best, done: true });
    return;
  }
  self.postMessage({ id, solution: best.trim(), done: false });

  for (let depth = moveCount(best) - 1; depth > 0; depth--) {
    const shorter = new min2phase.Search().solution(facelets, depth);
    if (shorter.startsWith('Error')) break;
    best = shorter;
    self.postMessage({ id, solution: best.trim(), done: false });
  }
  self.postMessage({ id, solution: best.trim(), done: true });
};
