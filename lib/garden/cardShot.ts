// The bloom card's photograph (components/care/BloomSheet): a few frames of the garden drawn for the card behind a held
// still, then the garden given back exactly as it was (components/garden/CardCamera runs it). While `active`:
//   - the camera rig hands the camera over (CameraRig), and once the shot is solved places it at the card's pose;
//   - the clock lights the card's own hour and weather (Clock): golden hour, fair, a breath of wind;
//   - the flower is drawn fully open and standing as it does after a drink (Plant, LotusGarden);
//   - the doe and the bed's covers step out of the picture (CardCamera).
// Nothing here touches the garden store: the hour, the rain and the lotus's look keep their own truths throughout.
import * as THREE from "three";

export interface CardLight {
  hour: number;
  cloud: number;
  rain: number;
  wind: number;
}

export const cardShot = {
  active: false,
  /** the shot is solved (from the flower drawn open): the rig places the camera here */
  aimed: false,
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  fov: 30,
  aspect: 0.8,
  light: null as CardLight | null,
  /** from the request to the release: a tier prepared out of sight waits rather than swapping in under the still */
  busy: false,
  /** the soil flower's head as last drawn (Plant): the shot is solved from it; null for a lotus */
  head: null as THREE.Object3D | null,
  headBody: null as THREE.Object3D | null,
};

/** The flower as the card shows it: fully open, and no more drooped than this. */
export const CARD_BLOOM = 1;
export const CARD_DROOP = 0.08;
