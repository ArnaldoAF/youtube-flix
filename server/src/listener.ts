import type { Server } from 'node:http';
import type { Express } from 'express';

export type Network = 'local' | 'home';

export interface Listener {
  start(network: Network): Promise<string>;
  /** Queues a switch; overlapping calls run one after another, so the last requested mode wins. */
  rebind(network: Network): Promise<string>;
  stop(): Promise<void>;
}

function listenOn(app: Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Owns the one HTTP server. Switching between "this PC only" and "home network" closes it and
 * listens again in-process. If the wider address can't be bound, it falls back to the local one,
 * so the PC never loses its own UI.
 */
export function createListener(
  app: Express,
  port: number,
  hostFor: (network: Network) => string,
  localHost: string,
  log: (message: string) => void = console.log,
): Listener {
  let server: Server | null = null;
  let chain: Promise<string> = Promise.resolve(localHost);

  async function bind(network: Network): Promise<string> {
    const host = hostFor(network);
    try {
      server = await listenOn(app, port, host);
      return host;
    } catch (err) {
      if (host === localHost) throw err;
      log(`Could not listen on ${host}:${port} (${(err as Error).message}). Falling back to this PC only.`);
      server = await listenOn(app, port, localHost);
      return localHost;
    }
  }

  const closeCurrent = async () => {
    if (server) await close(server);
    server = null;
  };

  const enqueue = (step: () => Promise<string>) => {
    chain = chain.then(step, step);
    return chain;
  };

  return {
    start: (network) => enqueue(() => bind(network)),
    rebind: (network) =>
      enqueue(async () => {
        await closeCurrent();
        return bind(network);
      }),
    stop: async () => {
      await enqueue(async () => {
        await closeCurrent();
        return '';
      });
    },
  };
}
