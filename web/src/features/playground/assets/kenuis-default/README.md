# Kenui's Default textures

Textures from [Kenui's Default](https://modrinth.com/resourcepack/kenuis-default) by KenuiZ, licensed
under the [MIT License](LICENSE.md). The files here are unchanged copies of the pack's files of the same name:

- the blocks at the top (among them the sixteen colours of wool, concrete and terracotta) and `destroy/`
  (the ten stages of a block being dug, `engine/breakOverlay.ts`), from `assets/minecraft/textures/block/`;
- `item/` (the pictures of tools and materials), from `assets/minecraft/textures/item/`;
- `entity/chest/`, from `assets/minecraft/textures/entity/chest/`: `normal.png` for a chest and `ender.png`
  for the creative chest, drawn as the chest model by `engine/chestModel.ts`;
- `environment/`, from `assets/minecraft/textures/environment/`: `clouds.png` (the clouds' pattern,
  `engine/clouds.ts`), `sun.png` and `moon_phases.png` (`engine/sky.ts`).

The inventory's block icons are drawn from the block textures as small cubes (`inventory/itemIcons.ts`).
The playground tints the grey ones when it builds its atlas (`engine/blockTextures.ts`): the grass top and
the grass side's overlay take a grass green, the leaves a foliage green and the water a sea blue, and the
water's strip of frames is played one frame at a time.
