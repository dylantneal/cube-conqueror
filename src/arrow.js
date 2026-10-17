import * as THREE from 'three';

// Turn arrows drawn the way cube guides draw them: straight arrows across the
// moving row or column on the faces you can see from the front (front, top and
// right), pointing the way the stickers travel.

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const VISIBLE = { F: new THREE.Vector3(0, 0, 1), U: new THREE.Vector3(0, 1, 0), R: new THREE.Vector3(1, 0, 0) };

// Axis, layer and clockwise sign for each face turn (same convention as cube.js).
const MOVES = {
  R: ['x', 1, -1], L: ['x', -1, 1], U: ['y', 1, -1], D: ['y', -1, 1], F: ['z', 1, -1], B: ['z', -1, 1],
};

const LENGTH = 2.5;

/** A flat arrow pointing along +x, centered on the origin. */
function arrowShape(shaft, head, headLength, doubleHead) {
  const half = LENGTH / 2;
  const s = new THREE.Shape();
  s.moveTo(-half, -shaft / 2);
  s.lineTo(half - headLength, -shaft / 2);
  s.lineTo(half - headLength, -head / 2);
  s.lineTo(half, 0);
  s.lineTo(half - headLength, head / 2);
  s.lineTo(half - headLength, shaft / 2);
  s.lineTo(-half, shaft / 2);
  s.closePath();
  const shapes = [s];
  if (doubleHead) {
    // A second arrowhead marks a half turn.
    const t = new THREE.Shape();
    const tip = half - headLength * 1.15;
    t.moveTo(tip - headLength, -head / 2);
    t.lineTo(tip, 0);
    t.lineTo(tip - headLength, head / 2);
    t.closePath();
    shapes.push(t);
  }
  return new THREE.ShapeGeometry(shapes);
}

export class TurnArrow {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.fill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    this.outline = new THREE.MeshBasicMaterial({ color: 0x0b0d14, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    this.geometries = {
      single: [arrowShape(0.13, 0.42, 0.42, false), arrowShape(0.25, 0.6, 0.55, false)],
      double: [arrowShape(0.13, 0.42, 0.42, true), arrowShape(0.25, 0.6, 0.55, true)],
    };
  }

  /** Shows the arrows for a face turn like "R", "U'" or "F2", or hides them for null. */
  show(move) {
    this.group.clear();
    if (!move || !MOVES[move[0]]) {
      this.group.visible = false;
      return;
    }
    const [axisName, layer, clockwise] = MOVES[move[0]];
    const axis = AXES[axisName];
    const sign = move.endsWith("'") ? -clockwise : clockwise;
    const omega = axis.clone().multiplyScalar(sign);
    const [fillGeo, outlineGeo] = this.geometries[move.endsWith('2') ? 'double' : 'single'];

    for (const normal of Object.values(VISIBLE)) {
      if (Math.abs(normal.dot(axis)) > 0.5) continue;
      // Center of the moving row or column on this face, and the way it travels.
      const center = normal.clone().multiplyScalar(1.5).addScaledVector(axis, layer);
      const along = new THREE.Vector3().crossVectors(normal, axis);
      if (new THREE.Vector3().crossVectors(omega, center).dot(along) < 0) along.negate();
      const side = new THREE.Vector3().crossVectors(normal, along);
      const basis = new THREE.Matrix4().makeBasis(along, side, normal);

      for (const [geometry, material, lift] of [[outlineGeo, this.outline, 0.055], [fillGeo, this.fill, 0.065]]) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.quaternion.setFromRotationMatrix(basis);
        mesh.position.copy(center).addScaledVector(normal, lift);
        this.group.add(mesh);
      }
    }
    this.group.visible = true;
    this.shownAt = performance.now();
  }

  /** Gentle pulse so the arrows catch the eye. */
  update(now) {
    if (!this.group.visible) return;
    const t = (now - this.shownAt) / 260;
    this.fill.opacity = 0.75 + 0.2 * Math.sin(t);
  }
}
