import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterId } from '../characters';
import { toToon } from './toon';
import type { Motion } from '../playgroundProtocol';
import knightUrl from '../assets/Knight.glb?url';
import barbarianUrl from '../assets/Barbarian.glb?url';
import mageUrl from '../assets/Mage.glb?url';
import rangerUrl from '../assets/Ranger.glb?url';
import rogueUrl from '../assets/Rogue.glb?url';
import rogueHoodedUrl from '../assets/Rogue_Hooded.glb?url';
import movementUrl from '../assets/Rig_Medium_MovementBasic.glb?url';
import generalUrl from '../assets/Rig_Medium_General.glb?url';

const CHARACTER_URLS: Record<CharacterId, string> = {
  knight: knightUrl, barbarian: barbarianUrl, mage: mageUrl, ranger: rangerUrl, rogue: rogueUrl, rogueHooded: rogueHoodedUrl,
};

/** The clip each motion plays, from the two KayKit animation files. */
const MOTION_CLIPS: Record<Motion, string> = {
  idle: 'Idle_A',
  walk: 'Walking_A',
  run: 'Running_A',
  jump: 'Jump_Idle',
};

/** Every avatar is this tall, whatever size its model was exported at. */
export const AVATAR_HEIGHT = 1.8;

const loader = new GLTFLoader();
// a module-level cache on purpose: the files are immutable (hashed URLs), and
// someone leaving and re-entering the playground should not fetch them again
const characters = new Map<CharacterId, Promise<{ scene: THREE.Object3D; scale: number }>>();
let clips: Promise<Map<Motion, THREE.AnimationClip>> | null = null;

function loadCharacter(id: CharacterId) {
  let entry = characters.get(id);
  if (!entry) {
    entry = loader.loadAsync(CHARACTER_URLS[id]).then((gltf: GLTF) => {
      // banded once on the cached original; every clone shares these materials
      gltf.scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toToon) : toToon(mesh.material);
      });
      const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      return { scene: gltf.scene, scale: size.y > 0 ? AVATAR_HEIGHT / size.y : 1 };
    });
    entry.catch(() => { characters.delete(id); });
    characters.set(id, entry);
  }
  return entry;
}

export function loadMotionClips(): Promise<Map<Motion, THREE.AnimationClip>> {
  if (!clips) {
    clips = Promise.all([loader.loadAsync(movementUrl), loader.loadAsync(generalUrl)]).then((files) => {
      const all = files.flatMap((file) => file.animations);
      const byMotion = new Map<Motion, THREE.AnimationClip>();
      for (const [motion, name] of Object.entries(MOTION_CLIPS) as [Motion, string][]) {
        const clip = all.find((c) => c.name === name);
        if (clip) byMotion.set(motion, clip);
      }
      return byMotion;
    });
    clips.catch(() => { clips = null; });
  }
  return clips;
}

/** A fresh, independently animatable copy of a character, scaled to AVATAR_HEIGHT. */
export async function createCharacterModel(id: CharacterId): Promise<THREE.Object3D> {
  const { scene, scale } = await loadCharacter(id);
  const model = cloneSkinned(scene);
  model.scale.setScalar(scale);
  model.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      node.castShadow = true;
      // a skinned mesh's bounds are its bind pose; a walking arm would get culled at the screen's edge
      node.frustumCulled = false;
    }
  });
  return model;
}
