// Mutable per-frame environment shared by every part of the scene:
// where the sun is, what colour the sky is, how windy, how wet.
// Written once per frame by <Clock/>, read by everything else inside useFrame.
// `date`, `sun` and `sky` are long-lived objects rewritten in place each frame
// (sunInfo and skyState fill one shared result), so readers copy, never keep.
import * as THREE from "three";
import { istDateAt, istTimeAt, skyState, sunInfo, type SkyState, type SunInfo } from "@/lib/sky/sun";

const startDate = istDateAt(12);
const startSun = sunInfo(startDate);

export const env = {
  /** seconds since the canvas mounted */
  time: 0,
  dt: 0,
  hour: 12,
  date: startDate,
  sun: startSun as SunInfo,
  sky: skyState(startSun.altitude, 0, 12, 0) as SkyState,
  cloud: 0,
  rain: 0,
  wind: 0.5,
  /** 0 full day .. 1 deep night */
  nightness: 0,
  /** world position of the flower head, for focus and glow */
  headPos: new THREE.Vector3(0, 0.9, 0),
  /** where the depth of field focuses instead of the flower head, while something else holds the eye (the party trailer) */
  focus: null as THREE.Vector3 | null,
};

export function updateEnv(hour: number, cloud: number, rain: number, wind: number, time: number, dt: number) {
  env.time = time;
  env.dt = dt;
  env.hour = hour;
  env.date.setTime(istTimeAt(hour));
  env.sun = sunInfo(env.date);
  env.sky = skyState(env.sun.altitude, cloud, hour, rain);
  env.cloud = cloud;
  env.rain = rain;
  env.wind = wind;
  env.nightness = env.sky.nightness;
}
