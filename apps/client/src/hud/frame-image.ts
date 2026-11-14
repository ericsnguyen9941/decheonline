import type { ImageFrame } from '../assets';

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let image = images.get(url);
  if (!image) {
    image = new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`cannot load ${url}`));
      el.src = url;
    });
    images.set(url, image);
  }
  return image;
}

/** Paints `frame` as the background of `el` (which the caller sizes), at the atlas's own pixels. */
export function paintFrame(el: HTMLElement, frame: ImageFrame | null): void {
  el.style.backgroundImage = frame ? `url(${frame.url})` : '';
  el.style.backgroundPosition = frame ? `-${frame.x}px -${frame.y}px` : '';
}

/** The frame cut out of its atlas as a data URL (for `cursor` and repeating backgrounds, which cannot take a sub-rectangle). */
export async function frameDataUrl(frame: ImageFrame): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.w;
  canvas.height = frame.h;
  canvas.getContext('2d')!.drawImage(await loadImage(frame.url), frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
  return canvas.toDataURL('image/png');
}

/** A CSS `cursor` value drawing `frame` with its hotspot. */
export async function frameCursor(frame: ImageFrame, fallback: string): Promise<string> {
  return `url(${await frameDataUrl(frame)}) ${frame.hotspotX} ${frame.hotspotY}, ${fallback}`;
}
