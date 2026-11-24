import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

// The image installs only playground/package.json (playground/Dockerfile), while development, builds and
// tests run on the root's dependencies. A package the service imports but its own package.json lacks would
// pass every test here and then fail as the image starts; a version that drifts from the root's would ship
// code nobody tested.

const PLAYGROUND = path.resolve(import.meta.dirname, '..');
const ROOT = path.resolve(PLAYGROUND, '..');

function readJson(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const own = readJson(path.join(PLAYGROUND, 'package.json'));
const ownDeps: Record<string, string> = own.dependencies ?? {};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** The packages the service's code loads at runtime (type-only imports are erased). */
function importedPackages(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(path.join(PLAYGROUND, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/^\s*(?:import|export)\s+(?!type\s)[^'"]*?from\s+'([^'.][^']*)'/gm)) {
      const specifier = match[1]!;
      if (specifier.startsWith('node:')) continue;
      const parts = specifier.split('/');
      found.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!);
    }
  }
  return found;
}

describe('playground/package.json', () => {
  it('lists every package the service imports, and nothing else', () => {
    assert.deepEqual(Object.keys(ownDeps).sort(), [...importedPackages()].sort());
  });

  it('pins the versions the root lockfile installs', () => {
    const rootLock = readJson(path.join(ROOT, 'package-lock.json'));
    for (const [name, version] of Object.entries(ownDeps)) {
      assert.equal(version, rootLock.packages[`node_modules/${name}`]?.version, `${name} differs from the root lockfile`);
    }
  });

  it('matches its own lockfile', () => {
    const lock = readJson(path.join(PLAYGROUND, 'package-lock.json'));
    assert.deepEqual(lock.packages[''].dependencies, ownDeps);
  });

  it('keeps the compiled code an ES module', () => {
    assert.equal(own.type, 'module');
  });
});
