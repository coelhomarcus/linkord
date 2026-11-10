// Builds web/public/emoji-data/<lang>/emojis.json from the pinned
// emojibase-data devDependency: one compact file per language that the emoji
// picker and the composer's :shortcode: suggestions both read. Served by us,
// never by a CDN. An emoji (or a skin tone of it) the pinned Twemoji has no
// picture for is left out, so the picker never offers one drawn by the
// system's font instead. Run it after bumping emojibase-data or
// @discordapp/twemoji:
//
//   npm run emoji:data
//
// Each entry is [emoji, label, group, shortcodes, tags, skins?]:
// - group is emojibase's (0 smileys, 1 people, 3 nature, 4 food, 5 travel,
//   6 activities, 7 objects, 8 symbols, 9 flags); components are left out
// - shortcodes are English, like Discord's in every language (GitHub's names
//   first, then Slack's that differ), so ":joy:" works whatever the UI says;
//   an emoji too new for either gets emojibase's own English name, never a
//   name made from the label in the UI's language
// - skins are the five single-tone variants, light to dark, when there are
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const outRoot = path.join(here, '..', 'public', 'emoji-data');
const LANGS = ['pt', 'en'];
const COMPONENT_GROUP = 2;

const github = require('emojibase-data/en/shortcodes/github.json');
const iamcal = require('emojibase-data/en/shortcodes/iamcal.json');
const emojibase = require('emojibase-data/en/shortcodes/emojibase.json');
const version = require('emojibase-data/package.json').version;
const twemojiDir = path.join(path.dirname(require.resolve('@discordapp/twemoji/package.json')), 'dist', 'svg');
const twemoji = new Set(fs.readdirSync(twemojiDir).map((file) => file.replace(/\.svg$/, '')));

/** Mirrors twemojiUrls in src/features/emoji/twemoji.ts. */
function hasPicture(emoji) {
  const points = [...emoji].map((char) => char.codePointAt(0));
  const name = (keep) => points.filter((point) => keep || point !== 0xfe0f).map((point) => point.toString(16)).join('-');
  return twemoji.has(name(points.includes(0x200d))) || twemoji.has(name(false));
}

const asList = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

function shortcodesFor(hexcode) {
  const known = [...new Set([...asList(github[hexcode]), ...asList(iamcal[hexcode])])];
  return known.length ? known : asList(emojibase[hexcode]).slice(0, 1);
}

for (const lang of LANGS) {
  const data = require(`emojibase-data/${lang}/data.json`);
  const emojis = data
    .filter((e) => typeof e.group === 'number' && e.group !== COMPONENT_GROUP && hasPicture(e.emoji))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((e) => {
      const skins = (e.skins ?? [])
        .filter((s) => typeof s.tone === 'number')
        .sort((a, b) => a.tone - b.tone)
        .map((s) => s.emoji);
      const entry = [e.emoji, e.label, e.group, shortcodesFor(e.hexcode), e.tags ?? []];
      if (skins.length === 5 && skins.every(hasPicture)) entry.push(skins);
      return entry;
    });
  const dir = path.join(outRoot, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'emojis.json'), JSON.stringify({ version, emojis }));
  console.log(`${lang}: ${emojis.length} emojis`);
}
