import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fromUserCwd } from '../src/cli/common.js';

describe('fromUserCwd', () => {
  const original = process.env.INIT_CWD;
  afterEach(() => {
    process.env.INIT_CWD = original;
  });

  it('resolves a relative path against the folder the command was typed in, not server/', () => {
    process.env.INIT_CWD = path.resolve('/projects/youtube-flix');
    expect(fromUserCwd('catalog.db')).toBe(path.resolve('/projects/youtube-flix/catalog.db'));
  });

  it('keeps absolute paths and returns undefined when no path is given', () => {
    expect(fromUserCwd(path.resolve('/elsewhere/catalog.db'))).toBe(path.resolve('/elsewhere/catalog.db'));
    expect(fromUserCwd(undefined)).toBeUndefined();
  });
});
