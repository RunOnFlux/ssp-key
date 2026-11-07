import fs from 'fs';
import path from 'path';

/**
 * Release-pipeline hardening (security review DEP-3 / DEP-5):
 * - dependency install scripts never run automatically;
 * - the release keystore is decoded in a plain run step, only for v* tags,
 *   behind a protected environment, with SHA-pinned actions.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const WORKFLOWS = ['android_release.yml', 'android_release_self_hosted.yml'];

describe('install-script policy', () => {
  it('disables install scripts for yarn classic', () => {
    expect(read('.yarnrc')).toMatch(/^ignore-scripts true$/m);
  });

  it('allows only the root postinstall', () => {
    const pkg = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
      lavamoat: { allowScripts: Record<string, boolean> };
    };
    const allowed = Object.entries(pkg.lavamoat.allowScripts)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    expect(allowed).toEqual(['$root$']);
    expect(pkg.scripts.setup).toBe('allow-scripts');
  });
});

describe.each(WORKFLOWS)('workflow %s', (name) => {
  const src = read(path.join('.github', 'workflows', name));

  it('pins every action by full commit SHA', () => {
    const uses = [...src.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(
      (m) => m[1],
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(u).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('never hands the keystore to a third-party action', () => {
    expect(src).not.toMatch(/base64-to-file/);
    expect(src).toMatch(/base64 -d > android\/app\/release\.keystore/);
    expect(src).toMatch(/rm -f android\/app\/release\.keystore/);
  });

  it('signs only for v* tags, behind the android-release environment', () => {
    expect(src).toMatch(/^permissions: \{\}$/m);
    expect(src).toMatch(/environment: android-release/);
    const buildJob = src.slice(src.indexOf('build-android:'));
    expect(buildJob).toMatch(/if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  });

  it('installs with a frozen lockfile and no install scripts', () => {
    expect(src).toMatch(/yarn install --frozen-lockfile --ignore-scripts/);
    expect(src).not.toMatch(/run: \|?\s*\n?\s*yarn\s*$/m);
    expect(src).not.toMatch(/^\s*cache:\s*["']?yarn/m);
  });
});

describe('self-hosted workflow', () => {
  it('no longer runs on every branch push', () => {
    const src = read('.github/workflows/android_release_self_hosted.yml');
    const on = src.slice(src.indexOf('\non:'), src.indexOf('\npermissions:'));
    expect(on).not.toMatch(/branches/);
    expect(on).toMatch(/tags:\s*\n\s*-\s*'v\*'/);
  });
});

describe('iOS Xcode Cloud post-clone script', () => {
  const src = read('ios/ci_scripts/ci_post_clone.sh');

  it('installs with a frozen lockfile and no install scripts, then runs setup', () => {
    expect(src).toMatch(
      /^yarn install --frozen-lockfile --ignore-scripts\nyarn setup$/m,
    );
  });

  it('never runs a bare `yarn` install', () => {
    expect(src).not.toMatch(/^\s*yarn\s*$/m);
    expect(src).not.toMatch(/^\s*yarn install\s*$/m);
  });
});

describe('gradle wrapper', () => {
  it('pins the distribution checksum', () => {
    expect(read('android/gradle/wrapper/gradle-wrapper.properties')).toMatch(
      /^distributionSha256Sum=[0-9a-f]{64}$/m,
    );
  });
});
