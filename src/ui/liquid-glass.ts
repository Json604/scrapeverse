export interface LensDisplacementOptions {
  width: number;
  height: number;
  radius: number;
  depth?: number;
}

export interface LensDisplacementMap {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedRectangleDistance(x: number, y: number, width: number, height: number, radius: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const safeRadius = clamp(radius, 0, Math.min(halfWidth, halfHeight));
  const qx = Math.abs(x) - (halfWidth - safeRadius);
  const qy = Math.abs(y) - (halfHeight - safeRadius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);

  return outside + inside - safeRadius;
}

/**
 * Builds the red/green displacement texture described in Aave's glass article.
 * Neutral pixels are 128/128. The lens edge encodes its outward normal in R/G,
 * letting SVG bend the rendered target without sampling or repainting the page.
 */
export function createLensDisplacementMap({
  width,
  height,
  radius,
  depth = 10,
}: LensDisplacementOptions): LensDisplacementMap {
  const mapWidth = clamp(Math.round(width), 8, 256);
  const mapHeight = clamp(Math.round(height), 8, 256);
  const safeDepth = Math.max(1, depth);
  const pixels = new Uint8ClampedArray(mapWidth * mapHeight * 4);

  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const localX = x + 0.5 - mapWidth / 2;
      const localY = y + 0.5 - mapHeight / 2;
      const distance = roundedRectangleDistance(localX, localY, mapWidth, mapHeight, radius);
      const offset = (y * mapWidth + x) * 4;

      pixels[offset] = 128;
      pixels[offset + 1] = 128;
      pixels[offset + 2] = 128;
      pixels[offset + 3] = distance <= 0 ? 255 : 0;

      if (distance > 0 || -distance >= safeDepth) continue;

      const epsilon = 0.75;
      const gradientX = roundedRectangleDistance(localX + epsilon, localY, mapWidth, mapHeight, radius)
        - roundedRectangleDistance(localX - epsilon, localY, mapWidth, mapHeight, radius);
      const gradientY = roundedRectangleDistance(localX, localY + epsilon, mapWidth, mapHeight, radius)
        - roundedRectangleDistance(localX, localY - epsilon, mapWidth, mapHeight, radius);
      const magnitude = Math.hypot(gradientX, gradientY) || 1;
      const edgeProgress = 1 - clamp(-distance / safeDepth, 0, 1);
      const falloff = edgeProgress * edgeProgress * (3 - 2 * edgeProgress);

      pixels[offset] = Math.round(128 + (gradientX / magnitude) * 127 * falloff);
      pixels[offset + 1] = Math.round(128 + (gradientY / magnitude) * 127 * falloff);
    }
  }

  return { width: mapWidth, height: mapHeight, pixels };
}
