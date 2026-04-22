import { CONFIG } from './config.js';
import {
  EDGE_DIRECTIONS,
  HEADING_ANGLES_DEG,
  Hex,
  getNeighbor,
  hexDistance,
  hexToPixel,
  isInsideWorld,
  pixelToHex,
} from './hex.js';
import { allWorldCells, isOpaque } from './map.js';

export function getWorldCenter(hex) {
  return hexToPixel(hex, 1, 0, 0);
}

export function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}

export function collectHexesAlongRay(start, end, offset) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const perp = normalizeVector(-dy, dx);
  const s = { x: start.x + perp.x * offset, y: start.y + perp.y * offset };
  const e = { x: end.x + perp.x * offset, y: end.y + perp.y * offset };
  const dist = Math.hypot(e.x - s.x, e.y - s.y);
  const steps = Math.max(1, Math.ceil(dist / CONFIG.losSampleStep));
  const result = [];
  let lastKey = null;

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = s.x + (e.x - s.x) * t;
    const y = s.y + (e.y - s.y) * t;
    const hex = pixelToHex(x, y, 1);
    if (!isInsideWorld(hex, CONFIG.worldRadius)) {
      continue;
    }
    const key = hex.key();
    if (key !== lastKey) {
      result.push(hex);
      lastKey = key;
    }
  }

  return result;
}

export function hasLOS(source, target) {
  if (source.equals(target)) {
    return true;
  }

  const start = getWorldCenter(source);
  const end = getWorldCenter(target);
  const offsets = [0, CONFIG.losEpsilon, -CONFIG.losEpsilon];

  for (const offset of offsets) {
    const traversed = collectHexesAlongRay(start, end, offset);
    let blocked = false;

    for (const cell of traversed) {
      if (cell.equals(source)) {
        continue;
      }
      if (cell.equals(target)) {
        return true;
      }
      if (isOpaque(cell)) {
        blocked = true;
        break;
      }
    }

    if (!blocked) {
      return true;
    }
  }

  return false;
}

export function isWithinFOV(source, target, facing, halfAngleDeg) {
  if (source.equals(target)) {
    return true;
  }

  const sourcePx = getWorldCenter(source);
  const targetPx = getWorldCenter(target);
  const facingPx = getWorldCenter(EDGE_DIRECTIONS[facing]);
  const toTarget = normalizeVector(targetPx.x - sourcePx.x, targetPx.y - sourcePx.y);
  const facingVec = normalizeVector(facingPx.x, facingPx.y);
  const dot = toTarget.x * facingVec.x + toTarget.y * facingVec.y;
  const threshold = Math.cos((halfAngleDeg * Math.PI) / 180);
  return dot >= threshold - 1e-9;
}

export function stabilizeVisibleSet(source, candidateVisible) {
  const ordered = [...candidateVisible]
    .map((key) => {
      const [q, r] = key.split(',').map(Number);
      return new Hex(q, r);
    })
    .sort((a, b) => {
      const da = hexDistance(source, a);
      const db = hexDistance(source, b);
      return da - db;
    });

  const stable = new Set([source.key()]);

  for (const cell of ordered) {
    const distance = hexDistance(source, cell);
    if (cell.key() === source.key()) {
      continue;
    }
    if (distance <= 1) {
      stable.add(cell.key());
      continue;
    }

    let supported = false;
    for (let heading = 0; heading < 6; heading += 1) {
      const neighbor = getNeighbor(cell, heading);
      if (!stable.has(neighbor.key())) {
        continue;
      }
      if (hexDistance(source, neighbor) === distance - 1) {
        supported = true;
        break;
      }
    }

    if (supported) {
      stable.add(cell.key());
    }
  }

  return stable;
}

export function computePerception(source, facing, profileName) {
  const profile = CONFIG.perceptionProfiles[profileName];
  const nearAware = new Set();

  for (const cell of allWorldCells) {
    const distance = hexDistance(source, cell);
    if (distance > 0 && distance <= profile.adjacentAwareRadius) {
      nearAware.add(cell.key());
    }
  }

  const candidateVisible = new Set([source.key()]);

  for (const cell of allWorldCells) {
    if (hexDistance(source, cell) > profile.visionRadius) {
      continue;
    }
    if (!isWithinFOV(source, cell, facing, profile.fovHalfAngleDeg)) {
      continue;
    }
    if (!hasLOS(source, cell)) {
      continue;
    }
    candidateVisible.add(cell.key());
  }

  return {
    visible: stabilizeVisibleSet(source, candidateVisible),
    nearAware,
  };
}

export function bestFacingToward(from, target) {
  const fromPx = getWorldCenter(from);
  const targetPx = getWorldCenter(target);
  const toTarget = normalizeVector(targetPx.x - fromPx.x, targetPx.y - fromPx.y);
  let bestHeading = 0;
  let bestDot = -Infinity;

  for (let heading = 0; heading < 6; heading += 1) {
    const angleDeg = HEADING_ANGLES_DEG[heading];
    const angleRad = (angleDeg * Math.PI) / 180;
    const facingVec = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const dot = toTarget.x * facingVec.x + toTarget.y * facingVec.y;
    if (dot > bestDot) {
      bestDot = dot;
      bestHeading = heading;
    }
  }

  return bestHeading;
}
