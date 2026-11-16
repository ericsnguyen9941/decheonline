// Google Tag Manager events (the container is loaded by index.html in the production build only). The dataLayer is a plain
// array when the container is absent (dev, e2e, blocked host), so pushing is always safe. Nothing personal goes in.
declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export function track(event: string, params: Record<string, string | number> = {}): void {
  try {
    (window.dataLayer ??= []).push({ event, ...params });
  } catch {
    // Analytics never breaks the game.
  }
}
