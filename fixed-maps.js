export const FIXED_MAPS = [
  {
    id: 'corner_fear',
    name: 'Corner Fear',
    description: '曲がり角の先に何がいるか分からない圧を確認する。',
    playerStart: { q: -8, r: 2, facing: 2 },
    goal: { q: 4, r: -4 },
    enemies: [
      { id: 'e1', name: 'Watcher', q: -1, r: -2, facing: 5, type: 'guard', profile: 'watcher', wt: 9 },
    ],
    floorCells: [
      [-8, 2], [-7, 2], [-6, 2], [-5, 2], [-4, 2],
      [-4, 1], [-3, 1], [-3, 0], [-2, 0], [-2, -1],
      [-1, -1], [-1, -2], [0, -2], [1, -3], [2, -4], [3, -4], [4, -4],
      [-7, 1], [-6, 1], [-5, 1],
    ],
  },
  {
    id: 'doorway_hall',
    name: 'Doorway Hall',
    description: '入口の先の広間に踏み込む怖さと見通しを確認する。',
    playerStart: { q: -9, r: 1, facing: 2 },
    goal: { q: 4, r: -2 },
    enemies: [
      { id: 'e1', name: 'Watcher', q: 1, r: -2, facing: 4, type: 'guard', profile: 'watcher', wt: 9 },
      { id: 'e2', name: 'Watcher', q: 3, r: -1, facing: 4, type: 'guard', profile: 'watcher', wt: 11 },
    ],
    floorCells: [
      [-9, 1], [-8, 1], [-7, 1], [-6, 1], [-5, 1], [-4, 1],
      [-3, 0], [-2, -1],
      [-1, -2], [0, -2], [1, -2], [2, -2], [3, -2], [4, -2],
      [0, -1], [1, -1], [2, -1], [3, -1],
      [0, -3], [1, -3], [2, -3], [3, -3],
      [-1, -1], [-1, -3], [4, -1], [4, -3],
    ],
  },
  {
    id: 'loop_recontact',
    name: 'Loop Recontact',
    description: '見失い後に別経路から再接触するかを見る。',
    playerStart: { q: -6, r: 3, facing: 2 },
    goal: { q: 5, r: -1 },
    enemies: [
      { id: 'e1', name: 'Watcher', q: 0, r: 0, facing: 5, type: 'guard', profile: 'watcher', wt: 10 },
    ],
    floorCells: [
      [-6, 3], [-5, 3], [-4, 3], [-3, 3], [-2, 3],
      [-2, 2], [-1, 2], [-1, 1], [0, 1], [0, 0], [1, 0], [2, -1], [3, -1], [4, -1], [5, -1],
      [-2, 4], [-1, 4], [0, 4], [1, 3], [2, 2], [2, 1], [1, 1], [0, 2], [-1, 3],
      [1, -1], [2, -2],
    ],
  },
];

export function getFixedMapById(id) {
  return FIXED_MAPS.find((map) => map.id === id) ?? FIXED_MAPS[0];
}
