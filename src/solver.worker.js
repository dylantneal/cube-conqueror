// Runs the two-phase solver off the main thread so the page stays smooth.
// It posts a first solution right away, then keeps searching for shorter ones
// until it can't find any; the page decides how long to wait.
import min2phase from 'min2phase.js';

min2phase.initFull();

const moveCount = (solution) => solution.trim().split(/\s+/).filter(Boolean).length;

self.onmessage = ({ data: { id, facelets } }) => {
  let best = min2phase.solve(facelets);
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
