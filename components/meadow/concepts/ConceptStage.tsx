"use client";
/* eslint-disable react-hooks/immutability --
   Lights, uniforms, the camera and the turntables are three.js objects written in the frame loop (see kit.tsx). */
// The /cart-concepts stage: the three Lantern Cart concepts side by side on slow turntables on a paved garden
// terrace, at golden hour or at dusk, and beside them the cart as built for the Meadow (../FireflyTrolley.tsx: the
// firefly trolley with the seed barrow's pots in its tub). The wheels roll, the lanterns swing and glow, and
// meadow.night is driven by the light here exactly as the Meadow drives it, so each cart's glow behaves as it would
// in the game. Pick a cart to come in close, or to see it from the Meadow's own follow camera (its height, bearing and
// distance), which is how most people will see it. Each card shows the cart's triangle and draw-call counts, counted
// from its scene graph.
//
// For repeatable captures the address sets everything: ?time=golden|dusk, ?cart=cane|barrow|firefly|built,
// ?view=meadow, ?spin=0 to stop the turntables, ?angle=<degrees> for the carts' heading, ?ui=0 to hide the controls,
// and ?lite=1 to see the built cart as the lite tier (phones) draws it: no point light, its glow painted on and a pool
// of light on the ground. Loaded by next/dynamic with ssr:false (CartConcepts.tsx), so it reads window freely; a
// default export for that loader.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { CANE_LIGHT, CaneCart } from "@/components/meadow/concepts/CaneCart";
import { FireflyTrolley, JAR_LIGHT } from "@/components/meadow/concepts/FireflyTrolley";
import { GROUND_Y, useAssets, type ConceptProps } from "@/components/meadow/concepts/kit";
import { FireflyTrolley as BuiltTrolley, GuardianLight } from "@/components/meadow/FireflyTrolley";
import { SeedBarrow, STAR_LIGHT } from "@/components/meadow/concepts/SeedBarrow";
import { WHEEL } from "@/components/meadow/cart";
import { grainTexture, paverTexture, seeded, worldUv } from "@/components/meadow/parts";
import { meadow } from "@/components/meadow/runtime";

type Time = "golden" | "dusk";
type ConceptId = "cane" | "barrow" | "firefly" | "built";
type Focus = "all" | ConceptId;
type View = "close" | "meadow";

interface Concept {
  id: ConceptId;
  name: string;
  short: string;
  /** A one-word name for the chip on a phone, where the full row would run off the screen. */
  tiny: string;
  lines: [string, string];
  Cart: ComponentType<ConceptProps & StageCartProps>;
  light: string;
}

/** What the stage hands every cart besides its wheels; the concepts ignore it, the built cart reads it. */
interface StageCartProps {
  lite?: boolean;
  groundY?: number;
}

const CONCEPTS: Concept[] = [
  {
    id: "cane",
    name: "Cane basket cart",
    short: "Cane basket",
    tiny: "Cane",
    lines: [
      "A woven cane basket heaped with marigolds, roses and jasmine, on bentwood runners and wooden wheels.",
      "A pierced brass lantern hangs from a curved walnut crook and lets out little stars of light.",
    ],
    Cart: CaneCart,
    light: CANE_LIGHT,
  },
  {
    id: "barrow",
    name: "Seed barrow",
    short: "Seed barrow",
    tiny: "Barrow",
    lines: [
      "A teak barrow with painted seed drawers, under a block-printed canopy strung with fairy lights.",
      "A paper star lantern, like the ones on Bangalore balconies at Diwali, turns slowly out in front.",
    ],
    Cart: SeedBarrow,
    light: STAR_LIGHT,
  },
  {
    id: "firefly",
    name: "Firefly trolley",
    short: "Firefly trolley",
    tiny: "Firefly",
    lines: [
      "A painted tin tub of seedlings on copper wheels, with a jasmine vine climbing its copper hoop.",
      "A glass jar of fireflies hangs in the middle, and at dusk a few slip out to circle the cart.",
    ],
    Cart: FireflyTrolley,
    light: JAR_LIGHT,
  },
  {
    id: "built",
    name: "The cart, as built",
    short: "As built",
    tiny: "Built",
    lines: [
      "The firefly trolley with the seed barrow's clay pots of seedlings set into its tub, as the Meadow draws it.",
      "Its wheels turn and steer with the cart, and the jar of fireflies is the guardian light after dark.",
    ],
    Cart: BuiltTrolley,
    light: JAR_LIGHT,
  },
];

const SPACING = 2.7;
/** Each turntable's place along the terrace, the row centred on the middle. */
const slotX = (i: number) => (i - (CONCEPTS.length - 1) / 2) * SPACING;
const PLINTH = { r: 1.08, h: 0.1, top: 0.025 };
/** The chassis' height above the terrace with the cart resting on its turntable. */
const CART_Y = PLINTH.h + PLINTH.top - GROUND_Y;
/** The carts face this way at rest: front-right three-quarter to the default camera. */
const REST_YAW = -0.62;
const TURN_SPEED = 0.22;
/** How fast the wheels roll, metres a second, as if the cart were ambling along. */
const ROLL = 0.6;
const FOV = 30;
/** The Meadow's follow camera: its elevation from straight up, its bearing and its default distance (CameraRig). */
const MEADOW_CAMERA = { phi: 0.28 * Math.PI, theta: 0.25 * Math.PI, distance: 17 };

interface LightKey {
  zenith: string;
  horizon: string;
  glow: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  night: number;
  stars: number;
}

/** Golden hour in October (the sun low over the west) and dusk half an hour after sunset. */
const KEYS: Record<Time, LightKey> = {
  golden: {
    zenith: "#6d93c8",
    horizon: "#ffc890",
    glow: "#ffb068",
    fog: "#e7c29c",
    sun: "#ffb26c",
    sunIntensity: 2.9,
    sunDir: [-0.35, 0.24, 0.9],
    hemiSky: "#ffe0ba",
    hemiGround: "#6d5a3d",
    hemiIntensity: 1.0,
    night: 0.06,
    stars: 0,
  },
  dusk: {
    zenith: "#101838",
    horizon: "#9a6a82",
    glow: "#ff8f6a",
    fog: "#2a2d4c",
    sun: "#9aaeff",
    sunIntensity: 0.4,
    sunDir: [0.45, 0.6, 0.66],
    hemiSky: "#56649c",
    hemiGround: "#251d26",
    hemiIntensity: 0.85,
    night: 0.9,
    stars: 1,
  },
};

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
uniform float uStars;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.8, h), 0.65));
  float sun = max(dot(d, uSun), 0.0);
  col += uGlow * (pow(sun, 8.0) * 0.45 + pow(1.0 - abs(h), 7.0) * 0.2);
  vec3 cell = floor(d * 200.0);
  col += vec3(0.85, 0.9, 1.0) * step(0.9972, hash(cell)) * smoothstep(0.08, 0.45, h) * uStars * 0.8;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function readParams() {
  const q = new URLSearchParams(window.location.search);
  const cart = q.get("cart");
  const angle = Number(q.get("angle"));
  const focus = CONCEPTS.find((c) => c.id === cart)?.id ?? "all";
  return {
    time: (q.get("time") === "dusk" ? "dusk" : "golden") as Time,
    focus: focus as Focus,
    view: (q.get("view") === "meadow" ? "meadow" : "close") as View,
    spin: q.get("spin") !== "0",
    yaw: q.has("angle") && Number.isFinite(angle) ? THREE.MathUtils.degToRad(angle) : REST_YAW,
    ui: q.get("ui") !== "0",
    lite: q.get("lite") === "1",
  };
}

/** Counts a cart's triangles (instances and sprites included) and the draw calls it makes, shadows aside. */
function countScene(root: THREE.Object3D): { triangles: number; draws: number } {
  let triangles = 0;
  let draws = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const g = mesh.geometry;
      const n = g.index ? g.index.count : g.attributes.position.count;
      const instances = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
      triangles += (n / 3) * instances;
      draws++;
    } else if ((o as THREE.Sprite).isSprite) {
      triangles += 2;
      draws++;
    } else if ((o as THREE.Points).isPoints) {
      draws++;
    }
  });
  return { triangles: Math.round(triangles), draws };
}

const stage = { t: 0, target: 0, yaw: REST_YAW, spin: true, roll: 0 };

const SUN_GOLDEN = new THREE.Vector3(...KEYS.golden.sunDir);
const SUN_DUSK = new THREE.Vector3(...KEYS.dusk.sunDir);

function StageLight({ time }: { time: Time }) {
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const sky = useRef<THREE.Mesh>(null);
  const res = useAssets(() => {
    const uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uStars: { value: 0 },
    };
    return {
      uniforms,
      skyMat: new THREE.ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, uniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
      skyGeo: new THREE.SphereGeometry(120, 32, 16),
      fog: new THREE.Fog("#e7c29c", 22, 80),
      keys: {
        golden: keyColors(KEYS.golden),
        dusk: keyColors(KEYS.dusk),
      },
    };
  });
  useEffect(() => {
    stage.target = time === "dusk" ? 1 : 0;
  }, [time]);
  useEffect(() => {
    scene.fog = res.fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, res]);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    // ease between the two looks over a second or so
    stage.t += (stage.target - stage.t) * (1 - Math.exp(-Math.min(dt, 0.1) * 3.2));
    if (Math.abs(stage.target - stage.t) < 1e-3) stage.t = stage.target;
    const t = stage.t * stage.t * (3 - 2 * stage.t);
    const a = res.keys.golden;
    const b = res.keys.dusk;
    const u = res.uniforms;
    u.uZenith.value.lerpColors(a.zenith, b.zenith, t);
    u.uHorizon.value.lerpColors(a.horizon, b.horizon, t);
    u.uGlow.value.lerpColors(a.glow, b.glow, t);
    u.uStars.value = THREE.MathUtils.lerp(KEYS.golden.stars, KEYS.dusk.stars, t);
    res.fog.color.lerpColors(a.fog, b.fog, t);
    // the haze begins just short of the carts however far back the camera stands (a tall phone's "All four" is ~45 m)
    res.fog.near = Math.max(22, camera.position.length() - 3);
    res.fog.far = res.fog.near + 58;
    dir.lerpVectors(SUN_GOLDEN, SUN_DUSK, t).normalize();
    u.uSun.value.copy(dir);
    meadow.night = THREE.MathUtils.lerp(KEYS.golden.night, KEYS.dusk.night, t);
    const s = sun.current;
    if (s) {
      s.color.lerpColors(a.sun, b.sun, t);
      s.intensity = THREE.MathUtils.lerp(KEYS.golden.sunIntensity, KEYS.dusk.sunIntensity, t);
      s.position.copy(dir).multiplyScalar(30);
    }
    const h = hemi.current;
    if (h) {
      h.color.lerpColors(a.hemiSky, b.hemiSky, t);
      h.groundColor.lerpColors(a.hemiGround, b.hemiGround, t);
      h.intensity = THREE.MathUtils.lerp(KEYS.golden.hemiIntensity, KEYS.dusk.hemiIntensity, t);
    }
    sky.current?.position.copy(camera.position);
  }, -0.5);
  return (
    <>
      <mesh ref={sky} geometry={res.skyGeo} material={res.skyMat} renderOrder={-1} frustumCulled={false} />
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
    </>
  );
}

function keyColors(k: LightKey) {
  return {
    zenith: new THREE.Color(k.zenith),
    horizon: new THREE.Color(k.horizon),
    glow: new THREE.Color(k.glow),
    fog: new THREE.Color(k.fog),
    sun: new THREE.Color(k.sun),
    hemiSky: new THREE.Color(k.hemiSky),
    hemiGround: new THREE.Color(k.hemiGround),
  };
}

/** A paved terrace in a lawn, ringed by a low hedge: enough garden for the carts to stand in. */
function Terrace() {
  const res = useAssets(() => {
    const paver = paverTexture(7);
    const grass = grainTexture("#5d7f3a", "#7c9c4c", "#3f5f2a", 41, 1);
    const terrace = worldUv(new THREE.CircleGeometry(7, 72).rotateX(-Math.PI / 2), 1.6);
    const lawn = worldUv(new THREE.RingGeometry(7, 70, 72, 1).rotateX(-Math.PI / 2), 4);
    const kerb = new THREE.TorusGeometry(7, 0.06, 4, 96).rotateX(Math.PI / 2);
    const bush = new THREE.IcosahedronGeometry(1, 1);
    return {
      paver,
      grass,
      terrace,
      lawn,
      kerb,
      bush,
      paverMat: new THREE.MeshStandardMaterial({ map: paver, roughness: 0.9 }),
      grassMat: new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }),
      kerbMat: new THREE.MeshStandardMaterial({ color: "#cdb88f", roughness: 0.9 }),
      bushMat: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95 }),
    };
  });
  const hedge = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = hedge.current;
    if (!m) return;
    const rand = seeded(5);
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < m.count; i++) {
      // two loose rows, the back one taller, so the hedge reads as a planted border rather than a wall
      const back = i % 2 === 1;
      const a = (i / m.count) * Math.PI * 2 + rand() * 0.04;
      const r = (back ? 15 : 13.6) + rand() * 0.8;
      const s = (back ? 1.1 : 0.75) + rand() * 0.45;
      o.position.set(Math.cos(a) * r, s * 0.5, Math.sin(a) * r);
      o.scale.set(s * 1.25, s * (0.75 + rand() * 0.35), s * 1.25);
      o.rotation.set(rand(), rand() * 6, rand());
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(["#4a6e39", "#557a40", "#41632f", "#5d8446", "#6b8a3e"][Math.floor(rand() * 5)]));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  return (
    <>
      <mesh geometry={res.terrace} material={res.paverMat} receiveShadow />
      <mesh geometry={res.lawn} material={res.grassMat} receiveShadow position={[0, -0.005, 0]} />
      <mesh geometry={res.kerb} material={res.kerbMat} receiveShadow />
      <instancedMesh ref={hedge} args={[res.bush, res.bushMat, 120]} receiveShadow />
    </>
  );
}

/** One turntable: a carved stone drum with a brass band, a slowly turning teak top, and a cart on it. */
function Turntable({
  concept,
  x,
  lite,
  onStats,
  onPick,
}: {
  concept: Concept;
  x: number;
  lite: boolean;
  onStats: (id: ConceptId, s: { triangles: number; draws: number }) => void;
  onPick: () => void;
}) {
  const top = useRef<THREE.Group>(null);
  const cart = useRef<THREE.Group>(null);
  const wheels = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const res = useAssets(() => ({
    drum: new THREE.CylinderGeometry(PLINTH.r, PLINTH.r + 0.05, PLINTH.h, 64),
    band: new THREE.TorusGeometry(PLINTH.r + 0.005, 0.014, 5, 96).rotateX(Math.PI / 2),
    deck: new THREE.CylinderGeometry(PLINTH.r - 0.06, PLINTH.r - 0.06, PLINTH.top, 64),
    stone: new THREE.MeshStandardMaterial({ color: "#e4d5b4", roughness: 0.92 }),
    brass: new THREE.MeshStandardMaterial({ color: "#c49a52", metalness: 0.6, roughness: 0.35 }),
    teak: new THREE.MeshStandardMaterial({ color: "#b48a5e", roughness: 0.8 }),
  }));
  useEffect(() => {
    if (cart.current) onStats(concept.id, countScene(cart.current));
  }, [concept.id, onStats]);
  // before the carts' own frame work (priority 0), so the built cart's instanced wheels follow this frame's pose
  useFrame(() => {
    if (top.current) top.current.rotation.y = stage.yaw;
    // the wheels roll forward (rotation about the axle, as PhysicsCart sets them)
    for (const w of wheels.current) w?.rotation.set(0, 0, -stage.roll / WHEEL.radius, "YXZ");
  }, -1);
  return (
    <group
      position={[x, 0, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      <mesh geometry={res.drum} material={res.stone} position={[0, PLINTH.h / 2, 0]} castShadow receiveShadow />
      <mesh geometry={res.band} material={res.brass} position={[0, PLINTH.h - 0.012, 0]} />
      <group ref={top}>
        <mesh geometry={res.deck} material={res.teak} position={[0, PLINTH.h + PLINTH.top / 2, 0]} receiveShadow />
        <group ref={cart} position={[0, CART_Y, 0]}>
          <concept.Cart wheels={wheels} lite={lite} groundY={PLINTH.h + PLINTH.top} />
        </group>
      </group>
    </group>
  );
}

function Spinner({ spin, yaw }: { spin: boolean; yaw: number }) {
  useEffect(() => {
    stage.spin = spin;
  }, [spin]);
  useEffect(() => {
    stage.yaw = yaw;
  }, [yaw]);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    if (stage.spin) stage.yaw += TURN_SPEED * dt;
    stage.roll += ROLL * dt;
  }, -2);
  return null;
}

/** Where the camera should be for the chosen cart and view, fitted to the screen's shape (and to the controls, if shown). */
function poseFor(focus: Focus, view: View, aspect: number, ui: boolean): { position: THREE.Vector3; target: THREE.Vector3 } {
  const vf = THREE.MathUtils.degToRad(FOV);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
  const from = (elevation: number, azimuth: number) =>
    new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
  if (focus === "all") {
    const target = new THREE.Vector3(0, 1.0, 0);
    // the outer turntables' full width and a little air, so on a tall phone the fourth is not cut by the screen's edge
    const halfW = slotX(CONCEPTS.length - 1) + PLINTH.r + 0.3;
    const dist = Math.max(halfW / Math.tan(hf / 2), 1.35 / Math.tan(vf / 2)) + 1.2;
    // a tall screen looks down a little more, so it shows terrace rather than a band of empty sky
    const elevation = THREE.MathUtils.degToRad(13 + 11 * THREE.MathUtils.clamp((1.3 - aspect) / 0.85, 0, 1));
    return { target, position: target.clone().addScaledVector(from(elevation, 0), dist) };
  }
  const x = slotX(CONCEPTS.findIndex((c) => c.id === focus));
  if (view === "meadow") {
    const target = new THREE.Vector3(x, CART_Y - 0.4, 0);
    return { target, position: target.clone().addScaledVector(from(Math.PI / 2 - MEADOW_CAMERA.phi, MEADOW_CAMERA.theta), MEADOW_CAMERA.distance) };
  }
  // portrait screens leave room for the controls above and the card below; wide ones keep the card to the right
  const portrait = aspect < 0.8;
  const shift = ui && !portrait ? 0.25 * THREE.MathUtils.clamp((aspect - 1) * 1.2, 0, 1) : 0;
  const target = new THREE.Vector3(x + shift, portrait && ui ? 0.98 : 1.1, 0);
  const dist = (portrait ? 1.22 : ui ? 1.42 : 1.32) / Math.sin(Math.min(vf, hf) / 2);
  return { target, position: target.clone().addScaledVector(from(THREE.MathUtils.degToRad(portrait ? 15 : 12), 0), dist) };
}

/** Eases the camera to the chosen framing, and leaves it alone once someone drags until the choice changes. */
function CameraDirector({ focus, view, ui }: { focus: Focus; view: View; ui: boolean }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const free = useRef(false);
  const jump = useRef(true);
  useEffect(() => {
    free.current = false;
  }, [focus, view]);
  useEffect(() => {
    if (!controls) return;
    const onStart = () => {
      free.current = true;
    };
    controls.addEventListener("start", onStart);
    return () => controls.removeEventListener("start", onStart);
  }, [controls]);
  useFrame((_, dt) => {
    if (!controls || free.current) return;
    const pose = poseFor(focus, view, size.width / Math.max(1, size.height), ui);
    const k = jump.current ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 3);
    jump.current = false;
    camera.position.lerp(pose.position, k);
    controls.target.lerp(pose.target, k);
    controls.update();
  }, -1);
  return null;
}

type Stats = Partial<Record<ConceptId, { triangles: number; draws: number }>>;

function statsLine(s: { triangles: number; draws: number } | undefined): string {
  return s ? `${s.triangles.toLocaleString("en-IN")} triangles, ${s.draws} draw calls` : "Counting";
}

/** A chip label that shortens on a phone (below the sm breakpoint), so the whole row fits a 320 pixel screen. */
function Short({ tiny, full }: { tiny: string; full: string }) {
  return (
    <>
      <span className="sm:hidden">{tiny}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, ReactNode]>; onChange: (v: T) => void }) {
  return (
    <div className="flex w-fit shrink-0 rounded-full border border-[rgba(255,236,200,0.13)] bg-[rgba(12,14,22,0.78)] p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`rounded-full px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors sm:px-3 ${
            value === v ? "bg-[#f2cd8e] text-[#2a2013]" : "text-[rgba(246,234,214,0.8)] hover:text-[#f6ead6]"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Card({ concept, stats, onPick, active }: { concept: Concept; stats: Stats; onPick?: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`min-w-[260px] flex-1 rounded-2xl md:min-w-0 border bg-[rgba(12,14,22,0.82)] p-4 text-left shadow-[0_18px_48px_rgba(0,0,0,0.35)] md:backdrop-blur-md ${
        active ? "border-[rgba(242,205,142,0.55)]" : "border-[rgba(255,236,200,0.13)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: concept.light, boxShadow: `0 0 10px ${concept.light}` }} />
        <h2 className="font-serif text-[18px] leading-tight text-[#f6ead6]">{concept.name}</h2>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-[rgba(246,234,214,0.82)]">{concept.lines[0]}</p>
      <p className="mt-1 text-[13px] leading-snug text-[rgba(246,234,214,0.82)]">{concept.lines[1]}</p>
      <p className="mt-2 text-[12px] text-[#f2cd8e]">{statsLine(stats[concept.id])}</p>
    </button>
  );
}

export default function ConceptStage() {
  const [initial] = useState(readParams);
  const [time, setTime] = useState<Time>(initial.time);
  const [focus, setFocus] = useState<Focus>(initial.focus);
  const [view, setView] = useState<View>(initial.view);
  const [spin, setSpin] = useState(initial.spin);
  const [stats, setStats] = useState<Stats>({});
  const onStats = useMemo(() => (id: ConceptId, s: { triangles: number; draws: number }) => setStats((prev) => ({ ...prev, [id]: s })), []);
  useEffect(() => {
    stage.t = stage.target = initial.time === "dusk" ? 1 : 0;
  }, [initial]);
  useEffect(() => {
    // a handle for checking the counts from the console or a test
    (window as unknown as { __cartConcepts?: unknown }).__cartConcepts = { stats, time, focus, view };
  }, [stats, time, focus, view]);

  const focused = focus === "all" ? null : CONCEPTS.find((c) => c.id === focus)!;
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#1a1712] text-[#f6ead6] select-none">
      <Canvas
        shadows={{ enabled: true, type: THREE.PCFShadowMap }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: FOV, near: 0.1, far: 300, position: [0, 3, 18] }}
        style={{ position: "absolute", inset: 0, touchAction: "none" }}
      >
        <StageLight time={time} />
        {/* the built cart's guardian light, as the Meadow mounts it (none on the lite tier) */}
        {!initial.lite && <GuardianLight />}
        <Terrace />
        <Spinner spin={spin} yaw={initial.yaw} />
        {CONCEPTS.map((c, i) => (
          <Turntable key={c.id} concept={c} x={slotX(i)} lite={initial.lite} onStats={onStats} onPick={() => setFocus(c.id)} />
        ))}
        {/* far enough back for "All four" on a tall phone, where the row needs about 45 metres */}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} enablePan={false} minDistance={2.5} maxDistance={64} maxPolarAngle={Math.PI * 0.49} />
        <CameraDirector focus={focus} view={view} ui={initial.ui} />
      </Canvas>

      {initial.ui && (
        <>
          {/* a soft shade under the title, so it reads against a bright golden sky */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[150px] bg-gradient-to-b from-[rgba(14,12,10,0.5)] to-transparent md:h-[110px]" />
          <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
            <div className="[text-shadow:0_1px_10px_rgba(0,0,0,0.45)]">
              <h1 className="font-serif text-[22px] leading-tight md:text-[28px]">Lantern Cart concepts</h1>
              <p className="mt-0.5 text-[13px] text-[rgba(246,234,214,0.8)]">Three ideas for the cart and the one built, at golden hour and at dusk</p>
            </div>
            <div className="pointer-events-auto flex flex-col gap-2 md:items-end">
              <div className="flex flex-wrap gap-2">
                <Segmented
                  value={time}
                  options={[
                    ["golden", "Golden hour"],
                    ["dusk", "Dusk"],
                  ]}
                  onChange={setTime}
                />
                <button
                  type="button"
                  onClick={() => setSpin((s) => !s)}
                  aria-pressed={!spin}
                  className="rounded-full border border-[rgba(255,236,200,0.13)] bg-[rgba(12,14,22,0.78)] px-3.5 py-1.5 text-[13px] text-[rgba(246,234,214,0.85)]"
                >
                  {spin ? "Pause turntable" : "Turn again"}
                </button>
              </div>
              <Segmented<Focus>
                value={focus}
                options={[["all", <Short key="all" tiny="All" full="All four" />], ...CONCEPTS.map((c) => [c.id, <Short key={c.id} tiny={c.tiny} full={c.short} />] as [Focus, ReactNode])]}
                onChange={setFocus}
              />
              {focused && (
                <Segmented
                  value={view}
                  options={[
                    ["close", "Close up"],
                    ["meadow", "Meadow camera"],
                  ]}
                  onChange={setView}
                />
              )}
            </div>
          </header>

          {/* below desktop widths the cards sit clear of the development indicator in the bottom-left corner */}
          <footer className="absolute inset-x-0 bottom-0 p-4 pb-[64px] lg:pb-4">
            {focused ? (
              <div className="mx-auto max-w-[460px] md:mr-0 md:ml-auto md:max-w-[400px]">
                <Card concept={focused} stats={stats} active />
              </div>
            ) : (
              <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-auto md:max-w-[1180px]">
                {CONCEPTS.map((c) => (
                  <Card key={c.id} concept={c} stats={stats} onPick={() => setFocus(c.id)} />
                ))}
              </div>
            )}
          </footer>
        </>
      )}
    </main>
  );
}
