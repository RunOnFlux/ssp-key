import fs from 'fs';
import path from 'path';

/**
 * Release-pipeline hardening (security review DEP-3 / DEP-5):
 * - dependency install scripts never run automatically;
 * - the release keystore is decoded in a plain run step, only for protected
 *   master and v* tags, behind a protected environment, with SHA-pinned
 *   actions;
 * - every job runs on a GitHub-hosted runner: SSP Key is public, and a fork
 *   pull request can bring its own workflow onto any runner the repo reaches.
 */

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const WORKFLOWS = fs
  .readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f));

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

  it('signs only for protected master and v* tags, behind the android-release environment', () => {
    expect(src).toMatch(/^permissions: \{\}$/m);
    expect(src).toMatch(/environment: android-release/);
    const buildJob = src.slice(src.indexOf('build-android:'));
    // Other branches and pull requests (refs/pull/…) never reach signing.
    expect(buildJob).toMatch(
      /if: github\.ref == 'refs\/heads\/master' \|\| startsWith\(github\.ref, 'refs\/tags\/v'\)/,
    );
  });

  it('runs every job on a GitHub-hosted runner', () => {
    const runners = [...src.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) =>
      m[1].trim(),
    );
    expect(runners.length).toBeGreaterThan(0);
    for (const r of runners) {
      expect(r).toMatch(/^(ubuntu|windows|macos)-[\w.]+$/);
    }
  });

  it('installs with a frozen lockfile and no install scripts', () => {
    expect(src).toMatch(/yarn install --frozen-lockfile --ignore-scripts/);
    expect(src).not.toMatch(/run: \|?\s*\n?\s*yarn\s*$/m);
    expect(src).not.toMatch(/^\s*cache:\s*["']?yarn/m);
  });
});

describe('release publishing', () => {
  const src = read('.github/workflows/android_release.yml');
  const jobs = src.slice(src.indexOf('\njobs:'));
  const job = (name: string) => {
    const start = jobs.indexOf(`\n  ${name}:`);
    const next = jobs.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
    return next === -1
      ? jobs.slice(start)
      : jobs.slice(start, start + 1 + next);
  };

  it('publishes from its own tag-only job after the signed build', () => {
    const publish = job('publish-release');
    expect(publish).toMatch(/needs: build-android/);
    expect(publish).toMatch(/if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
    expect(publish).toMatch(/gh release create/);
  });

  it('gives write access only to the job without the signing secrets', () => {
    const publish = job('publish-release');
    expect(publish).toMatch(/contents: write/);
    expect(publish).not.toMatch(/secrets\./);
    expect(publish).not.toMatch(/environment:/);
    for (const name of ['install-and-test', 'build-android']) {
      expect(job(name)).not.toMatch(/contents: write/);
    }
  });
});

describe('workflows', () => {
  it('has the Android release workflow and nothing self-hosted', () => {
    expect(WORKFLOWS).toContain('android_release.yml');
    expect(WORKFLOWS).not.toContain('android_release_self_hosted.yml');
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
