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

// flat-top orientation、edge 0 = N(上)、時計回り(GLOSSARY §1)
// heading と edgeIndex は番号規則共通。
//   0: N(↑)  1: NE(↗)  2: SE(↘)  3: S(↓)  4: SW(↙)  5: NW(↖)
export const EDGE_DIRECTIONS = [
  new Hex(0, -1),   // 0: N
  new Hex(1, -1),   // 1: NE
  new Hex(1, 0),    // 2: SE
  new Hex(0, 1),    // 3: S
  new Hex(-1, 1),   // 4: SW
  new Hex(-1, 0),   // 5: NW
];

// 画面上の角度(度、+x が 0°、+y が 90°。画面 y 軸は下向き → -90° は画面上向き)
export const HEADING_ANGLES_DEG = [-90, -30, 30, 90, 150, -150];

export const HEADING_LABELS = ['↑ 0 N', '↗ 1 NE', '↘ 2 SE', '↓ 3 S', '↙ 4 SW', '↖ 5 NW'];

// vertex N = edge N と edge (N+1) mod 6 の間の頂点(GLOSSARY §1)
// タイル中心から size=1 の単位で、polygonCorners と同じ極座標系で表したオフセット。
//   0: NE 寄り(-60°)  1: E(0°)   2: SE 寄り(60°)
//   3: SW 寄り(120°)  4: W(180°) 5: NW 寄り(-120°)
// v0 では未使用だが schema として用意。
const SQRT3_HALF = Math.sqrt(3) / 2;
export const VERTEX_OFFSETS = [
  { x:  0.5, y: -SQRT3_HALF }, // 0: NE 寄り
  { x:  1.0, y:  0          }, // 1: E
  { x:  0.5, y:  SQRT3_HALF }, // 2: SE 寄り
  { x: -0.5, y:  SQRT3_HALF }, // 3: SW 寄り
  { x: -1.0, y:  0          }, // 4: W
  { x: -0.5, y: -SQRT3_HALF }, // 5: NW 寄り
];

export function oppositeHeading(heading) {
  return (heading + 3) % 6;
}

export function oppositeEdge(edgeIndex) {
  return (edgeIndex + 3) % 6;
}

export function getNeighbor(hex, heading) {
  return hex.add(EDGE_DIRECTIONS[heading]);
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
