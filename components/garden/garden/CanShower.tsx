"use client";
/* eslint-disable react-hooks/immutability --
   The shower's uniforms, its veil's geometry and material are three.js objects written in the frame loop from the
   moment's record (canLive), which is how an R3F part animates without re-rendering. */
// The water from the watering can's rose (canMoment, canLive): a fine shower of drops falling from the tipped can onto
// the saucer, a scatter of small splashes and rings where they land, and the last two or three drops swelling on the
// rose's rim and falling as the can is righted and carried home (the last of them often onto the kerb). The drops are
// short streaks along their fall, as the garden's rain is; a few catch the light, the sky's by day and the lantern's
// warmth by night, so the water never vanishes in the dark. Behind them hangs the veil, a soft sheet of falling water
// from the rose to the saucer with streaks running down it, which is what lets a shower a few pixels across read as
// water on a small screen; it fills in after the first few heavier drops and thins with the last of the pour.
//
// Every drop's path is worked out in its vertex shader from a handful of uniforms (its birth on its own cycle while
// the can pours, a cone round the spout's line, gravity, the ground it falls to), so the CPU writes about twenty
// values a frame and allocates nothing. Mounted from the start, so the opening compiles its programs with the rest of
// the garden, and drawn unseen for its first frames after the garden shows, so its first real draw costs nothing;
// after that it is drawn only while water is in the air. It adds no light.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { lampUniforms } from "@/lib/garden/dressing";
import { env } from "@/lib/garden/env";
import { quality as qualityStore, underVeil } from "@/lib/garden/quality";
import type { Quality } from "@/lib/garden/store";
import { Rng } from "@/lib/plant/prng";
import { canLive, DRIP_SLOTS, DRIP_SWELL } from "@/components/garden/garden/canLive";
import { CAN_HAND, CAN_ROSE, EXIT_SPEED, GRAVITY } from "@/components/garden/garden/canMoment";
import { weather } from "@/components/garden/garden/weather";
import { useLayerFrame } from "@/components/garden/TierLayers";

/** Drops in the shower and splashes where it lands, per tier: richer tiers add density, never extra beats. */
const COUNTS: Record<Quality, { drops: number; splashes: number }> = {
  cinematic: { drops: 220, splashes: 36 },
  balanced: { drops: 150, splashes: 24 },
  lite: { drops: 96, splashes: 16 },
};

/** Frames the shower is drawn (unseen) after the garden shows, so its first real draw is free. */
const WARM_FRAMES = 90;
/** The shower's half-angle round the spout's line (rad): a rose's fine fan. */
const SPREAD = 0.24;
/** A drop's world size (m): its streak, a splash's ring, a bead on the rim. */
const DROP_SIZE = 0.022;
const WATER = new THREE.Color("#e4edf7");
const WHITE = new THREE.Color(1, 1, 1);

const VERTEX = /* glsl */ `
  uniform float uT;
  uniform float uFlowFrom;
  uniform float uStopAt;
  uniform float uStopFade;
  uniform float uSpeed;
  uniform float uSpread;
  uniform float uFloorY;
  uniform float uScale;
  uniform float uPixelRatio;
  uniform float uAspect;
  uniform float uSwell;
  uniform vec3 uRose;
  uniform vec3 uRoseVel;
  uniform vec3 uDir;
  uniform vec3 uSide;
  uniform vec3 uUp;
  uniform vec3 uLand;
  uniform vec3 uHang;
  uniform vec4 uDrip0;
  uniform vec4 uDrip1;
  uniform vec4 uDrip2;
  uniform vec4 uDrip3;
  uniform vec3 uDripV0;
  uniform vec3 uDripV1;
  uniform vec3 uDripV2;
  uniform vec3 uDripV3;
  uniform vec4 uDripDue;
  uniform vec4 uDripFloor;
  attribute vec4 aSeed;
  attribute float aKind;
  attribute float aSlot;
  varying float vAlpha;
  varying float vKind;
  varying float vPhase;
  varying float vSquash;
  varying float vSpark;
  varying vec2 vDir;
  varying float vSharp;

  const vec3 G = vec3(0.0, -${GRAVITY.toFixed(2)}, 0.0);

  // the water from the rose for a drop born at b (s from the press): its first heavier drops, the full shower, the last
  float flowAt(float b) {
    if (uStopAt < 0.0) return 0.0;
    return smoothstep(uFlowFrom, uFlowFrom + 0.25, b) * (1.0 - smoothstep(uStopAt, uStopAt + uStopFade, b));
  }

  float hash(float n) { return fract(sin(n) * 43758.5453); }

  void main() {
    vec3 p = uRose;
    vec3 vel = vec3(0.0, -1.0, 0.0);
    float alpha = 0.0;
    float size = 1.0;
    float kind = aKind;
    vPhase = 0.0;
    vSquash = 1.0;
    // which drops catch the light: their own random, not where they sit in the fan
    vSpark = hash(aSeed.x * 173.1 + aSeed.y * 51.7);

    if (aKind < 0.5) {
      // a drop of the shower, born at the rose on its own cycle while the can pours
      float cycle = 0.3;
      float b = floor((uT - aSeed.x * cycle) / cycle) * cycle + aSeed.x * cycle;
      float age = uT - b;
      float f = flowAt(b);
      // the first few drops are heavier, and the last of it is a dribble of bigger drops in a narrower fan
      float spit = 1.0 - smoothstep(uFlowFrom + 0.1, uFlowFrom + 0.25, b);
      vec2 j = aSeed.zw * 2.0 - 1.0;
      vec3 d = normalize(uDir + (uSide * j.x + uUp * j.y) * uSpread * mix(0.5, 1.0, f));
      vec3 v0 = d * uSpeed * (0.85 + 0.3 * hash(aSeed.x * 91.7 + aSeed.y * 13.1));
      // from its hole in the rose's face, back where the rose was when it was born
      vec3 p0 = uRose - uRoseVel * age + (uSide * j.y - uUp * j.x) * 0.011;
      p = p0 + v0 * age + 0.5 * G * age * age;
      vel = v0 + G * age;
      float fall = max(0.0, p0.y - uFloorY);
      float flight = (v0.y + sqrt(v0.y * v0.y + 2.0 * ${GRAVITY.toFixed(2)} * fall)) / ${GRAVITY.toFixed(2)};
      alpha = step(aSeed.y, f) * step(age, flight) * smoothstep(0.0, 0.03, age);
      size = mix(1.0, 1.5, spit) * mix(1.3, 1.0, f);
    } else if (aKind < 1.5) {
      // a splash where the shower lands: a quick flash and a ring, each on its own quick cycle
      float rate = 6.0 + 4.0 * aSeed.x;
      float cyc = floor(uT * rate + aSeed.y * 10.0);
      float ph = fract(uT * rate + aSeed.y * 10.0);
      float f = flowAt(uT - 0.17);
      float on = step(1.0 - f * 0.85, hash(cyc * 12.9898 + aSeed.z * 78.233));
      vec2 j = aSeed.zw * 2.0 - 1.0;
      vec3 along = normalize(vec3(uDir.x, 0.0, uDir.z) + vec3(1e-4, 0.0, 0.0));
      vec3 across = vec3(-along.z, 0.0, along.x);
      p = uLand + along * j.x * 0.032 + across * j.y * 0.026;
      p.y = uFloorY + 0.003;
      vPhase = ph;
      alpha = on * pow(1.0 - ph, 1.4) * 0.8;
      size = 0.45 + 0.75 * ph;
    } else {
      // one of the last drops: swelling on the rose's rim, falling free, one flash where it lands
      vec4 dr = uDrip0;
      vec3 dv = uDripV0;
      float due = uDripDue.x;
      float floorY = uDripFloor.x;
      if (aSlot > 0.5 && aSlot < 1.5) { dr = uDrip1; dv = uDripV1; due = uDripDue.y; floorY = uDripFloor.y; }
      if (aSlot > 1.5 && aSlot < 2.5) { dr = uDrip2; dv = uDripV2; due = uDripDue.z; floorY = uDripFloor.z; }
      if (aSlot > 2.5) { dr = uDrip3; dv = uDripV3; due = uDripDue.w; floorY = uDripFloor.w; }
      if (due >= 0.0 && uT < due) {
        float sw = smoothstep(due - uSwell, due, uT);
        p = uHang - vec3(0.0, 0.004 * sw, 0.0);
        alpha = sw * step(due - uSwell, uT);
        size = 0.25 + 0.2 * sw;
        kind = 3.0;
      } else if (due >= 0.0 && dr.w >= 0.0) {
        // it leaves the rim moving as the rose was, then falls
        float age = uT - dr.w;
        float g = ${GRAVITY.toFixed(2)};
        float flight = (dv.y + sqrt(dv.y * dv.y + 2.0 * g * max(0.0, dr.y - floorY))) / g;
        if (age < flight) {
          p = dr.xyz + dv * age + 0.5 * G * age * age;
          vel = dv + G * age;
          alpha = 1.0;
          size = 0.8;
          kind = 2.0;
        } else {
          float ph = clamp((age - flight) / 0.4, 0.0, 1.0);
          p = vec3(dr.x + dv.x * flight, floorY + 0.003, dr.z + dv.z * flight);
          alpha = (1.0 - ph) * step(age - flight, 0.4) * 0.8;
          size = 0.45 + 0.6 * ph;
          vPhase = ph;
          kind = 1.0;
        }
      }
    }
    vKind = kind;
    if (kind > 0.5 && kind < 1.5) {
      // a ring lies on the ground, so from the camera's height it is an ellipse
      vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
      vSquash = max(0.15, abs(normalize(cameraPosition - wp).y));
    }

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float depth = max(0.05, -mv.z);
    if (kind > 0.5 && kind < 1.5) {
      // a ring lies on uneven mulch: it is depth-tested a little nearer the camera, along its own ray, so the ground's
      // lumps never cut its near side (its size and its place on the screen stay as they are)
      mv.xyz += normalize(-mv.xyz) * (0.012 + 0.6 * ${DROP_SIZE.toFixed(3)} * size);
    }
    vec4 c0 = projectionMatrix * mv;
    // a falling drop's motion on the screen, for its streak
    vec4 c1 = projectionMatrix * modelViewMatrix * vec4(p + vel * 0.02, 1.0);
    vec2 dd = c1.xy / c1.w - c0.xy / c0.w;
    dd.x *= uAspect;
    vDir = normalize(dd + vec2(0.0, -1e-5));

    float px = ${DROP_SIZE.toFixed(3)} * size * uScale / depth;
    // never thinner than a pixel and a half: a drop below that reads as nothing on a phone, so it fades a little instead
    float least = 1.6 * uPixelRatio;
    alpha *= mix(0.55, 1.0, smoothstep(least, least * 2.0, px));
    // a streak as fine as a drop up close, and never finer than about a pixel and a half far off
    vSharp = clamp(pow(px * 0.9, 2.0), 28.0, 420.0);
    vAlpha = alpha;
    gl_PointSize = alpha > 0.0 ? clamp(px, least, 64.0 * uPixelRatio) : 0.0;
    gl_Position = alpha > 0.0 ? c0 : vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uWarm;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vKind;
  varying float vPhase;
  varying float vSquash;
  varying float vSpark;
  varying vec2 vDir;
  varying float vSharp;

  void main() {
    vec2 c = (gl_PointCoord - 0.5) * 2.0;
    float a = 0.0;
    if (vKind < 0.5 || (vKind > 1.5 && vKind < 2.5)) {
      // a falling drop: a short streak along its fall, brightest at its head
      vec2 cs = vec2(c.x, -c.y);
      vec2 perp = vec2(vDir.y, -vDir.x);
      vec2 q = vec2(dot(cs, perp), dot(cs, vDir));
      float across = exp(-q.x * q.x * vSharp);
      float along = 1.0 - smoothstep(0.45, 1.0, abs(q.y));
      float head = 0.4 + 0.6 * smoothstep(-1.0, 0.6, q.y);
      a = across * along * head;
    } else if (vKind < 1.5) {
      // a splash: a quick flash at its heart and a ring spreading on the ground
      vec2 q = vec2(c.x, c.y / vSquash);
      float rr = length(q);
      float ring = exp(-pow((rr - 0.72) * 7.0, 2.0)) * (1.0 - smoothstep(0.9, 1.0, rr));
      float flash = exp(-rr * rr * 16.0) * (1.0 - smoothstep(0.0, 0.35, vPhase));
      a = ring * 0.6 + flash;
    } else {
      // a drop hanging on the rim: a small bead with a bright point
      float r = length(c);
      a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
    }
    // a few catch the light: the sky's glint by day, the lantern's warmth by night
    float glint = smoothstep(0.7, 1.0, vSpark);
    vec3 col = uColor * (0.62 + 0.5 * glint) + uWarm * (0.35 + 0.9 * glint);
    gl_FragColor = vec4(col, a * vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The drops' attributes: each one's own randoms, its kind (0 a drop, 1 a splash, 2 one of the last drops) and slot. */
function buildPoints(drops: number, splashes: number): THREE.BufferGeometry {
  const n = drops + splashes + DRIP_SLOTS;
  const rng = new Rng("can-shower");
  const seeds = new Float32Array(n * 4);
  const kinds = new Float32Array(n);
  const slots = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // the cone's offsets are spread over a disc, not a square, so the fan is round
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next());
    seeds[i * 4] = rng.next();
    seeds[i * 4 + 1] = rng.next();
    seeds[i * 4 + 2] = 0.5 + 0.5 * r * Math.cos(a);
    seeds[i * 4 + 3] = 0.5 + 0.5 * r * Math.sin(a);
    kinds[i] = i < drops ? 0 : i < drops + splashes ? 1 : 2;
    slots[i] = i < drops + splashes ? 0 : i - drops - splashes;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  g.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
  g.setAttribute("aSlot", new THREE.BufferAttribute(slots, 1));
  return g;
}

/** Fine streaks running down the veil (its alpha), drawn once. */
let veilTex: THREE.CanvasTexture | null = null;
function veilTexture(): THREE.CanvasTexture {
  if (!veilTex) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 128;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#000";
      g.fillRect(0, 0, 32, 128);
      for (let i = 0; i < 90; i++) {
        const x = (i * 37) % 32;
        const y = (i * 53) % 128;
        const l = 8 + ((i * 29) % 26);
        const a = 0.25 + 0.6 * (((i * 13) % 7) / 6);
        g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
        g.fillRect(x, y, 1, l);
        g.fillRect(x, y - 128, 1, l);
      }
    }
    veilTex = new THREE.CanvasTexture(c);
    veilTex.wrapS = THREE.RepeatWrapping;
    veilTex.wrapT = THREE.RepeatWrapping;
    veilTex.repeat.set(2, 2);
  }
  return veilTex;
}

/** The veil's water: lit and glossy like the lotus pot's stream, soft at its edges (it fades where it turns away). */
function veilMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: "#d9e6e8",
    transparent: true,
    opacity: 0,
    roughness: 0.06,
    metalness: 0,
    envMapIntensity: 1.4,
    depthWrite: false,
    alphaMap: veilTexture(),
    emissive: "#000000",
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      "#include <normal_fragment_maps>\ndiffuseColor.a *= pow(abs(dot(normalize(normal), normalize(vViewPosition))), 1.3);",
    );
  };
  m.customProgramCacheKey = () => "garden-can-veil";
  return m;
}

/**
 * The veil for a station: a tube that flares from the rose down to the saucer along the water's mean path, in the
 * frame of the can's hand turned with it but not tipped (water falls straight however the can leans), baked at the
 * middle of the pour's tip. Built once per press.
 */
function buildVeil(fall: number, tip: number, radial: number): THREE.BufferGeometry {
  const tau = tip + 0.04;
  const dx = CAN_ROSE.x - CAN_HAND.x;
  const dy = CAN_ROSE.y - CAN_HAND.y;
  const rx = dx * Math.cos(tau) + dy * Math.sin(tau);
  const ry = -dx * Math.sin(tau) + dy * Math.cos(tau);
  const a = Math.PI / 4 - tau;
  const vx = EXIT_SPEED * Math.cos(a);
  const vy = EXIT_SPEED * Math.sin(a);
  const flight = (vy + Math.sqrt(vy * vy + 2 * GRAVITY * fall)) / GRAVITY;
  const rows = 12;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= rows; i++) {
    const t = (flight * i) / rows;
    pts.push(new THREE.Vector3(rx + vx * t, ry + vy * t - 0.5 * GRAVITY * t * t, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(rows, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) {
    const u = i / rows;
    curve.getPointAt(u, p);
    const r = 0.007 + 0.02 * u;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(ang)).addScaledVector(frames.binormals[i], Math.sin(ang)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial, u);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < radial; j++) {
      const a0 = i * (radial + 1) + j;
      const b0 = a0 + radial + 1;
      idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const sky = new THREE.Color();

export function CanShower({ quality }: { quality: Quality }) {
  const { drops, splashes } = COUNTS[quality];
  const radial = quality === "lite" ? 6 : 8;
  const geometry = useMemo(() => buildPoints(drops, splashes), [drops, splashes]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { material, u } = useMemo(() => {
    const uniforms = {
      uT: { value: -1 },
      uFlowFrom: { value: canLive.flowFrom },
      uStopAt: { value: -1 },
      uStopFade: { value: canLive.stopFade },
      uSpeed: { value: EXIT_SPEED },
      uSpread: { value: SPREAD },
      uFloorY: { value: 0 },
      uScale: { value: 800 },
      uPixelRatio: { value: 1 },
      uAspect: { value: 1 },
      uSwell: { value: DRIP_SWELL },
      uRose: { value: canLive.rose },
      uRoseVel: { value: canLive.roseVel },
      uDir: { value: canLive.dir },
      uSide: { value: canLive.side },
      uUp: { value: canLive.up },
      uLand: { value: canLive.land },
      uHang: { value: canLive.hang },
      uDrip0: { value: canLive.drips[0] },
      uDrip1: { value: canLive.drips[1] },
      uDrip2: { value: canLive.drips[2] },
      uDrip3: { value: canLive.drips[3] },
      uDripV0: { value: canLive.dripVel[0] },
      uDripV1: { value: canLive.dripVel[1] },
      uDripV2: { value: canLive.dripVel[2] },
      uDripV3: { value: canLive.dripVel[3] },
      uDripDue: { value: new THREE.Vector4(-1, -1, -1, -1) },
      uDripFloor: { value: new THREE.Vector4() },
      uColor: { value: new THREE.Color() },
      uWarm: { value: new THREE.Color() },
      uOpacity: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false });
    return { material: m, u: uniforms };
  }, []);
  useEffect(() => () => material.dispose(), [material]);

  const veil = useMemo(() => {
    const geo = buildVeil(0.2, 1, radial);
    return { mat: veilMaterial(), geo, live: geo, key: 0 };
  }, [radial]);
  useEffect(
    () => () => {
      veil.mat.dispose();
      veil.geo.dispose();
      if (veil.live !== veil.geo) veil.live.dispose();
    },
    [veil],
  );

  const points = useRef<THREE.Points>(null);
  const veilMesh = useRef<THREE.Mesh>(null);
  const shown = useRef(0);

  useLayerFrame((state) => {
    if (!underVeil(qualityStore.get())) shown.current++;
    const warm = shown.current > 0 && shown.current < WARM_FRAMES;
    const L = canLive;
    const on = L.showering;
    const pts = points.current;
    const vm = veilMesh.current;
    if (pts) pts.visible = warm || on;
    if (vm) vm.visible = warm || (on && L.pose.flow > 0.02);
    if (!on) {
      u.uOpacity.value = 0;
      veil.mat.opacity = 0;
      if (!warm) return;
    }

    u.uT.value = L.t;
    u.uStopAt.value = L.stopAt;
    u.uFloorY.value = L.floorY;
    for (let i = 0; i < DRIP_SLOTS; i++) {
      u.uDripDue.value.setComponent(i, L.dripTimes[i]);
      u.uDripFloor.value.setComponent(i, L.dripFloor[i]);
    }
    const pr = state.gl.getPixelRatio();
    u.uPixelRatio.value = pr;
    u.uAspect.value = state.size.width / Math.max(1, state.size.height);
    // device pixels across one metre at one metre's depth
    u.uScale.value = 0.5 * state.size.height * pr * state.camera.projectionMatrix.elements[5];
    // the water takes the sky's light like the rain does, and the lantern's warmth as it is lit
    sky.copy(env.sky.horizon).lerp(WHITE, 0.55);
    u.uColor.value.copy(WATER).multiply(sky);
    u.uWarm.value.copy(lampUniforms.uLampColor.value).multiplyScalar(0.28 * weather.lit);
    u.uOpacity.value = on ? 0.55 : 0;

    if (vm) {
      // rebuilt once for each press, for its station's height
      if (L.at !== veil.key && L.at > 0) {
        veil.key = L.at;
        if (veil.live !== veil.geo) veil.live.dispose();
        veil.live = buildVeil(L.fall, L.tip, radial);
        vm.geometry = veil.live;
      }
      vm.position.set(L.pose.x, L.pose.y, L.pose.z);
      vm.rotation.set(0, L.pose.yaw, 0);
      veil.mat.opacity = on ? 0.38 * Math.min(1, Math.max(0, (L.pose.flow - 0.2) / 0.8)) : 0;
      veil.mat.alphaMap!.offset.y = -env.time * 2.4;
      veil.mat.emissive.copy(env.sky.horizon).lerp(env.sky.zenith, 0.4).multiplyScalar(0.06);
    }
  });

  return (
    <group name="can-shower">
      <mesh ref={veilMesh} geometry={veil.geo} material={veil.mat} renderOrder={2} frustumCulled={false} visible={false} />
      <points ref={points} geometry={geometry} material={material} renderOrder={3} frustumCulled={false} visible={false} />
    </group>
  );
}
