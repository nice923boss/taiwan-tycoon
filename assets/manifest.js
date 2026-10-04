// Art asset manifest: prefers ComfyUI-generated PNGs, falls back to SVG placeholders.
// URLs are relative to the document (no leading slash) so the site also works
// when served from a GitHub Pages subpath such as https://user.github.io/repo/.

export const ASSET_NAMES = Object.freeze([
  'char-bear', 'char-leopardcat', 'char-magpie', 'char-pangolin', 'char-macaque', 'char-deer',
  'bg-lobby', 'bg-table', 'board-center', 'card-chance', 'card-fate',
]);

export const generatedUrl = (name) => `assets/generated/${name}.png`;
export const placeholderUrl = (name) => `assets/placeholders/${name}.svg`;

const imagePromises = new Map(); // name -> Promise<HTMLImageElement>
const loadedUrls = new Map(); // name -> URL the image actually loaded from

// `Image` is only touched here, so importing this module in Node does not throw.
function tryLoad(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error(`Failed to load ${url}`));
    img.src = url;
  });
}

// Resolves with the generated PNG if present, otherwise the placeholder SVG.
// Rejects only when both fail; a failed entry is dropped so a later call can retry.
export function loadImage(name) {
  if (!imagePromises.has(name)) {
    const promise = tryLoad(generatedUrl(name))
      .catch(() => tryLoad(placeholderUrl(name)))
      .then(({ img, url }) => {
        loadedUrls.set(name, url);
        return img;
      }, () => {
        imagePromises.delete(name);
        throw new Error(`Asset "${name}": both ${generatedUrl(name)} and ${placeholderUrl(name)} failed to load`);
      });
    imagePromises.set(name, promise);
  }
  return imagePromises.get(name);
}

// Sync URL for <img> tags: the generated PNG only after loadImage(name) has resolved to it,
// otherwise the placeholder. Callers that care about showing final art should await loadImage first.
export const assetSrc = (name) => loadedUrls.get(name) ?? placeholderUrl(name);
