import { createSourceMap } from './map-source.js';

export function convertFloorSetToSourceMap({ radius, floor, meta = {} }) {
  const cells = Array.from(floor).map((key) => {
    const [q, r] = key.split(',').map(Number);
    return {
      q,
      r,
      support: 'stable',
      structureKind: 'room',
    };
  });
  return createSourceMap({ radius, cells, meta: { family: 'fixed_v1', ...meta } });
}
