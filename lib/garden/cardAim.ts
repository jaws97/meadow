// Where the bloom card's camera stands (components/garden/CardCamera), solved from the flower as it is drawn: which way
// its face points (the head's own axis, which the stem's seeded lean and the head's tilt decide, so it differs from seed
// to seed), and the open bloom's silhouette as the card will see it. Pure, so it is tested without a browser.
//
// The card is 4:5 with a long lens. The camera keeps to the side the garden is lit for (a little right of the garden's
// front, nearly level with the bloom, so the golden sky and the far trees stand behind it), unless that would see the
// bloom too far from its face; then it stands where, on that side, the face is best seen. A cup (rose, magnolia) is
// lovely from the side, a flat star (jasmine) only face on. A bloom whose stem leans it away from the lit side (a
// jasmine leaning into the bed) is seen from wherever its face is, all round the flower, rather than from behind; and
// wherever it stands, the camera keeps clear of the hedges, the arch and the trees (lib/garden/room, asked through
// `roomOk` and `room`). Then the bloom is framed by its silhouette from there (every point of the drawn head, flattened
// onto the card): its middle a little above the card's, clear of the words at the foot, and as large as fills its share
// of the card's width without growing taller than its share of the height.
import * as THREE from "three";
import type { SpeciesId } from "@/lib/plant/species";

export const CARD_FOV = 30;
export const CARD_ASPECT = 0.8;

const deg = THREE.MathUtils.degToRad;

/** How far from the bloom's face the camera may stand (radians off its axis). */
const FACE: Record<Exclude<SpeciesId, "lotus">, number> = {
  rose: deg(72),
  sundrop: deg(50),
  magnolia: deg(70),
  marigold: deg(58),
  island: deg(60),
  jasmine: deg(22),
  lily: deg(48),
};

/**
 * The view the garden is lit for: from the garden's front (+z), a little to the right, and nearly level with the bloom,
 * so the golden sky and the far trees stand behind it rather than the dark of the bed.
 */
const PREFER = { azimuth: 0.25, elevation: deg(6) };
/** Kept within: never from underneath or straight down, and on the garden's lit side. */
const ELEVATION = [deg(3), deg(60)] as const;
const AZIMUTH = [-0.7, 1.1] as const;
/** On the lit side, a view this much farther from the face than the species allows is still taken; past it, all round. */
const SIDE_SLACK = deg(15);
/** The searches' steps: fine for the view, coarse when the room has to be asked of every candidate. */
const FINE = { azimuth: 0.02, elevation: deg(1) };
const COARSE = { azimuth: 0.06, elevation: deg(3) };
/** The bloom's share of the card's width and of its height, and where its middle sits (NDC y, up is +). */
const SHARE = { width: 0.52, height: 0.42 };
const RAISE = 0.2;
const DISTANCE = [0.6, 3.4] as const;

/** A lotus: seen from the courtyard's front, over the pond, a little higher than a bed flower. */
const LOTUS = { azimuth: 0.12, elevation: deg(30), size: 0.3 };

export interface CardPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** The bloom as the card sees it: the middle of its silhouette, and how wide and tall that is (m). */
export interface Silhouette {
  centre: THREE.Vector3;
  width: number;
  height: number;
}

const p = new THREE.Vector3();
const n = new THREE.Vector3();
const w = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();

function fromAngles(azimuth: number, elevation: number, out: THREE.Vector3): THREE.Vector3 {
  const flat = Math.cos(elevation);
  return out.set(Math.sin(azimuth) * flat, Math.sin(elevation), Math.cos(azimuth) * flat);
}

/** The card's right and up, for a camera looking back along `dir` (unit, bloom to camera). */
function basis(dir: THREE.Vector3) {
  right.set(0, 1, 0).cross(dir).normalize();
  up.copy(dir).cross(right).normalize();
}

/** Whether the camera has room to stand this way from the bloom (true when nothing is in the way). */
export type RoomOk = (dir: THREE.Vector3) => boolean;

/** How far outside the lit side an azimuth lies (rad). */
const outside = (azimuth: number) => Math.max(0, AZIMUTH[0] - azimuth, azimuth - AZIMUTH[1]);

/**
 * The best direction over a grid of azimuths and the elevation limits: the face first (how far past `face` it is seen
 * counts most), then the lit side, then the preferred view; with `roomOk`, a direction without room counts least of
 * all. Returns how far past `face` the chosen view is.
 */
function search(face: number, az: readonly [number, number], step: typeof FINE, roomOk: RoomOk | null, out: THREE.Vector3): number {
  let best = Infinity;
  for (let a = az[0]; a <= az[1] + 1e-9; a += step.azimuth) {
    for (let e = ELEVATION[0]; e <= ELEVATION[1] + 1e-9; e += step.elevation) {
      fromAngles(a, e, w);
      let score = 8 * Math.max(0, w.angleTo(n) - face) + outside(a) + 0.5 * w.angleTo(p);
      if (score >= best) continue;
      if (roomOk && !roomOk(w)) score += 100;
      if (score < best) {
        best = score;
        out.copy(w);
      }
    }
  }
  return Math.max(0, out.angleTo(n) - face);
}

/**
 * The direction from the bloom to the camera: the preferred view while it sees the bloom within `face` of its axis;
 * else the best view of the face on the lit side, if that is no more than a little past `face`; else the best view of
 * it from all round the flower. With `roomOk`, a view the scenery leaves no room for is passed over.
 */
export function cardDirection(axis: THREE.Vector3, face: number, out: THREE.Vector3, roomOk: RoomOk = () => true): THREE.Vector3 {
  fromAngles(PREFER.azimuth, PREFER.elevation, p);
  n.copy(axis).normalize();
  if (n.angleTo(p) <= face && roomOk(p)) return out.copy(p);
  if (search(face, AZIMUTH, FINE, null, out) <= SIDE_SLACK && roomOk(out)) return out;
  search(face, [-Math.PI, Math.PI], FINE, null, out);
  if (roomOk(out)) return out;
  search(face, [-Math.PI, Math.PI], COARSE, roomOk, out);
  return out;
}

/** The direction a flower is seen from for the card. */
export function cardDirectionFor(species: SpeciesId, axis: THREE.Vector3, out: THREE.Vector3, roomOk?: RoomOk): THREE.Vector3 {
  if (species === "lotus") return fromAngles(LOTUS.azimuth, LOTUS.elevation, out);
  return cardDirection(axis, FACE[species], out, roomOk);
}

/**
 * The silhouette of these points seen from `dir`: each point is flattened onto the card's plane, and the middle of
 * what they cover is put back at their middle depth. `each` calls back with every point (world space).
 */
export function silhouette(each: (visit: (pt: THREE.Vector3) => void) => void, dir: THREE.Vector3, out: Silhouette): Silhouette {
  basis(dir);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  each((pt) => {
    const x = pt.dot(right);
    const y = pt.dot(up);
    const z = pt.dot(dir);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  });
  if (!Number.isFinite(x0)) {
    out.width = 0;
    out.height = 0;
    return out;
  }
  out.centre
    .set(0, 0, 0)
    .addScaledVector(right, (x0 + x1) / 2)
    .addScaledVector(up, (y0 + y1) / 2)
    .addScaledVector(dir, (z0 + z1) / 2);
  out.width = x1 - x0;
  out.height = y1 - y0;
  return out;
}

/** How far from the bloom the camera stands for this silhouette (m). */
export function cardDistance(s: Pick<Silhouette, "width" | "height">): number {
  const half = Math.tan(deg(CARD_FOV) / 2);
  const byWidth = s.width / (SHARE.width * 2 * half * CARD_ASPECT);
  const byHeight = s.height / (SHARE.height * 2 * half);
  return THREE.MathUtils.clamp(Math.max(byWidth, byHeight), DISTANCE[0], DISTANCE[1]);
}

/**
 * The camera for a silhouette seen from `dir`: far enough that the bloom fills its share of the card's width without
 * growing taller than its share of the height (no farther than `room` says there is room for that way, if given),
 * aimed low enough that it sits above the words.
 */
export function cardPoseFrom(s: Silhouette, dir: THREE.Vector3, out: CardPose, room?: (want: number) => number): CardPose {
  const half = Math.tan(deg(CARD_FOV) / 2);
  const want = cardDistance(s);
  const d = room ? Math.max(DISTANCE[0], Math.min(want, room(want))) : want;
  out.position.copy(s.centre).addScaledVector(dir, d);
  basis(dir);
  out.target.copy(s.centre).addScaledVector(up, -RAISE * d * half);
  out.fov = CARD_FOV;
  return out;
}

/** The card's shot of a lotus's flower standing over its pond (its head drawn by the courtyard, not as a bed flower's). */
export function aimLotus(head: THREE.Vector3, out: CardPose): CardPose {
  const dir = cardDirectionFor("lotus", n, new THREE.Vector3());
  return cardPoseFrom({ centre: head, width: LOTUS.size, height: LOTUS.size * 0.8 }, dir, out);
}
