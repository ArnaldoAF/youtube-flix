import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/release.mjs', import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A tiny repo shaped like this one: root package.json with inline arrays, and a lockfile. */
function repo(version = '0.1.0'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytf-release-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `{\n  "name": "youtube-flix",\n  "private": true,\n  "version": "${version}",\n  "workspaces": ["server", "client"]\n}\n`,
  );
  const lock = { name: 'youtube-flix', version, lockfileVersion: 3, packages: { '': { name: 'youtube-flix', version }, 'node_modules/x': { version } } };
  fs.writeFileSync(path.join(dir, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const release = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const read = (dir: string, file: string) => fs.readFileSync(path.join(dir, file), 'utf8');

describe('npm run release', () => {
  it('bumps the version, commits it and tags it', () => {
    const dir = repo();
    const r = release(dir, 'minor');

    expect(r.status, r.stderr).toBe(0);
    expect(read(dir, 'package.json')).toContain('"version": "0.2.0"');
    expect(read(dir, 'package.json')).toContain('"workspaces": ["server", "client"]');
    const lock = JSON.parse(read(dir, 'package-lock.json'));
    expect([lock.version, lock.packages[''].version, lock.packages['node_modules/x'].version]).toEqual(['0.2.0', '0.2.0', '0.1.0']);
    expect(git(dir, 'tag')).toBe('v0.2.0');
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('release: v0.2.0');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(r.stdout).toContain('git push --follow-tags');
  });

  it('knows patch, minor, major and an exact version', () => {
    const dir = repo('1.4.2');
    expect(release(dir, 'patch').status).toBe(0);
    expect(release(dir, 'major').status).toBe(0);
    expect(release(dir, '2.1.0').status).toBe(0);
    expect(git(dir, 'tag', '--sort=v:refname').split('\n')).toEqual(['v1.4.3', 'v2.0.0', 'v2.1.0']);
  });

  it('refuses without a valid bump, and changes nothing', () => {
    const dir = repo();
    for (const arg of [[], ['huge'], ['1.2'], ['0.0.9'], ['0.1.0'], ['01.2.3'], ['1.02.0']]) {
      const r = release(dir, ...arg);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/release/i);
    }
    expect(git(dir, 'tag')).toBe('');
    expect(git(dir, 'log', '--format=%s')).toBe('init');
  });

  it('refuses with uncommitted changes, but ignores untracked files', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'scratch.txt'), 'untracked');
    fs.appendFileSync(path.join(dir, 'package-lock.json'), ' ');
    expect(release(dir, 'patch').stderr).toMatch(/uncommitted/i);
    git(dir, 'checkout', '--', 'package-lock.json');
    expect(release(dir, 'patch').status).toBe(0);
  });

  it('puts everything back when Git refuses the release commit', () => {
    const dir = repo();
    const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hook, 0o755);

    const r = release(dir, 'patch');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/^release: /);
    expect(r.stderr).not.toMatch(/\n\s+at /); // a message, not a stack trace
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no')).toBe('');
    expect(read(dir, 'package.json')).toContain('"version": "0.1.0"');
    expect(git(dir, 'tag')).toBe('');

    fs.rmSync(hook);
    expect(release(dir, 'patch').status).toBe(0);
  });

  it('undoes the release commit when the tag cannot be made', () => {
    const dir = repo();
    // A branch-like ref blocks creating the tag ref without existing as a tag.
    fs.mkdirSync(path.join(dir, '.git', 'refs', 'tags', 'v0.1.1'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'refs', 'tags', 'v0.1.1', 'x'), git(dir, 'rev-parse', 'HEAD'));

    expect(release(dir, 'patch').status).not.toBe(0);
    expect(git(dir, 'log', '--format=%s')).toBe('init');
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });

  it('works when started from a subfolder', () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, 'server'));
    expect(release(path.join(dir, 'server'), 'patch').status).toBe(0);
    expect(git(dir, 'tag')).toBe('v0.1.1');
  });

  it('refuses outside main and when the tag already exists', () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    expect(release(dir, 'patch').stderr).toMatch(/main/);
    git(dir, 'checkout', '-q', 'main');
    git(dir, 'tag', 'v0.1.1');
    expect(release(dir, 'patch').stderr).toMatch(/already exists/);
    expect(read(dir, 'package.json')).toContain('"version": "0.1.0"');
  });
});
