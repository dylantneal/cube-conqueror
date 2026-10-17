import SolverWorker from './solver.worker.js?worker&inline';

// How long to keep looking for a shorter solution after the first one.
const SEARCH_BUDGET_MS = 1500;

let worker = new SolverWorker();
let nextId = 0;

/**
 * Solves a cube given as a 54-letter facelet string (Kociemba layout).
 * Resolves to an array of moves such as ["R", "U'", "F2"].
 */
export function solve(facelets) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    let best = null;
    let timer = null;

    const finish = () => {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      resolve(best.split(/\s+/).filter(Boolean));
    };

    const onMessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.error) {
        worker.removeEventListener('message', onMessage);
        reject(new Error(data.error));
        return;
      }
      best = data.solution;
      if (data.done) {
        finish();
      } else if (!timer) {
        timer = setTimeout(() => {
          // Stop a search that is still running and start a fresh worker for next time.
          worker.terminate();
          worker = new SolverWorker();
          finish();
        }, SEARCH_BUDGET_MS);
      }
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, facelets });
  });
}
