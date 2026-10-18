// The courtyard's camera shots (product/camera.ts): the wide framing is the concepts page's signed-off one, and leaning
// toward a subject (the jar on the coping, the flower) keeps that subject in the frame and the pond with it, on a tall
// phone, an iPad either way and a laptop.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { POND } from "@/components/lotus/pond";
import { pondJarInPotFrame, POND_FLOWER } from "@/components/lotus/look";
import { POT_FRAME } from "@/components/lotus/pond";
import { courtLensPoints, courtShot, LEAN, pondFraming, type CourtShot, type CourtSubject } from "@/components/lotus/product/camera";

const ASPECTS = [390 / 844, 820 / 1180, 1, 1180 / 820, 1440 / 900, 16 / 9];
const shot = (): CourtShot => ({ target: new THREE.Vector3(), distance: 0, elevation: 0, azimuth: 0, fov: 0 });

/** Where a world point lands on the screen for a shot (NDC, -1..1 inside). */
function onScreen(s: CourtShot, aspect: number, p: THREE.Vector3): THREE.Vector3 {
  const cam = new THREE.PerspectiveCamera(s.fov, aspect, 0.05, 80);
  const flat = Math.cos(s.elevation) * s.distance;
  cam.position.set(Math.sin(s.azimuth) * flat, Math.sin(s.elevation) * s.distance, Math.cos(s.azimuth) * flat).add(s.target);
  cam.lookAt(s.target);
  cam.updateMatrixWorld();
  return p.clone().project(cam);
}

const inside = (v: THREE.Vector3, margin = 0.04) => Math.abs(v.x) <= 1 - margin && Math.abs(v.y) <= 1 - margin && v.z < 1;
const jarAt = () => {
  const j = pondJarInPotFrame("Lijas");
  return new THREE.Vector3(j[0] + POT_FRAME[0], j[1] + POT_FRAME[1] + 0.05, j[2] + POT_FRAME[2]);
};
const headAt = () => new THREE.Vector3(POND_FLOWER.flower.head[0] + POT_FRAME[0], POND_FLOWER.flower.head[1] + POT_FRAME[1], POND_FLOWER.flower.head[2] + POT_FRAME[2]);
const potAt = () => new THREE.Vector3(POT_FRAME[0], POT_FRAME[1], POT_FRAME[2]);

describe("the courtyard's shots", () => {
  it("are the concepts page's pond framing when leaning toward nothing", () => {
    for (const a of ASPECTS) {
      const s = courtShot(a, { kind: "none", at: new THREE.Vector3(), lean: 0 }, shot());
      const p = pondFraming(a);
      expect(s.distance).toBeCloseTo(p.distance, 9);
      expect(s.elevation).toBeCloseTo(p.elevation, 9);
      expect(s.target.y).toBeCloseTo(POND.waterY + p.lift, 9);
      expect(inside(onScreen(s, a, potAt()))).toBe(true);
    }
  });

  it("keep the jar, the pot and the front coping in frame while leaning toward the jar", () => {
    for (const a of ASPECTS) {
      const subject: CourtSubject = { kind: "jar", at: jarAt(), lean: LEAN.jar };
      const s = courtShot(a, subject, shot());
      expect(inside(onScreen(s, a, jarAt())), `jar at ${a.toFixed(2)}`).toBe(true);
      expect(inside(onScreen(s, a, potAt())), `pot at ${a.toFixed(2)}`).toBe(true);
      // the jar sits in the lower part of the frame, the pond above it
      expect(onScreen(s, a, jarAt()).y).toBeLessThan(0);
    }
  });

  it("keep the flower and its pot in frame while leaning toward it", () => {
    for (const a of ASPECTS) {
      const s = courtShot(a, { kind: "plant", at: headAt(), lean: LEAN.plant }, shot());
      expect(inside(onScreen(s, a, headAt())), `head at ${a.toFixed(2)}`).toBe(true);
      expect(inside(onScreen(s, a, potAt()))).toBe(true);
    }
  });
});

describe("the courtyard's lens points", () => {
  it("keep the jar itself, not the back of the pond, clear of a phone's tall care card", () => {
    const a = 390 / 844;
    const H = 844;
    const subject: CourtSubject = { kind: "jar", at: jarAt(), lean: LEAN.jar };
    const s = courtShot(a, subject, shot());
    const head = new THREE.Vector3(), foot = new THREE.Vector3(), cap = new THREE.Vector3();
    courtLensPoints(subject, 0, head, foot, cap);
    // the jar's foot and top straddle the subject's point
    expect(foot.y).toBeLessThan(subject.at.y);
    expect(cap.y).toBeGreaterThan(subject.at.y);
    const py = (p: THREE.Vector3) => ((1 - onScreen(s, a, p).y) / 2) * H;
    // a question open on the card (its top at 383 px): the room the lens may lift the picture by, the jar's top kept
    // under the name pill, is enough to bring the jar's foot clear of the card (CameraRig.shiftLens's rule)
    const top = Math.min(96, H * 0.11), bottom = 383 - 12;
    const need = py(foot) - bottom, room = py(cap) - top;
    expect(room, `need ${need.toFixed(0)} px, room ${room.toFixed(0)} px`).toBeGreaterThanOrEqual(need);
  });

  it("keep the flower garden's pond points for the plant", () => {
    const head = new THREE.Vector3(), foot = new THREE.Vector3(), cap = new THREE.Vector3();
    courtLensPoints({ kind: "plant", at: headAt(), lean: LEAN.plant }, headAt().y, head, foot, cap);
    expect(foot.y).toBeCloseTo(POND.copingY, 9);
    expect(cap.y).toBeCloseTo(POND.copingY, 9);
  });
});
