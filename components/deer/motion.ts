// The doe's motion, solved every frame on her skeleton (build.ts): where she goes, how her legs carry her there, and
// what her neck, head, ears and tail do on the way. Pure three.js with no React, so a test can walk her and check that
// planted hooves stay put.
//
// Walking is a slow lateral-sequence walk (left hind, left fore, right hind, right fore, a quarter of a stride apart),
// as deer walk: each hoof is planted on the ground in the world and stays there until its turn to swing; a swing lasts
// about 0.4 s whatever her speed (only the stance stretches when she slows), lifting the hoof, folding the knee or the
// hock, flicking the hoof back and setting it down half a stride ahead of where it stands under her. Below a slow
// amble the stride clock stops and she settles instead, one hoof at a time, each that has drifted from under her
// stepping back to its place. Every leg reaches its hoof by inverse kinematics in its own side plane: the upper bone
// and the cannon keep their standing angle to each other (a deer's foreleg and hind leg fold as a parallelogram), the
// middle bone takes up the rest, and the pastern follows the ground.
//
// Above the legs: the body rises and falls twice a stride and the head nods with the forefeet; grazing lowers the
// neck until the muzzle reaches the grass (solved once from the skeleton, so it stays right if the proportions
// change), browsing raises it to the hedge's face; a look turns the neck and head toward a point; the ears swivel
// and flick, and the tail swishes, each on its own uneven clock.
import * as THREE from "three";
import { EAR, headPoint, NOSE_UV } from "@/components/deer/blueprint";
import { boneIndex, earBasis, restPivots, restToe, SIDES, sideZ, type Side } from "@/components/deer/build";
import { Rng } from "@/lib/plant/prng";

type Kind = "fore" | "hind";

/** Gait numbers for a slow walk (m, s, radians). */
export const GAIT = {
  /** how long a hoof is in the air */
  swing: 0.36,
  /** the hoof's travel under her while planted, at walking pace and at a crawl */
  stance: { walk: 0.52, slow: 0.4 },
  /** lateral sequence: left hind, left fore, right hind, right fore (deer: the fore lands 31% of a stride after its hind) */
  phase: { hindL: 0, foreL: 0.28, hindR: 0.5, foreR: 0.78 },
  lift: { fore: 0.075, hind: 0.06 },
  /** extra fold of the knee (carpus) or hock at mid-swing, and the hoof's flick back */
  fold: { fore: 1.05, hind: 0.3 },
  curl: { fore: 0.9, hind: 0.75 },
  /** under this speed the stride clock stops and she steps to settle instead */
  amble: 0.14,
  /** a hoof further than this from its place under her steps back to it when she is standing */
  settle: 0.045,
  /** the croup rises and falls more than the withers */
  bob: { croup: 0.011, withers: 0.007 },
  nod: 0.045,
} as const;

interface Leg {
  side: Side;
  kind: Kind;
  parent: THREE.Bone;
  bones: THREE.Bone[];
  /** the IK root in the parent bone's frame */
  root: THREE.Vector2;
  len: number[];
  ang0: number[];
  theta0: number;
  bend: number;
  /** the toe at rest, in her own frame */
  neutral: THREE.Vector3;
  offset: number;
  planted: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** seconds into the swing, or -1 while planted */
  swingT: number;
  swingDur: number;
  lift: number;
}

export interface DoeIntent {
  /** where to walk to (world x, z), or null to stand */
  target: THREE.Vector2 | null;
  /** cruising speed, m/s */
  speed: number;
  /** a heading to turn to while standing (radians, world), or null */
  face: number | null;
  graze: number;
  browse: number;
  /** a world point to look at, or null */
  look: THREE.Vector3 | null;
}

const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const v3 = new THREE.Vector3();
const v3b = new THREE.Vector3();
const q = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const m4 = new THREE.Matrix4();
const e = new THREE.Euler();
const FUTURE = new THREE.Vector2();
/** The furthest the neck lowers (see poseNeck). */
const GRAZE_MAX = 1.6;
/**
 * How lowering the head (to graze) and reaching (to browse) bend the neck's three bones and the head, per unit: a
 * grazing deer swings the whole neck down from its base and keeps it nearly straight, the face turned down to the
 * grass; browsing stretches the neck forward and lifts the nose.
 */
export const NECK_DOWN = [-1.25, -0.4, -0.18, 0.95];
/** Grazing also lowers her withers (the forelegs flex to keep the hooves where they are), and tips the chest. */
export const GRAZE_CHEST = { drop: 0.04, pitch: -0.06 } as const;
export const NECK_REACH = [-0.35, -0.05, 0.12, 0.3];

const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (x: number) => x * x * (3 - 2 * x);

/** A stochastic clock: fires at uneven intervals between `min` and `max` seconds. */
class Twitch {
  next: number;
  t = 0;
  constructor(
    private rng: Rng,
    private min: number,
    private max: number,
  ) {
    this.next = rng.range(min * 0.3, max);
  }
  step(dt: number): boolean {
    this.t += dt;
    if (this.t < this.next) return false;
    this.t = 0;
    this.next = this.rng.range(this.min, this.max);
    return true;
  }
}

export class DoeAnimator {
  readonly bones: THREE.Bone[];
  private readonly mesh: THREE.Object3D;
  private readonly legs: Leg[];
  private readonly by: (name: string) => THREE.Bone;
  private rng: Rng;

  /** world position (x, z) and heading (radians; she faces +x at 0, turning toward -z as it grows) */
  readonly pos = new THREE.Vector2();
  heading = 0;
  speed = 0;
  private phase = 0;
  private walkW = 0;

  // eased pose weights
  private graze = 0;
  private browse = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookW = 0;
  private crop = 0;
  private cropClock: Twitch;

  /** the rotation taking each ear from its resting carriage to alert (body frame) */
  private readonly earAlert: THREE.Quaternion[] = [];
  private checkClock: Twitch;
  /** a head-up check while grazing: seconds left */
  private check = 0;
  private checkSide = 0;
  private alert = 0;
  private ears: { side: Side; swivel: number; target: number; flick: number; clock: Twitch; flickClock: Twitch }[];
  private tail = { swish: 0, t: 0, clock: null as unknown as Twitch };

  /** neck lowering k (0 standing, 1 nose to the ground) -> nose height; built once */
  private grazeTable: { k: number; y: number }[] = [];
  private readonly nose = new THREE.Vector3();

  constructor(mesh: THREE.Object3D, bones: THREE.Bone[], seed: number) {
    this.mesh = mesh;
    this.bones = bones;
    this.rng = new Rng(`deer|${seed}`);
    this.by = (n) => bones[boneIndex(n)];
    const pivots = restPivots();
    const nose = headPoint(NOSE_UV[0], NOSE_UV[1]);
    this.nose.set(nose[0], nose[1], 0).sub(pivots.head);

    this.legs = [];
    for (const side of SIDES) {
      for (const kind of ["fore", "hind"] as const) {
        const names = kind === "fore" ? [1, 2, 3, 4].map((k) => `fore${side}${k}`) : [0, 1, 2, 3].map((k) => `hind${side}${k}`);
        const parentName = kind === "fore" ? "chest" : "pelvis";
        const pts = names.map((n) => pivots[n]);
        // the toe: the end of the pastern, on the ground
        const toe = restToe(kind, side);
        pts.push(toe);
        const segs = [0, 1, 2, 3].map((i) => new THREE.Vector2(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
        const ang0 = segs.map((s) => Math.atan2(s.y, s.x));
        const W = segs[0].clone().add(segs[2]);
        const B = segs[1];
        const p0 = pivots[parentName];
        this.legs.push({
          side,
          kind,
          parent: this.by(parentName),
          bones: names.map((n) => this.by(n)),
          root: new THREE.Vector2(pts[0].x - p0.x, pts[0].y - p0.y),
          len: segs.map((s) => s.length()),
          ang0,
          theta0: ang0[2] - ang0[0],
          bend: Math.sign(W.x * B.y - W.y * B.x) || 1,
          neutral: toe.clone(),
          offset: GAIT.phase[`${kind}${side}` as keyof typeof GAIT.phase],
          planted: new THREE.Vector3(),
          from: new THREE.Vector3(),
          to: new THREE.Vector3(),
          swingT: -1,
          swingDur: GAIT.swing,
          lift: 0,
        });
      }
    }
    this.cropClock = new Twitch(this.rng.fork("crop"), 0.55, 1.1);
    this.ears = SIDES.map((side) => ({
      side,
      swivel: 0,
      target: 0,
      flick: 0,
      clock: new Twitch(this.rng.fork(`ear${side}`), 2.5, 9),
      flickClock: new Twitch(this.rng.fork(`flick${side}`), 9, 40),
    }));
    this.tail.clock = new Twitch(this.rng.fork("tail"), 12, 45);
    this.checkClock = new Twitch(this.rng.fork("check"), 14, 45);
    for (const s of SIDES) {
      const rest = new THREE.Quaternion().setFromRotationMatrix(earBasis(s, EAR.rest.elevation, EAR.rest.azimuth));
      const alert = new THREE.Quaternion().setFromRotationMatrix(earBasis(s, EAR.alert.elevation, EAR.alert.azimuth));
      this.earAlert.push(alert.multiply(rest.invert()));
    }
    this.buildGrazeTable();
  }

  /** Puts her somewhere, standing square, every hoof planted under her. */
  place(x: number, z: number, heading: number) {
    this.pos.set(x, z);
    this.heading = heading;
    this.speed = 0;
    this.walkW = 0;
    this.applyTransform();
    for (const leg of this.legs) {
      this.neutralWorld(leg, leg.planted);
      leg.swingT = -1;
    }
  }

  private applyTransform() {
    this.mesh.position.set(this.pos.x, 0, this.pos.y);
    this.mesh.rotation.set(0, this.heading, 0);
    this.mesh.updateMatrixWorld(true);
  }

  /** Where a leg's hoof stands under her now (or at a future place), in the world. */
  private neutralWorld(leg: Leg, out: THREE.Vector3, ahead = 0, at?: THREE.Vector2, heading?: number) {
    const h = heading ?? this.heading;
    const c = Math.cos(h);
    const s = Math.sin(h);
    const lx = leg.neutral.x + ahead;
    const lz = leg.neutral.z;
    // rotation about y by h: x' = x cos h + z sin h, z' = -x sin h + z cos h
    const p = at ?? this.pos;
    return out.set(p.x + lx * c + lz * s, 0, p.y - lx * s + lz * c);
  }

  private buildGrazeTable() {
    const head = this.by("head");
    // with the withers lowered as they are when she grazes
    const chest = this.by("chest");
    chest.position.y -= GRAZE_CHEST.drop;
    chest.quaternion.setFromAxisAngle(Z, GRAZE_CHEST.pitch);
    for (let i = 0; i <= 32; i++) {
      const k = (i / 32) * GRAZE_MAX;
      this.poseNeck(k, 0, 0, 0);
      this.bones[0].updateMatrixWorld(true);
      const y = head.localToWorld(v3.copy(this.nose)).y - this.mesh.position.y;
      this.grazeTable.push({ k, y });
    }
    this.poseNeck(0, 0, 0, 0);
    chest.position.y += GRAZE_CHEST.drop;
    chest.quaternion.identity();
  }

  /** The lowering k that brings the nose to height y (m above her ground). */
  private lowerFor(y: number): number {
    const t = this.grazeTable;
    if (y >= t[0].y) return 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i].y <= y) {
        const a = t[i - 1];
        const b = t[i];
        return a.k + ((y - a.y) / (b.y - a.y)) * (b.k - a.k);
      }
    }
    return GRAZE_MAX;
  }

  /**
   * The neck and head: `lower` from 0 (carried up) to 1 (the muzzle down in the grass), `reach` stretching the neck
   * forward (browsing), and a look's yaw and pitch spread down the neck.
   */
  private poseNeck(lower: number, reach: number, yaw: number, pitch: number) {
    const share = [0.2, 0.25, 0.25, 0.3];
    const names = ["neck0", "neck1", "neck2", "head"];
    // pitch about z: negative lowers the head
    const down = NECK_DOWN;
    const fwd = NECK_REACH;
    names.forEach((n, i) => {
      const b = this.by(n);
      e.set(0, yaw * share[i], down[i] * lower + fwd[i] * reach + pitch * share[i], "YXZ");
      b.quaternion.setFromEuler(e);
    });
  }

  update(dt: number, intent: DoeIntent, time: number) {
    dt = Math.min(dt, 0.05);
    this.locomote(dt, intent);
    this.applyTransform();
    this.poseBody(dt, intent, time);
    this.bones[0].updateMatrixWorld(true);
    this.stepLegs(dt);
    for (const leg of this.legs) this.solveLeg(leg);
  }

  private locomote(dt: number, intent: DoeIntent) {
    let want = 0;
    if (intent.target) {
      const dx = intent.target.x - this.pos.x;
      const dz = intent.target.y - this.pos.y;
      const dist = Math.hypot(dx, dz);
      // ease in to a stop: v = sqrt(2 a d)
      want = Math.min(intent.speed, Math.sqrt(2 * 0.35 * Math.max(0, dist - 0.02)));
      if (dist > 0.05) {
        const head = Math.atan2(-dz, dx);
        const turn = wrapPi(head - this.heading);
        // she turns as she walks, never spinning on the spot; a big turn slows her
        const rate = 0.9 * Math.min(1, 0.35 + this.speed / 0.5);
        this.heading += THREE.MathUtils.clamp(turn, -rate * dt, rate * dt);
        want *= THREE.MathUtils.clamp(1.2 - Math.abs(turn) / 1.6, 0.3, 1);
      }
    } else if (intent.face !== null) {
      // standing: turn on the spot slowly (her feet settle under her as she does)
      const turn = wrapPi(intent.face - this.heading);
      this.heading += THREE.MathUtils.clamp(turn, -0.35 * dt, 0.35 * dt);
    }
    const acc = want > this.speed ? 0.5 : 0.7;
    this.speed += THREE.MathUtils.clamp(want - this.speed, -acc * dt, acc * dt);
    if (this.speed < 0.005 && want === 0) this.speed = 0;
    this.pos.x += Math.cos(this.heading) * this.speed * dt;
    this.pos.y += -Math.sin(this.heading) * this.speed * dt;
    this.walkW += ((this.speed > GAIT.amble ? 1 : 0) - this.walkW) * (1 - Math.exp(-dt * 4));
  }

  private stance(): number {
    const t = THREE.MathUtils.clamp((this.speed - 0.2) / 0.4, 0, 1);
    return GAIT.stance.slow + (GAIT.stance.walk - GAIT.stance.slow) * t;
  }

  private stepLegs(dt: number) {
    const walking = this.speed > GAIT.amble;
    if (walking) {
      const period = GAIT.swing + this.stance() / Math.max(this.speed, 0.05);
      const before = this.phase;
      this.phase = (this.phase + dt / period) % 1;
      for (const leg of this.legs) {
        // a leg's turn comes when the stride clock passes its offset
        const crossed = before <= this.phase ? before < leg.offset && leg.offset <= this.phase : leg.offset > before || leg.offset <= this.phase;
        if (crossed && leg.swingT < 0) this.startSwing(leg, GAIT.swing, this.stance() / 2, GAIT.lift[leg.kind]);
      }
    } else if (!this.legs.some((l) => l.swingT >= 0)) {
      // settling: the hoof furthest from its place steps there, one at a time
      let worst: Leg | null = null;
      let worstD: number = GAIT.settle;
      for (const leg of this.legs) {
        const d = this.neutralWorld(leg, v3).distanceTo(leg.planted);
        if (d > worstD) {
          worst = leg;
          worstD = d;
        }
      }
      if (worst) this.startSwing(worst, 0.42, 0, GAIT.lift[worst.kind] * 0.6);
      // the next stride starts with the leg after the last to move
      this.phase = 0.999;
    }
    for (const leg of this.legs) {
      if (leg.swingT < 0) continue;
      leg.swingT += dt;
      if (leg.swingT >= leg.swingDur) {
        leg.swingT = -1;
        leg.planted.copy(leg.to);
      }
    }
  }

  private startSwing(leg: Leg, dur: number, ahead: number, lift: number) {
    leg.swingT = 0;
    leg.swingDur = dur;
    leg.lift = lift;
    leg.from.copy(leg.planted);
    // where she will be when it lands
    FUTURE.set(this.pos.x + Math.cos(this.heading) * this.speed * dur, this.pos.y - Math.sin(this.heading) * this.speed * dur);
    this.neutralWorld(leg, leg.to, ahead, FUTURE, this.heading);
  }

  private poseBody(dt: number, intent: DoeIntent, time: number) {
    // a grazing deer lifts her head every so often to look about, for a few seconds
    if (intent.graze > 0.5 && this.walkW < 0.1) {
      if (this.check <= 0 && this.checkClock.step(dt)) this.check = this.rng.range(2, 4);
    }
    this.check = Math.max(0, this.check - dt);
    const grazeWant = intent.graze * (this.check > 0 ? 0 : 1);
    const k = 1 - Math.exp(-dt * 1.6);
    this.graze += (grazeWant * (1 - this.walkW) - this.graze) * k;
    this.browse += (intent.browse * (1 - this.walkW) - this.browse) * k;

    // the body rises and falls twice a stride, the croup more than the withers, a hair of roll
    const w = this.walkW;
    const croup = -GAIT.bob.croup * w * Math.cos(this.phase * Math.PI * 4);
    const withers = -GAIT.bob.withers * w * Math.cos(this.phase * Math.PI * 4 + 1.1);
    const pelvis = this.by("pelvis");
    const chest = this.by("chest");
    const loin = this.by("loin");
    const pivots = PIVOTS;
    pelvis.position.set(pivots.pelvis.x, pivots.pelvis.y + croup, 0);
    chest.position.set(pivots.chest.x - pivots.loin.x, pivots.chest.y - pivots.loin.y + withers - croup - GRAZE_CHEST.drop * this.graze, 0);
    q.setFromAxisAngle(X, 0.012 * w * Math.sin(this.phase * Math.PI * 2));
    pelvis.quaternion.copy(q);
    loin.quaternion.identity();
    // grazing shifts her weight forward a touch
    q.setFromAxisAngle(Z, GRAZE_CHEST.pitch * this.graze + 0.006 * w * Math.sin(this.phase * Math.PI * 4 + 1.2));
    chest.quaternion.copy(q);

    // the look, eased; never more than the neck will turn
    let wantYaw = 0;
    let wantPitch = 0;
    let wantW = 0;
    if (intent.look) {
      const head = this.by("head");
      head.getWorldPosition(v3b);
      v3.copy(intent.look).sub(v3b);
      // into her own frame
      v3.applyAxisAngle(Y, -this.heading);
      wantYaw = THREE.MathUtils.clamp(Math.atan2(-v3.z, v3.x), -1.15, 1.15);
      wantPitch = THREE.MathUtils.clamp(Math.atan2(v3.y, Math.hypot(v3.x, v3.z)) * 0.5, -0.3, 0.25);
      wantW = 1 - Math.max(this.graze, this.browse);
    } else if (this.check > 0) {
      // the check: a glance off to one side
      wantYaw = this.checkSide;
      wantPitch = 0.05;
      wantW = 1;
    }
    if (this.check <= 0) this.checkSide = this.rng.range(-0.8, 0.8);
    this.alert += ((wantW > 0.5 ? 1 : 0) - this.alert) * (1 - Math.exp(-dt * 3));
    const lk = 1 - Math.exp(-dt * 2.2);
    this.lookW += (wantW - this.lookW) * lk;
    this.lookYaw += (wantYaw - this.lookYaw) * lk;
    this.lookPitch += (wantPitch - this.lookPitch) * lk;

    // cropping the grass: a little tug of the head now and then
    if (this.graze > 0.6 && this.cropClock.step(dt)) this.crop = 1;
    this.crop = Math.max(0, this.crop - dt * 3.5);
    const tug = Math.sin(this.crop * Math.PI) * 0.06 * this.graze;

    const grazeK = this.lowerFor(0.03);
    const browseK = -0.08;
    const lower = grazeK * this.graze + browseK * this.browse;
    const nod = GAIT.nod * w * Math.sin(this.phase * Math.PI * 4 + 0.6);
    this.poseNeck(lower, this.browse * 0.6, this.lookYaw * this.lookW, this.lookPitch * this.lookW - nod + tug);

    // ears: up and forward when she is alert; otherwise each swivels on its own to listen, with a rare flick
    this.ears.forEach((ear, i) => {
      if (ear.clock.step(dt)) ear.target = this.rng.range(-0.45, 0.4);
      if (ear.flickClock.step(dt)) ear.flick = 1;
      ear.flick = Math.max(0, ear.flick - dt * 6);
      const target = ear.target * (1 - this.alert);
      ear.swivel += (target - ear.swivel) * (1 - Math.exp(-dt * 6));
      const b = this.by(`ear${ear.side}`);
      const flick = Math.sin(ear.flick * Math.PI) * 0.4;
      b.quaternion.identity().slerp(this.earAlert[i], this.alert);
      // swivel about the vertical (positive turns the opening back), the flick a quick twitch
      e.set(sideZ(ear.side) * flick, -sideZ(ear.side) * ear.swivel, 0, "YXZ");
      q2.setFromEuler(e);
      b.quaternion.premultiply(q2);
    });

    // tail: hangs, swishes now and then
    if (this.tail.clock.step(dt)) this.tail.swish = 1;
    this.tail.swish = Math.max(0, this.tail.swish - dt * 1.6);
    const sw = this.tail.swish > 0 ? Math.sin((1 - this.tail.swish) * Math.PI * 4) * Math.sin(this.tail.swish * Math.PI) * 0.5 : 0;
    const t0 = this.by("tail0");
    e.set(0, sw, 0.04 * Math.sin(time * 0.7), "YXZ");
    t0.quaternion.setFromEuler(e);
    q2.setFromAxisAngle(Y, sw * 0.6);
    this.by("tail1").quaternion.copy(q2);
  }

  /** How many hooves (for the contact shadows). */
  get feet() {
    return this.legs.length;
  }

  /** Hoof `i`'s place on the ground this frame (world, y 0), returning how high it is lifted. */
  foot(i: number, out: THREE.Vector3): number {
    this.hoof(this.legs[i], out);
    const h = out.y;
    out.y = 0;
    return h;
  }

  /** Where a leg's hoof is this frame (world); its curl and fold go in `swingPose`. */
  private readonly swingPose = { curl: 0, fold: 0 };
  private hoof(leg: Leg, out: THREE.Vector3): { curl: number; fold: number } {
    const p = this.swingPose;
    if (leg.swingT < 0) {
      out.copy(leg.planted);
      p.curl = 0;
      p.fold = 0;
      return p;
    }
    const x = THREE.MathUtils.clamp(leg.swingT / leg.swingDur, 0, 1);
    // the hoof leaves late and reaches forward early: lift peaks before mid-swing on a foreleg
    const xl = leg.kind === "fore" ? Math.pow(x, 0.8) : x;
    out.lerpVectors(leg.from, leg.to, ease(x));
    out.y += leg.lift * Math.pow(Math.sin(Math.PI * xl), 1.4);
    const bell = Math.pow(Math.sin(Math.PI * xl), 1.2);
    const scale = Math.min(1, leg.lift / GAIT.lift[leg.kind]);
    p.curl = GAIT.curl[leg.kind] * bell * scale;
    p.fold = GAIT.fold[leg.kind] * bell * scale;
    return p;
  }

  private solveLeg(leg: Leg) {
    const { curl, fold } = this.hoof(leg, v3);
    // into the parent bone's frame
    leg.parent.updateWorldMatrix(true, false);
    m4.copy(leg.parent.matrixWorld).invert();
    v3.applyMatrix4(m4);
    const tx = v3.x - leg.root.x;
    const ty = v3.y - leg.root.y;
    // the parent's pitch against her own frame, so a planted pastern stays flat on the ground
    v3b.set(1, 0, 0).transformDirection(leg.parent.matrixWorld).applyAxisAngle(Y, -this.heading);
    const pitch = Math.atan2(v3b.y, v3b.x);
    const [lA, lB, lC, lD] = leg.len;
    const angD = leg.ang0[3] - curl - pitch;
    const fx = tx - lD * Math.cos(angD);
    const fy = ty - lD * Math.sin(angD);
    const theta = leg.theta0 - fold * (leg.kind === "fore" ? 1 : -1);
    const wx = lA + lC * Math.cos(theta);
    const wy = lC * Math.sin(theta);
    const lW = Math.hypot(wx, wy);
    const phi = Math.atan2(wy, wx);
    const dRaw = Math.hypot(fx, fy);
    const d = THREE.MathUtils.clamp(dRaw, Math.abs(lW - lB) + 1e-4, (lW + lB) * 0.9995);
    const gamma = Math.atan2(fy, fx);
    const fxn = Math.cos(gamma) * d;
    const fyn = Math.sin(gamma) * d;
    const beta = Math.acos(THREE.MathUtils.clamp((lW * lW + d * d - lB * lB) / (2 * lW * d), -1, 1));
    let angW = gamma + beta;
    let bx = 0;
    let by = 0;
    for (const sg of [1, -1]) {
      angW = gamma + sg * beta;
      const Wx = lW * Math.cos(angW);
      const Wy = lW * Math.sin(angW);
      bx = fxn - Wx;
      by = fyn - Wy;
      if (Math.sign(Wx * by - Wy * bx) === leg.bend) break;
    }
    const angA = angW - phi;
    const angB = Math.atan2(by, bx);
    const angC = angA + theta;
    const dA = angA - leg.ang0[0];
    const dB = angB - leg.ang0[1];
    const dC = angC - leg.ang0[2];
    const dD = angD - leg.ang0[3];
    const rel = [dA, dB - dA, dC - dB, dD - dC];
    leg.bones.forEach((b, i) => b.quaternion.setFromAxisAngle(Z, wrapPi(rel[i])));
  }
}

const PIVOTS = restPivots();
