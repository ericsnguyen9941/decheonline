import { decodeServerMessage, encode, type ClientMessage, type ServerMessage } from '@aoe/protocol';

/** Connection to the relay: send client messages, subscribe to server messages. Modules share one link. */
export interface Link {
  send(message: ClientMessage): void;
  /** Returns an unsubscribe function. */
  onMessage(handler: (message: ServerMessage) => void): () => void;
  /** Called once when the connection drops or is closed. */
  onClose(handler: () => void): void;
  close(): void;
}

/** ws(s) URL of the relay on the page's own origin; the dev server proxies `/ws` to the game server. */
export function relayUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export function connect(url: string = relayUrl()): Promise<Link> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const handlers = new Set<(message: ServerMessage) => void>();
    const closeHandlers: (() => void)[] = [];
    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const decoded = decodeServerMessage(event.data);
      if (decoded.ok) for (const handler of [...handlers]) handler(decoded.message);
    });
    socket.addEventListener('close', () => {
      for (const handler of closeHandlers) handler();
    });
    socket.addEventListener('error', () => reject(new Error('cannot reach the game server')), { once: true });
    socket.addEventListener(
      'open',
      () =>
        resolve({
          send: (message) => socket.send(encode(message)),
          onMessage(handler) {
            handlers.add(handler);
            return () => handlers.delete(handler);
          },
          onClose: (handler) => closeHandlers.push(handler),
          close: () => socket.close(),
        }),
      { once: true },
    );
  });
}
