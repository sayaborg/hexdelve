export function bindControls(handlers) {
  document.getElementById('rotateLeftBtn').addEventListener('click', () => handlers.rotatePreview(-1));
  document.getElementById('rotateRightBtn').addEventListener('click', () => handlers.rotatePreview(1));
  document.getElementById('waitBtn').addEventListener('click', handlers.waitAction);

  document.querySelectorAll('[data-local-move]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.tryMove(Number(button.dataset.localMove));
    });
  });

  const mapSelect = document.getElementById('mapSelect');
  const resetMapBtn = document.getElementById('resetMapBtn');

  if (mapSelect) {
    mapSelect.addEventListener('change', (event) => {
      handlers.onSelectMap?.(event.target.value);
    });
  }

  if (resetMapBtn) {
    resetMapBtn.addEventListener('click', () => {
      handlers.onResetMap?.();
    });
  }
}

export function bindKeyboard(handlers) {
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      handlers.rotatePreview(-1);  // 左矢印 = 反時計回り(新規則では heading - 1)
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      handlers.rotatePreview(1);   // 右矢印 = 時計回り(新規則では heading + 1)
      return;
    }

    const keyToLocalMove = { q: 5, w: 0, e: 1, a: 4, s: 3, d: 2 };
    if (key in keyToLocalMove) {
      event.preventDefault();
      handlers.tryMove(keyToLocalMove[key]);
    }
  });
}
