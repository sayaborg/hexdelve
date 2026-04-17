export class Hex {
  constructor(q, r) {
    this.q = q;
    this.r = r;
  }

  add(other) {
    return new Hex(this.q + other.q, this.r + other.r);
  }

  subtract(other) {
    return new Hex(this.q - other.q, this.r - other.r);
  }

  equals(other) {
    return this.q === other.q && this.r === other.r;
  }

  key() {
    return `${this.q},${this.r}`;
  }
}

// q/r 軸ベースの世界方向
// 0: ↘, 1: ↗, 2: ↑, 3: ↖, 4: ↙, 5: ↓
export const DIRECTIONS = [
  new Hex(1, 0),
  new Hex(1, -1),
  new Hex(0, -1),
  new Hex(-1, 0),
  new Hex(-1, 1),
  new Hex(0, 1),
];

export const DIRECTION_LABELS = ['↘ 0', '↗ 1', '↑ 2', '↖ 3', '↙ 4', '↓ 5'];
export const DIRECTION_ANGLES_DEG = [30, -30, -90, -150, 150, 90];

export function getNeighbor(hex, direction) {
  return hex.add(DIRECTIONS[direction]);
}

export function cubeS(hex) {
  return -hex.q - hex.r;
}

export function hexDistance(a, b) {
  return Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(cubeS(a) - cubeS(b)),
  );
}

export function isInsideWorld(hex, radius) {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(cubeS(hex))) <= radius;
}

export function generateHexDisk(radius) {
  const result = [];
  for (let q = -radius; q <= radius; q += 1) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r += 1) {
      result.push(new Hex(q, r));
    }
  }
  return result;
}

export function hexToPixel(hex, size, originX, originY) {
  const x = size * (3 / 2) * hex.q;
  const y = size * (Math.sqrt(3) * (hex.r + hex.q / 2));
  return { x: originX + x, y: originY + y };
}

export function pixelToFractionalHex(x, y, size = 1) {
  const q = ((2 / 3) * x) / size;
  const r = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size;
  return { q, r };
}

export function cubeRound(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);

  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  } else {
    s = -q - r;
  }

  return new Hex(q, r);
}

export function pixelToHex(x, y, size = 1) {
  const frac = pixelToFractionalHex(x, y, size);
  return cubeRound(frac.q, frac.r);
}

export function polygonCorners(centerX, centerY, size) {
  const corners = [];
  for (let i = 0; i < 6; i += 1) {
    const angleDeg = 60 * i;
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({
      x: centerX + size * Math.cos(angleRad),
      y: centerY + size * Math.sin(angleRad),
    });
  }
  return corners;
}

export function cloneHex(hex) {
  return new Hex(hex.q, hex.r);
}
