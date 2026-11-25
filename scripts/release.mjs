#!/usr/bin/env node
// Makes a new version: bumps package.json (and the lockfile), commits "release: vX.Y.Z" and tags it.
// Usage: npm run release -- patch | minor | major | X.Y.Z
// Nothing is pushed; it prints the command for that.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let root;
try {
  // The repository's top folder, so it also works when started from a subfolder.
  root = run(process.cwd(), ['rev-parse', '--show-toplevel']);
} catch {
  fail('this folder is not a Git repository');
}
const git = (...args) => run(root, args);

/** Strict semver numbers: no leading zeros ("01.2.3" is not a version npm accepts). */
const parse = (v) => {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  return m ? m.slice(1).map(Number) : null;
};
/** Git's own reason when there is one, otherwise the error's first line. */
const firstLine = (err) => (String(err.stderr || '').trim() || String(err.message)).split('\n')[0];

const newer =(a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

function nextVersion(current, bump) {
  const [major, minor, patch] = parse(current) ?? fail(`package.json has an unexpected version "${current}"`);
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'major') return `${major + 1}.0.0`;
  const exact = parse(bump ?? '');
  if (!exact) fail('say which version: patch, minor, major or an exact X.Y.Z (npm run release -- minor)');
  if (newer(exact, [major, minor, patch]) <= 0) fail(`${bump} is not newer than the current ${current}`);
  return bump;
}

/** Rewrites only the "version" field, keeping the file's own layout and line endings. */
function bumpPackageJson(file, from, to) {
  const text = fs.readFileSync(file, 'utf8');
  const pattern = new RegExp(`("version"\\s*:\\s*")${from.replace(/\./g, '\\.')}(")`);
  if (!pattern.test(text)) fail(`could not find version ${from} in ${path.basename(file)}`);
  fs.writeFileSync(file, text.replace(pattern, `$1${to}$2`));
}

/** npm writes the lockfile as 2-space JSON, so a round trip keeps it as npm would. Only the root entries change. */
function bumpLockfile(file, to) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, 'utf8');
  const lock = JSON.parse(text);
  lock.version = to;
  if (lock.packages?.['']) lock.packages[''].version = to;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`.replace(/\n/g, eol));
  return true;
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') fail(`releases are made from main, and this is ${branch}`);
if (git('status', '--porcelain', '--untracked-files=no')) fail('there are uncommitted changes; commit or stash them first');

const pkgFile = path.join(root, 'package.json');
const current = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
const version = nextVersion(current, process.argv[2]);
const tag = `v${version}`;
if (git('tag', '--list', tag)) fail(`tag ${tag} already exists`);

const lockFile = path.join(root, 'package-lock.json');
const originals = new Map([pkgFile, lockFile].filter((f) => fs.existsSync(f)).map((f) => [f, fs.readFileSync(f)]));
const before = git('rev-parse', 'HEAD');

try {
  bumpPackageJson(pkgFile, current, version);
  const files = ['package.json', ...(bumpLockfile(lockFile, version) ? ['package-lock.json'] : [])];
  git('add', '--', ...files);
  git('commit', '-q', '-m', `release: ${tag}`);
  git('tag', '-a', tag, '-m', tag);
} catch (err) {
  // Leave things exactly as they were: no release commit, nothing staged, the old files back.
  try {
    if (git('rev-parse', 'HEAD') !== before) git('reset', '-q', '--soft', before);
    git('reset', '-q', '--', ...[...originals.keys()].map((f) => path.basename(f)));
    originals.forEach((text, file) => fs.writeFileSync(file, text));
  } catch (undo) {
    fail(`${tag} failed and could not be fully undone (${firstLine(undo)}); check git status`);
  }
  fail(`${tag} was not made, nothing changed: ${firstLine(err)}`);
}

console.log(`Released ${tag} (was v${current}).`);
console.log('Rebuild to see it in the footer: npm run build');
console.log('Send it to GitHub with: git push --follow-tags');
