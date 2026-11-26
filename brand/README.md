# Brand assets

The main Linkord mark uses brand blue `#2b99e7`. The standalone administration site uses its [own monogram](../admin/src/features/admin/admin-mark.svg) in the header, sign-in form and browser tab.

## `svg/` (and the same names in `png/`, 1024px)

| File | Use |
| --- | --- |
| `mark-color.svg` | blue mark, transparent, cropped to the artwork (for light backgrounds) |
| `mark-white.svg` | white mark, transparent (for blue or dark backgrounds) |
| `mark-black.svg` | black mark, transparent (for light backgrounds, print) |
| `tile-brand.svg` | white mark on a blue rounded tile |
| `tile-white.svg` | blue mark on a white rounded tile |
| `tile-black.svg` | white mark on a black rounded tile |
| `tile-brand-square.svg` | `tile-brand` without rounded corners, for maskable and iOS icons |
| `tile-theme-<theme>.svg` | blue mark on the theme's app background |
| `tile-theme-<theme>-mono.svg` | light mark (the theme's primary text color) on the theme's app background |
| `favicon.svg` | blue mark on a tile that flips black/white with the browser chrome |

Themes: `black` (`#000000`), `graphite` (`#202225`) and `old` (`#0d0d0f`, a theme the app no longer has). Backgrounds are each theme's `--color-surface-app`; the Catppuccin themes have no tiles.

## `png/app/`

`icon-192`, `icon-512`, `icon-maskable-192`, `icon-maskable-512` and `apple-touch-icon` (180px), from the brand tile.
