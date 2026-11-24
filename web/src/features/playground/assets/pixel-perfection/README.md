# Pixel Perfection textures

Textures from [Pixel Perfection Community Edition](https://github.com/Athemis/PixelPerfectionCE)
(commit 28e38cab), originally by XSSheep and updated by the community, licensed under
[CC BY-SA 4.0](LICENSE.md). The files here are unchanged copies of the pack's files of the same name:
the blocks at the top (among them the sixteen colours of wool, concrete and terracotta) and `destroy/` (the ten stages of a block being dug, `engine/breakOverlay.ts`) from
`assets/minecraft/textures/block/`, `item/` (the pictures of tools and materials) from `assets/minecraft/textures/item/`, `particle/` from
`assets/minecraft/textures/particle/` (the stars of a critical hit, the damage heart and the puff a
dead player leaves, drawn by `engine/particles.ts`), `environment/` from
`assets/minecraft/textures/environment/` (`clouds.png`, the clouds' pattern, `engine/clouds.ts`; `sun.png` and
`moon_phases.png`, `engine/sky.ts`), `sky/` from `assets/fabricskyboxes/sky/` (the pack's three skyboxes, day,
night and stars, six faces each, `engine/sky.ts`), and `gui/` from `assets/minecraft/textures/gui/`
(`icons.png` for the hearts, `widgets.png` for the hotbar, and `container/inventory.png`,
`container/crafting_table.png` and `container/furnace.png` as `inventory.png`, `crafting_table.png` and
`furnace.png` for their screens, `container/generic_54.png` for a chest's, and `container/creative_inventory/`'s
`tab_items.png` and `tabs.png` for the creative chest's and its scroll bar, cut by `hud/gui.ts`). `entity/chest/`
from `assets/minecraft/textures/entity/chest/`: `normal.png` for a chest and `ender.png` for the creative
chest, drawn as the chest model by `engine/chestModel.ts`. The inventory's block icons are drawn
from the block textures as small cubes (`inventory/itemIcons.ts`).

The playground tints the grey ones when it builds its atlas (`engine/blockTextures.ts`): the grass top
and the grass side's overlay take a grass green, the leaves a foliage green and the water a sea blue,
and the water's strip of frames is played one frame at a time. The tinted textures, as the game draws
them, are under the same license.
