import * as THREE from 'three';

const FACE_NORMALS = {
  U: new THREE.Vector3(0, 1, 0),
  D: new THREE.Vector3(0, -1, 0),
  F: new THREE.Vector3(0, 0, 1),
  B: new THREE.Vector3(0, 0, -1),
  R: new THREE.Vector3(1, 0, 0),
  L: new THREE.Vector3(-1, 0, 0),
};

/**
 * A curved arrow that floats just above a face and shows which way to turn it.
 * Built counterclockwise around +z, then mirrored and rotated onto the face.
 */
export class TurnArrow {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.inner = new THREE.Group();
    this.group.add(this.inner);

    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const radius = 0.95;
    const arc = Math.PI * 1.35;
    const start = Math.PI * 0.6;

    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.055, 12, 64, arc), material);
    ring.rotation.z = start;
    this.inner.add(ring);

    // Arrowhead at the end of the arc, pointing along the direction of travel.
    const end = start + arc;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 20), material);
    head.position.set(Math.cos(end) * radius, Math.sin(end) * radius, 0);
    head.rotation.z = end; // The cone points up (+y); rotating by `end` aligns it with the tangent.
    this.inner.add(head);

    // Draw on top of the cube so the arrow never hides behind stickers.
    for (const mesh of [ring, head]) mesh.renderOrder = 10;
  }

  /** Shows the arrow for a move like "R", "U'" or "F2", or hides it for null. */
  show(move) {
    if (!move) {
      this.group.visible = false;
      return;
    }
    const face = move[0];
    const counterclockwise = move.endsWith("'");
    const normal = FACE_NORMALS[face];
    this.group.position.copy(normal).multiplyScalar(1.56);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    // Mirroring the counterclockwise arrow makes it clockwise as seen from outside the face.
    this.inner.scale.x = counterclockwise ? 1 : -1;
    this.group.visible = true;
    this.shownAt = performance.now();
  }

  /** Gentle pulse so the arrow catches the eye. */
  update(now) {
    if (!this.group.visible) return;
    const s = 1 + 0.04 * Math.sin((now - this.shownAt) / 220);
    this.group.scale.setScalar(s);
  }
}
