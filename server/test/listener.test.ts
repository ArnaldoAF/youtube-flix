import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createListener, type Network } from '../src/listener.js';

// 127.0.0.2 stands in for "the whole network" so tests never bind beyond loopback.
const PORT = 4187;
const reachable = (host: string) =>
  fetch(`http://${host}:${PORT}/`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  );

let stop: (() => Promise<unknown>) | null = null;
afterEach(async () => {
  await stop?.();
  stop = null;
});

function setup(homeHost = '127.0.0.2') {
  const app = express();
  app.get('/', (_req, res) => res.send('ok'));
  const logs: string[] = [];
  const listener = createListener(app, PORT, (n: Network) => (n === 'home' ? homeHost : '127.0.0.1'), '127.0.0.1', (m) => logs.push(m));
  stop = () => listener.stop();
  return { listener, logs };
}

describe('listener', () => {
  it('switches between local and home without a restart', async () => {
    const { listener } = setup();
    expect(await listener.start('local')).toBe('127.0.0.1');
    expect(await reachable('127.0.0.2')).toBe(false);
    expect(await listener.rebind('home')).toBe('127.0.0.2');
    expect(await reachable('127.0.0.2')).toBe(true);
    expect(await listener.rebind('local')).toBe('127.0.0.1');
    expect(await reachable('127.0.0.2')).toBe(false);
    expect(await reachable('127.0.0.1')).toBe(true);
  });

  it('overlapping switches end on the last requested mode with a single listener', async () => {
    const { listener } = setup();
    await listener.start('local');
    void listener.rebind('home');
    void listener.rebind('local');
    await listener.rebind('home');
    const last = listener.rebind('local');
    expect(await last).toBe('127.0.0.1');
    expect(await reachable('127.0.0.2')).toBe(false);
    expect(await reachable('127.0.0.1')).toBe(true);
  });

  it('falls back to this PC only when the network address cannot be bound', async () => {
    // 203.0.113.1 (TEST-NET-3) is never a local interface, so listening on it fails.
    const { listener, logs } = setup('203.0.113.1');
    await listener.start('local');
    expect(await listener.rebind('home')).toBe('127.0.0.1');
    expect(await reachable('127.0.0.1')).toBe(true);
    expect(logs.join('\n')).toMatch(/Falling back to this PC only/);
  });
});
