/**
 * The "Crash reports dSYM upload" phase (ios/App/App.xcodeproj): a clean Debug
 * build has no dSYM (DEBUG_INFORMATION_FORMAT = dwarf), so the phase must not
 * declare dSYM inputs there, or Xcode fails the build for a missing input
 * (review #277, Codex B1). The dSYM inputs go in a per-configuration file
 * list: Release names them (the phase runs after dsymutil), Debug is empty.
 */
import { describe, it, expect } from 'vitest';

// The app's tsconfig has no Node types, hence the loose import.
const NODE_FS = 'node:fs';
const { readFileSync, existsSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, enc: 'utf8') => string;
  existsSync: (path: string) => boolean;
};
const { process } = globalThis as unknown as { process: { cwd(): string } };
const ROOT = `${process.cwd()}/ios/App`; // vitest runs from the repo root
const pbx = readFileSync(`${ROOT}/App.xcodeproj/project.pbxproj`, 'utf8');

const phase = (() => {
  const from = pbx.indexOf('/* Crash reports dSYM upload */ = {');
  expect(from).toBeGreaterThan(-1);
  return pbx.slice(from, pbx.indexOf('\n\t\t};', from));
})();
const list = (key: string) => {
  // One entry per line, up to the list's own closing "\t\t\t);" (an entry can hold brackets: $(SRCROOT)).
  const from = phase.indexOf(`${key} = (`);
  if (from === -1) return [];
  const body = phase.slice(from + key.length + 4, phase.indexOf('\n\t\t\t);', from));
  return body
    .split('\n')
    .map((l) => l.trim().replace(/,$/, '').replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
};
/** Release-only paths: the dSYM (Debug builds have none). */
const RELEASE_ONLY = /DWARF_DSYM|\.dSYM|DWARF/;

describe('Crash reports dSYM upload phase', () => {
  it('declares no inputPaths that exist only in Release', () => {
    for (const p of list('inputPaths')) expect(p, p).not.toMatch(RELEASE_ONLY);
  });

  it('its file lists are per configuration: Debug names no dSYM, Release names it', () => {
    const lists = list('inputFileListPaths');
    for (const l of lists) expect(l, 'a file list must depend on the configuration').toMatch(/\$[({]CONFIGURATION[)}]/);
    const resolve = (config: string) =>
      lists.map((l) => l.replace(/\$[({]CONFIGURATION[)}]/g, config).replace(/\$[({]SRCROOT[)}]/g, ROOT));
    for (const file of resolve('Debug')) {
      expect(existsSync(file), file).toBe(true);
      const entries = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      for (const e of entries) expect(e, `${file}: ${e}`).not.toMatch(RELEASE_ONLY);
    }
    // Release still waits for the dSYM (dsymutil first), when there is a list at all.
    const release = resolve('Release').flatMap((file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []));
    if (lists.length) expect(release.join('\n')).toMatch(/DWARF_DSYM_FOLDER_PATH/);
  });
});

describe('simulator builds skip the upload (Claude review of 3b26fc7c)', () => {
  it('exits before anything else on a simulator SDK', () => {
    const script = phase.slice(phase.indexOf('shellScript = "'));
    const sim = script.search(/case \\"\$PLATFORM_NAME\\" in\\n\s*\*simulator\) exit 0 ;;/);
    expect(sim, 'simulator skip').toBeGreaterThan(-1);
    expect(sim).toBeLessThan(script.indexOf('GoogleService-Info.plist\\" ]'));
  });
});
