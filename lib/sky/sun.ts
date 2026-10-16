// Real sun and moon over Bangalore, and the sky colours that follow them.
// sunInfo() and skyState() run once per frame from the clock, so each fills
// and returns one persistent result object instead of allocating: consumers
// copy the vectors and colours they keep and never hold a previous frame's.
//
// SunCalc 2.x reports altitude and azimuth in DEGREES, azimuth clockwise from
// north (0 N, 90 E, 180 S, 270 W). Everything handed out of this module is in
// radians, with the compass turned by WORLD_YAW so the garden faces the light.
import * as SunCalc from "suncalc";
import * as THREE from "three";

export const BANGALORE = { lat: 12.9716, lon: 77.5946, tz: 5.5 };

const DEG = Math.PI / 180;

/**
 * Rotates the compass so the evening sun (azimuth 255..265 deg in October)
 * sits behind-left of the flower as seen from the default camera on +z,
 * about 70 deg off the view axis: a three-quarter backlight that rims the
 * petals through golden hour. That bearing clears the wall of tree canopies
 * in LAYOUT (which cover 10..66 deg left of the axis at the height the low
 * sun's rays cross them) and comes in past the last tree, over the fence,
 * so the garden is lit rather than lost in canopy shade. The morning sun
 * rises front-right and noon stands high over the camera's left shoulder.
 */
const WORLD_YAW = 32 * DEG;

/** Scratch date for the calendar arithmetic below; never handed out. */
const scratch = new Date();

/** Current hour of day in Bangalore, fractional. */
export function istNow(): number {
  scratch.setTime(Date.now() + BANGALORE.tz * 3600e3);
  return scratch.getUTCHours() + scratch.getUTCMinutes() / 60 + scratch.getUTCSeconds() / 3600;
}

/** Milliseconds since the epoch of today's date in Bangalore at the given fractional hour. */
export function istTimeAt(hour: number, baseMs = Date.now()): number {
  scratch.setTime(baseMs + BANGALORE.tz * 3600e3);
  const day = Date.UTC(scratch.getUTCFullYear(), scratch.getUTCMonth(), scratch.getUTCDate());
  return day + (hour - BANGALORE.tz) * 3600e3;
}

/** Today's date in Bangalore at the given fractional hour. */
export function istDateAt(hour: number, base?: Date): Date {
  return new Date(istTimeAt(hour, base ? base.getTime() : Date.now()));
}

export interface SunInfo {
  /** radians above the horizon */
  altitude: number;
  /** radians clockwise from north */
  azimuth: number;
  /** unit vector pointing at the sun, world space */
  dir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** radians above the horizon */
  moonAltitude: number;
  moonFraction: number;
}

/**
 * World direction of a body at the given altitude and compass azimuth (both
 * radians, azimuth clockwise from north). North is -z and east is +x before
 * the yaw, so a viewer on +z looking at the origin faces north.
 */
function dirFrom(out: THREE.Vector3, alt: number, az: number): THREE.Vector3 {
  const a = az + WORLD_YAW;
  const c = Math.cos(alt);
  return out.set(Math.sin(a) * c, Math.sin(alt), -Math.cos(a) * c).normalize();
}

const sunResult: SunInfo = {
  altitude: 0,
  azimuth: 0,
  dir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, 1, 0),
  moonAltitude: 0,
  moonFraction: 0,
};

/** Fills and returns the one shared SunInfo; copy what you keep. */
export function sunInfo(date: Date): SunInfo {
  const p = SunCalc.getPosition(date, BANGALORE.lat, BANGALORE.lon);
  const m = SunCalc.getMoonPosition(date, BANGALORE.lat, BANGALORE.lon);
  const illum = SunCalc.getMoonIllumination(date);
  const r = sunResult;
  r.altitude = p.altitude * DEG;
  r.azimuth = p.azimuth * DEG;
  dirFrom(r.dir, r.altitude, r.azimuth);
  r.moonAltitude = m.altitude * DEG;
  dirFrom(r.moonDir, r.moonAltitude, m.azimuth * DEG);
  r.moonFraction = illum.fraction;
  return r;
}

export interface SkyState {
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** warm glow that pools on the horizon: sunset fire by day, city light at night */
  glow: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  /** 0 clear .. 1 thick: how close the fog sits, by time of day and weather */
  haze: number;
  /** 0 full day .. 1 deep night */
  nightness: number;
  stars: number;
  sunDisc: number;
}

interface Key {
  alt: number;
  zenith: string;
  horizon: string;
  glow: string;
  sun: string;
  sunI: number;
  night: number;
  hemiI: number;
}

/**
 * Colour and intensity keys by sun altitude in degrees. The low keys carry
 * golden hour: a saturated amber key (about #ffb060 a few degrees up) under a
 * dim sky so the long shadows read; the high keys a slightly warm, restrained
 * noon under a clear blue sky.
 */
const KEYS: Key[] = [
  { alt: -18, zenith: "#0a1038", horizon: "#272a4a", glow: "#5c4432", sun: "#000000", sunI: 0, night: 1, hemiI: 0.36 },
  { alt: -10, zenith: "#0d1646", horizon: "#353256", glow: "#7a5038", sun: "#ff7040", sunI: 0, night: 0.95, hemiI: 0.36 },
  { alt: -5, zenith: "#1a2a66", horizon: "#9a5a5c", glow: "#e8704a", sun: "#ff6a3a", sunI: 0.25, night: 0.7, hemiI: 0.33 },
  { alt: 0, zenith: "#30508f", horizon: "#f09a62", glow: "#ff8a46", sun: "#ff8640", sunI: 1.5, night: 0.4, hemiI: 0.3 },
  { alt: 5, zenith: "#4672b8", horizon: "#ffbd84", glow: "#ffa860", sun: "#ffa854", sunI: 2.5, night: 0.14, hemiI: 0.3 },
  { alt: 12, zenith: "#4483cc", horizon: "#f0cfa8", glow: "#ffc88c", sun: "#ffc27c", sunI: 2.9, night: 0.03, hemiI: 0.38 },
  { alt: 25, zenith: "#3c84d6", horizon: "#c4dbf2", glow: "#e8e2d8", sun: "#ffe6c4", sunI: 3.0, night: 0, hemiI: 0.55 },
  { alt: 60, zenith: "#2c78d6", horizon: "#b8d4f0", glow: "#dde6ee", sun: "#fff1e0", sunI: 3.0, night: 0, hemiI: 0.6 },
];

const CLOUD_ZENITH = new THREE.Color("#7d8794");
const CLOUD_HORIZON = new THREE.Color("#c3c9d1");
const CLOUD_SUN = new THREE.Color("#ffffff");
const GROUND = new THREE.Color("#2a3a1a");
/** Hemisphere pair for deep night: a deep blue sky over dark green turf, bright enough that the lawn still reads. */
const NIGHT_HEMI_SKY = new THREE.Color("#4668b8");
const NIGHT_HEMI_GROUND = new THREE.Color("#12240f");

const tmpB = new THREE.Color();

function lerpHex(out: THREE.Color, a: string, b: string, t: number): THREE.Color {
  return out.set(a).lerp(tmpB.set(b), t);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

const skyResult: SkyState = {
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  glow: new THREE.Color(),
  sun: new THREE.Color(),
  sunIntensity: 0,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0,
  fog: new THREE.Color(),
  haze: 0.2,
  nightness: 0,
  stars: 0,
  sunDisc: 0,
};

/**
 * Fills and returns the one shared SkyState; copy what you keep.
 * `hour` (Bangalore, fractional) and `rain` only shape the haze: mornings
 * start soft and milky, noon is clear, dusk is a blue veil.
 */
export function skyState(altitudeRad: number, cloud: number, hour = 12, rain = 0): SkyState {
  const alt = altitudeRad / DEG;
  let a = KEYS[0];
  let b = KEYS[KEYS.length - 1];
  let t = 0;
  if (alt <= KEYS[0].alt) {
    a = b = KEYS[0];
  } else if (alt >= KEYS[KEYS.length - 1].alt) {
    a = b = KEYS[KEYS.length - 1];
  } else {
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (alt >= KEYS[i].alt && alt < KEYS[i + 1].alt) {
        a = KEYS[i];
        b = KEYS[i + 1];
        t = (alt - a.alt) / (b.alt - a.alt);
        break;
      }
    }
  }
  const r = skyResult;
  const zenith = lerpHex(r.zenith, a.zenith, b.zenith, t);
  const horizon = lerpHex(r.horizon, a.horizon, b.horizon, t);
  const glow = lerpHex(r.glow, a.glow, b.glow, t);
  const sun = lerpHex(r.sun, a.sun, b.sun, t);
  let sunIntensity = a.sunI + (b.sunI - a.sunI) * t;
  const nightness = a.night + (b.night - a.night) * t;
  let hemiIntensity = a.hemiI + (b.hemiI - a.hemiI) * t;

  const day = 1 - nightness;
  const c = Math.pow(clamp01(cloud), 1.1);
  zenith.lerp(CLOUD_ZENITH, c * 0.85 * day);
  horizon.lerp(CLOUD_HORIZON, c * 0.8 * day);
  glow.lerp(CLOUD_HORIZON, c * 0.7 * day);
  sun.lerp(CLOUD_SUN, c * 0.6);
  sunIntensity *= 1 - 0.85 * c;
  hemiIntensity *= 1 + 0.25 * c;

  // Sky bounce: a blend of the dome by day, a defined deep blue over dark turf at night.
  r.hemiSky.copy(zenith).lerp(horizon, 0.45).lerp(NIGHT_HEMI_SKY, nightness * 0.8);
  r.hemiGround
    .copy(GROUND)
    .lerp(horizon, 0.25)
    .multiplyScalar(0.6 + 0.4 * day)
    .lerp(NIGHT_HEMI_GROUND, nightness * 0.8);
  r.fog.copy(horizon).lerp(zenith, 0.3 + 0.2 * nightness);

  // Haze: soft morning, clear noon, a clear golden evening, blue dusk, a close
  // dark night; weather thickens it. The evening stays clear on purpose: a
  // thick veil under a low sun washes the garden pink-grey and kills the
  // backlight, and golden hour is the scene's money shot. With the default
  // light cloud it holds at about 0.25 through golden hour.
  const lowSun = 1 - smooth(0, 22, alt);
  const morning = hour < 12 ? 1 : 0;
  let haze = 0.1 + lowSun * (morning ? 0.72 : 0.07) * day;
  haze += nightness * 0.32;
  haze += c * 0.25 + clamp01(rain) * 0.3;

  r.sunIntensity = sunIntensity;
  r.hemiIntensity = hemiIntensity;
  r.haze = clamp01(haze);
  r.nightness = nightness;
  r.stars = nightness * (1 - c);
  r.sunDisc = (1 - c) * clamp01((alt + 2) / 6);
  return r;
}
