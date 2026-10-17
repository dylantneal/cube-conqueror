# Rubix Solver

Enter your Rubik's cube on a 3D model, get the shortest practical solution, and watch the same cube solve itself step by step.

## Status

- [x] Step 1: 3D cube with realistic layer turns (drag a face, use the buttons, or press U/D/L/R/F/B; Shift for counterclockwise)
- [x] Step 2: Paint your cube's colors directly on the 3D cube, with a check that it is solvable
- [ ] Step 3: Two-phase (Kociemba) solver running in the browser
- [ ] Step 4: Step-by-step solution playback, mobile polish, GitHub Pages deploy

## Develop

```sh
npm install
npm run dev      # local dev server
npm run build    # production build in dist/
```

## Code layout

- `src/cube.js`: the cube model. Builds the 26 pieces, queues and animates turns, and reads back sticker colors (`getFacelets()`).
- `src/main.js`: scene, lighting, camera, drag-to-turn, paint mode, buttons and keyboard.
- `src/validate.js`: checks a painted cube is reachable on a real cube (color counts, real pieces, twist, flip, swap parity).
- `src/style.css`: page styles.
