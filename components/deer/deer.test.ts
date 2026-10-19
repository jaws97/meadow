import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { headPoint, NOSE_UV } from "@/components/deer/blueprint";
import { BONE_NAMES, buildDoe, makeBones, restPivots } from "@/components/deer/build";
import { DoeAnimator, type DoeIntent } from "@/components/deer/motion";

function rig(tier: "lite" | "balanced" | "cinematic" = "balanced") {
  const b = buildDoe(tier);
  const mesh = new THREE.Object3D();
  mesh.add(b.bones[0]);
  const anim = new DoeAnimator(mesh, b.bones, 7);
  return { b, mesh, anim };
}

const stand: DoeIntent = { target: null, speed: 0, face: null, graze: 0, browse: 0, look: null };

describe("the doe's geometry", () => {
  it("stays inside the triangle budget on every tier", () => {
    const tris = { lite: buildDoe("lite").triangles, balanced: buildDoe("balanced").triangles, cinematic: buildDoe("cinematic").triangles };
    expect(tris.lite).toBeLessThan(7000);
    expect(tris.balanced).toBeLessThan(11000);
    expect(tris.cinematic).toBeLessThan(16000);
    expect(tris.lite).toBeLessThan(tris.balanced);
  });

  it("has finite positions and skin weights that sum to one", () => {
    const { geometry } = buildDoe("lite");
    const pos = geometry.getAttribute("position").array;
    for (const x of pos) expect(Number.isFinite(x)).toBe(true);
    const w = geometry.getAttribute("skinWeight").array;
    const idx = geometry.getAttribute("skinIndex").array;
    for (let i = 0; i < w.length; i += 4) {
      expect(w[i] + w[i + 1] + w[i + 2] + w[i + 3]).toBeCloseTo(1, 4);
      for (let k = 0; k < 4; k++) expect(idx[i + k]).toBeLessThan(BONE_NAMES.length);
    }
  });

  it("stands on the ground at about a chital doe's height", () => {
    const { geometry } = buildDoe("balanced");
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.min.y).toBeGreaterThan(-0.02);
    expect(box.min.y).toBeLessThan(0.01);
    // the poll about 0.88 m and the ear tips a little above it; buttocks to nose about 1.15 m
    expect(box.max.y).toBeGreaterThan(0.86);
    expect(box.max.y).toBeLessThan(1.0);
    expect(box.max.x - box.min.x).toBeGreaterThan(1.05);
    expect(box.max.x - box.min.x).toBeLessThan(1.3);
  });
});

describe("the doe's motion", () => {
  it("solves her standing pose back to the rest pose", () => {
    const { anim, b } = rig();
    anim.place(0, 0, 0);
    anim.update(1 / 60, stand, 0);
    const rest = makeBones();
    for (const name of BONE_NAMES) {
      if (!/^(fore|hind)/.test(name)) continue;
      const i = BONE_NAMES.indexOf(name);
      const angle = b.bones[i].quaternion.angleTo(rest[i].quaternion);
      expect(angle, name).toBeLessThan(0.02);
    }
  });

  it("keeps a planted hoof where it was set down while she walks", () => {
    const { anim } = rig();
    anim.place(0, 0, 0);
    const walk: DoeIntent = { ...stand, target: new THREE.Vector2(6, 0), speed: 0.55 };
    const toe = new THREE.Vector3();
    const prev = [0, 1, 2, 3].map(() => new THREE.Vector3());
    const lift = [0, 0, 0, 0];
    let slid = 0;
    for (let f = 0; f < 60 * 6; f++) {
      anim.update(1 / 60, walk, f / 60);
      for (let i = 0; i < 4; i++) {
        const h = anim.foot(i, toe);
        // a hoof on the ground (now and a frame ago) must not move
        if (h < 1e-6 && lift[i] < 1e-6 && f > 0) slid = Math.max(slid, toe.distanceTo(prev[i]));
        prev[i].copy(toe);
        lift[i] = h;
      }
    }
    expect(anim.pos.x).toBeGreaterThan(2);
    expect(slid).toBeLessThan(1e-6);
  });

  it("reaches every hoof's place with the leg, walking and standing", () => {
    const { anim } = rig();
    anim.place(0, 0, 0);
    const walk: DoeIntent = { ...stand, target: new THREE.Vector2(8, 0), speed: 0.55 };
    const want = new THREE.Vector3();
    const got = new THREE.Vector3();
    let slide = 0;
    let worst = 0;
    for (let f = 0; f < 60 * 12; f++) {
      // walking, then standing still to settle
      anim.update(1 / 60, f < 60 * 9 ? walk : stand, f / 60);
      for (let i = 0; i < 4; i++) {
        const lift = anim.foot(i, want);
        want.y = lift;
        anim.reached(i, got);
        slide = Math.max(slide, Math.hypot(got.x - want.x, got.z - want.z));
        worst = Math.max(worst, got.distanceTo(want));
      }
    }
    // a hoof that slides is the first thing an eye catches; a foreleg at full stretch at the end of its stance may lift
    // its heel a little (the hoof breaking over), which reads as natural
    expect(slide).toBeLessThan(0.02);
    expect(worst).toBeLessThan(0.035);
  });

  it("brings her nose down to the grass when she grazes", () => {
    const { anim, b, mesh } = rig();
    anim.place(0, 0, 0);
    const head = b.bones[BONE_NAMES.indexOf("head")];
    const [nx, ny] = headPoint(NOSE_UV[0], NOSE_UV[1]);
    const local = new THREE.Vector3(nx, ny, 0).sub(restPivots().head);
    // she lifts her head now and then to look about, so the lowest the nose comes over a few seconds
    let lowest = Infinity;
    for (let f = 0; f < 60 * 8; f++) {
      anim.update(1 / 60, { ...stand, graze: 1 }, f / 60);
      mesh.updateMatrixWorld(true);
      lowest = Math.min(lowest, head.localToWorld(local.clone()).y);
    }
    expect(lowest).toBeLessThan(0.06);
    expect(lowest).toBeGreaterThan(-0.01);
  });
});
