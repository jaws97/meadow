// Aerial haze for the garden's distant scenery (the hills, the far woods and
// the hedgerow that ends the lawn), on top of the scene's linear fog. The fog
// fades by distance alone, which at twenty metres is barely anything, so the
// hills stood as flat dark cut-outs on a ruled horizon and the lawn ran up to
// them with a hard line. This adds two things the eye reads as air: a veil
// over the whole piece that thickens at night (so the hills never glow
// electric blue against the dark), and a ramp at the foot, where the ground
// meets the hills, that melts into the sky's own horizon colour.
//
// The lawn takes the same ramp by distance rather than height, thickening
// toward its far rim, so turf, hedgerow and hills all meet in one mist.
//
// One shared colour, written each frame from the sky (writeHaze), and a few
// numbers per material. The meshes stand at the origin, so object-space
// height (or distance from the middle) is the world's. It chains onto any
// patch a material already has (the lawn's garden light, for one).
import * as THREE from "three";

export interface HazeOptions {
  /** Veil over the whole piece by day, and by night (0..1). */
  day: number;
  night: number;
  /** Extra haze at the foot: full at `from` metres, gone by `to`, at most `foot`. */
  foot: number;
  from: number;
  to: number;
  /** Ramp by distance from the garden's middle instead: none at `from`, `foot` by `to` (the lawn). */
  radial?: boolean;
}

const shared = {
  uHazeColor: { value: new THREE.Color("#cfe1f4") },
  uHazeNight: { value: 0 },
};

const grey = new THREE.Color();

/**
 * Called once a frame with the sky's fog and horizon-glow colours and how far
 * into night it is. By day the haze is the fog's own pale blue. At night it
 * leans toward the city glow on the horizon and loses most of its colour, so
 * the hills settle into soft, dark shapes just short of the sky behind them
 * instead of the night palette's saturated blue.
 */
export function writeHaze(fog: THREE.Color, glow: THREE.Color, nightness: number) {
  const c = shared.uHazeColor.value.copy(fog).lerp(glow, 0.3 * nightness);
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  c.lerp(grey.setRGB(l, l, l), 0.5 * nightness).multiplyScalar(1 - 0.12 * nightness);
  shared.uHazeNight.value = nightness;
}

const VERT_COMMON = "#include <common>\nvarying float vHazeY;";
const VERT_HEIGHT = "#include <begin_vertex>\nvHazeY = position.y;";
const VERT_RADIUS = "#include <begin_vertex>\nvHazeY = length( position.xz );";
const FRAG_COMMON =
  "#include <common>\nvarying float vHazeY;\nuniform vec3 uHazeColor; uniform float uHazeNight;\n" +
  "uniform float uHazeDay; uniform float uHazeNightAmt; uniform float uHazeFoot; uniform vec2 uHazeRange;";
const FRAG_HAZE =
  "#include <fog_fragment>\n{ float veil = mix( uHazeDay, uHazeNightAmt, uHazeNight );\n" +
  "  #ifdef HAZE_RADIAL\n  float foot = smoothstep( uHazeRange.x, uHazeRange.y, vHazeY ) * uHazeFoot;\n" +
  "  #else\n  float foot = ( 1.0 - smoothstep( uHazeRange.x, uHazeRange.y, vHazeY ) ) * uHazeFoot;\n  #endif\n" +
  "  gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, clamp( max( veil, foot ), 0.0, 1.0 ) ); }";

/** Adds the haze to a lit material (MeshStandardMaterial and kin); returns it. */
export function withHaze<M extends THREE.Material>(material: M, o: HazeOptions): M {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.uniforms.uHazeColor = shared.uHazeColor;
    shader.uniforms.uHazeNight = shared.uHazeNight;
    shader.uniforms.uHazeDay = { value: o.day };
    shader.uniforms.uHazeNightAmt = { value: o.night };
    shader.uniforms.uHazeFoot = { value: o.foot };
    shader.uniforms.uHazeRange = { value: new THREE.Vector2(o.from, o.to) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", VERT_COMMON)
      .replace("#include <begin_vertex>", o.radial ? VERT_RADIUS : VERT_HEIGHT);
    shader.fragmentShader =
      (o.radial ? "#define HAZE_RADIAL\n" : "") +
      shader.fragmentShader.replace("#include <common>", FRAG_COMMON).replace("#include <fog_fragment>", FRAG_HAZE);
  };
  material.customProgramCacheKey = () => prevKey() + (o.radial ? "|garden-haze-radial" : "|garden-haze");
  return material;
}
