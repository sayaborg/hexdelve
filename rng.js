export function createRng(seed = 12345) {
  let state = seed >>> 0;

  function next() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  }

  return {
    seed,
    random() {
      return next();
    },
    int(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    pick(array) {
      if (!array.length) return null;
      return array[this.int(0, array.length - 1)];
    },
    chance(p) {
      return next() < p;
    },
    shuffle(array) {
      const copy = [...array];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}
