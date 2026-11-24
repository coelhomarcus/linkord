# Credits

Work by others that Linkord builds on, beyond the packages in `package.json`. Each file that ports code from a project below says so in its header comment.

## Playground

The playground's movement, animation, lighting and game chat follow the block game's own rules as these open source projects reproduce them. Their code was read and ported to Linkord's engine (`web/src/features/playground/`). None of their assets (textures, models, sounds) are used.

| Project | What was ported | License |
| --- | --- | --- |
| [minecraft-web-client](https://github.com/zardoy/minecraft-web-client) by zardoy | camera and hand bobbing state, movement animation states; the game chat follows its keys and fading lines | MIT, Copyright (c) 2020 PrismarineJS |
| [minecraft-renderer](https://github.com/zardoy/minecraft-renderer) by zardoy | first-person arm transforms, humanoid pose and limb swing, view bobbing, third-person camera, sky light, smooth lighting, ambient occlusion, sun shadows, the clouds' slab and two-pass drawing, the time of day (the sun's path, the sky's darkening, the sky and fog colours) | MIT |
| [prismarine-physics](https://github.com/PrismarineJS/prismarine-physics) ([zardoy's fork](https://github.com/zardoy/prismarine-physics)) | walking, sprinting, sneaking, jumping and collisions at 20 ticks a second | MIT, Copyright (c) 2020 PrismarineJS |

The world's block textures, the cracks of a block being dug, the clouds, the sky (its day and night skyboxes, the sun and the moon's phases), the items' pictures (tools, coal, ingots...), the chests, the fight's particles and the hearts, hotbar, inventory, crafting table, furnace, chest and creative screens are from **[Pixel Perfection Community Edition](https://github.com/Athemis/PixelPerfectionCE)**, originally by XSSheep and updated by its community, under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The files are unchanged copies in `web/src/features/playground/assets/pixel-perfection/` (with the license and where they come from); the game tints the grass, leaves and water as it draws them, and those tinted textures are under the same license. Default skins and the rest of the interface are Linkord's own.

The HUD, menu and name labels use **monogram** by [datagoblin](https://datagoblin.itch.io/monogram), CC0.

Linkord is not affiliated with Mojang Studios or Microsoft. "Minecraft" is a trademark of Mojang Synergies AB.

## MIT License

The license under which the projects above share their code:

```
MIT License

Copyright (c) 2020 PrismarineJS

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
