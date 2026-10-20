import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CARD_ASPECT, CARD_FOV, cardDirection, cardDirectionFor, cardPoseFrom, silhouette, type CardPose, type Silhouette } from "@/lib/garden/cardAim";
import { lanternAlong, lanternClear, roomAlong } from "@/lib/garden/room";

const deg = THREE.MathUtils.degToRad;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const pose = (): CardPose => ({ position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0 });
const elevationOf = (d: THREE.Vector3) => Math.asin(d.y);
const azimuthOf = (d: THREE.Vector3) => Math.atan2(d.x, d.z);

/** A camera at the pose, the card's shape. */
function camera(p: CardPose): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(p.fov, CARD_ASPECT, 0.05, 80);
  c.position.copy(p.position);
  c.lookAt(p.target);
  c.updateMatrixWorld();
  return c;
}

describe("the card's view of a bloom", () => {
  it("takes the garden's lit side, nearly level, when the bloom's face allows it", () => {
    const d = cardDirection(v(0.3, 0.5, 0.8).normalize(), deg(72), new THREE.Vector3());
    expect(azimuthOf(d)).toBeCloseTo(0.25, 2);
    expect(elevationOf(d)).toBeCloseTo(deg(6), 2);
  });

  it("turns toward a face that points away, on the lit side while it can see it well from there", () => {
    // leaning left and a little back: the lit side still sees it within a little of what the species allows
    const left = v(-0.6, 0.7, 0.1).normalize();
    for (const face of [deg(50), deg(72)]) {
      const d = cardDirection(left, face, new THREE.Vector3());
      expect(d.angleTo(left)).toBeLessThanOrEqual(face + deg(15) + 1e-6);
      expect(azimuthOf(d)).toBeGreaterThanOrEqual(-0.7 - 1e-9);
      expect(azimuthOf(d)).toBeLessThanOrEqual(1.1 + 1e-9);
      expect(elevationOf(d)).toBeGreaterThanOrEqual(deg(3) - 1e-9);
      expect(elevationOf(d)).toBeLessThanOrEqual(deg(60) + 1e-9);
    }
    // a flat star facing up is seen from above, a cup from nearer the side
    const up = v(0, 1, 0);
    expect(elevationOf(cardDirectionFor("jasmine", up, new THREE.Vector3()))).toBeGreaterThan(deg(55));
    expect(elevationOf(cardDirectionFor("rose", up, new THREE.Vector3()))).toBeLessThan(deg(25));
  });

  it("sees a star leaning into the bed from its face, all round the flower, never from behind", () => {
    for (const axis of [v(0, 0.27, -0.96), v(-0.25, 0.42, -0.87), v(-0.6, 0.6, -0.5)]) {
      const n = axis.clone().normalize();
      const d = cardDirectionFor("jasmine", n, new THREE.Vector3());
      expect(d.angleTo(n)).toBeLessThan(deg(50));
      expect(elevationOf(d)).toBeGreaterThanOrEqual(deg(3) - 1e-9);
    }
  });

  it("passes over a view the scenery leaves no room for", () => {
    const axis = v(0.3, 0.5, 0.8).normalize();
    // nothing to the right of the flower's front: a hedge
    const roomOk = (d: THREE.Vector3) => azimuthOf(d) < 0;
    const d = cardDirection(axis, deg(72), new THREE.Vector3(), roomOk);
    expect(roomOk(d)).toBe(true);
    expect(d.angleTo(axis)).toBeLessThan(deg(80));
  });

  it("never looks from under the bed, whatever the head does", () => {
    for (const axis of [v(0, -1, 0), v(0, 0, -1), v(1, -0.2, 0).normalize(), v(0, 1, 0)]) {
      const d = cardDirection(axis, deg(30), new THREE.Vector3());
      expect(d.length()).toBeCloseTo(1, 6);
      expect(elevationOf(d)).toBeGreaterThanOrEqual(deg(3) - 1e-9);
    }
  });
});

describe("framing the bloom", () => {
  // a lopsided bloom: a cup with one long petal out to the right
  const points = [v(-0.2, 1, 0), v(0.2, 1, 0), v(0, 1.25, 0), v(0, 0.95, 0.1), v(0.45, 1.05, 0)];
  const each = (visit: (p: THREE.Vector3) => void) => points.forEach(visit);

  it("centres the silhouette across the card and sets it above the words", () => {
    const dir = v(0, 0.1, 1).normalize();
    const s: Silhouette = silhouette(each, dir, { centre: new THREE.Vector3(), width: 0, height: 0 });
    expect(s.width).toBeCloseTo(0.65, 2);
    const p = cardPoseFrom(s, dir, pose());
    expect(p.fov).toBe(CARD_FOV);
    const cam = camera(p);
    const ndc = points.map((pt) => pt.clone().project(cam));
    const xs = ndc.map((n) => n.x);
    const ys = ndc.map((n) => n.y);
    // the silhouette's left and right edges sit evenly about the middle, its middle a little above the card's
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0, 1);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeGreaterThan(0.1);
    // a little over half the card's width, and clear of the foot of the card
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.85);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1.25);
    expect(Math.min(...ys)).toBeGreaterThan(-0.3);
  });

  it("stands farther back for a bigger bloom, within its limits", () => {
    const dir = v(0, 0, 1);
    const near = cardPoseFrom({ centre: v(0, 1, 0), width: 0.2, height: 0.2 }, dir, pose());
    const far = cardPoseFrom({ centre: v(0, 1, 0), width: 0.6, height: 0.4 }, dir, pose());
    expect(far.position.z).toBeGreaterThan(near.position.z);
    const huge = cardPoseFrom({ centre: v(0, 1, 0), width: 9, height: 9 }, dir, pose());
    expect(huge.position.z).toBeCloseTo(3.4, 6);
    // a hedge a metre and a half back: no farther than that
    const hemmed = cardPoseFrom({ centre: v(0, 1, 0), width: 0.6, height: 0.4 }, dir, pose(), (want) => Math.min(want, 1.5));
    expect(hemmed.position.z).toBeCloseTo(1.5, 6);
  });
});

describe("the lantern in the card's picture", () => {
  it("passes over a view that looks at a jasmine past the lamp", () => {
    // a jasmine leaning back and to the left, toward the lantern
    const axis = new THREE.Vector3(-0.51, 0.49, -0.71).normalize();
    const head = new THREE.Vector3(-0.26, 0.86, -0.32);
    const want = 1.49;
    const roomOk = (d: THREE.Vector3) =>
      roomAlong(head.x, head.y, head.z, d.x, d.y, d.z, want) >= want * 0.85 && lanternAlong(head.x, head.y, head.z, d.x, d.y, d.z, want) >= want * 0.85;
    const d = cardDirectionFor("jasmine", axis, new THREE.Vector3(), roomOk);
    const p = cardPoseFrom({ centre: head, width: 0.3, height: 0.25 }, d, pose(), (w) =>
      Math.min(roomAlong(head.x, head.y, head.z, d.x, d.y, d.z, w), lanternAlong(head.x, head.y, head.z, d.x, d.y, d.z, w)),
    );
    const dist = p.position.distanceTo(head);
    expect(lanternClear(head.x, head.y, head.z, d.x, d.y, d.z, dist)).toBe(true);
    // and still sees the star well
    expect(d.angleTo(axis)).toBeLessThan(deg(60));
  });

  it("knows when the lamp stands between the camera and the flower", () => {
    const head = new THREE.Vector3(-0.26, 0.86, -0.32);
    // looking from just past the lamp, straight at the flower
    const lamp = new THREE.Vector3(-0.683, 1.18, -0.458);
    const d = lamp.clone().sub(head).normalize();
    const far = lamp.distanceTo(head) + 0.6;
    expect(lanternClear(head.x, head.y, head.z, d.x, d.y, d.z, far)).toBe(false);
    expect(lanternAlong(head.x, head.y, head.z, d.x, d.y, d.z, far)).toBeLessThan(far);
  });
});
