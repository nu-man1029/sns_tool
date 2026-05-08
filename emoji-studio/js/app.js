/* ============================================================
 * EMOJI STUDIO - メインロジック / 状態管理
 * Phase 1: モード選択 / グリッド表示 / ステータス管理
 * ============================================================ */

const MAX_SLOTS = 40;

const MODE_CONFIG = {
  sticker: {
    label: 'スタンプ',
    width: 320,
    height: 270,
    maxKB: 300,
    fileNamePattern: (i) => String(i + 1).padStart(2, '0') + '.png', // 01.png〜40.png
  },
  emoji: {
    label: '絵文字',
    width: 240,
    height: 240,
    maxKB: 1024,
    fileNamePattern: (i) => String(i + 1).padStart(3, '0') + '.png', // 001.png〜040.png
  },
};

/** アプリ状態 */
const state = {
  mode: null,                 // 'sticker' | 'emoji'
  slots: createEmptySlots(),  // 40個のスロット
};

function createEmptySlots() {
  const arr = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    arr.push({
      index: i,
      status: 'empty',  // empty | editing | done
      image: null,      // dataURL
      fileName: null,
      animation: null,  // Phase 2 以降
    });
  }
  return arr;
}

/* ============================================================
 * 起動
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initModeModal();
  renderGrid();
  bindGlobalEvents();
});

/* ============================================================
 * モード選択モーダル
 * ============================================================ */
function initModeModal() {
  const modal = document.getElementById('mode-modal');
  const buttons = modal.querySelectorAll('.mode-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      setMode(mode);
      modal.classList.add('hidden');
    });
  });
}

function setMode(mode) {
  state.mode = mode;
  const conf = MODE_CONFIG[mode];
  const badge = document.getElementById('mode-badge');
  badge.textContent = `${conf.label} ${conf.width}×${conf.height}`;
}

/* ============================================================
 * グリッド描画
 * ============================================================ */
function renderGrid() {
  const grid = document.getElementById('slot-grid');
  grid.innerHTML = '';
  state.slots.forEach((slot, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = i;
    el.dataset.status = slot.status;
    if (!slot.image) el.classList.add('is-empty');

    el.innerHTML = `
      <span class="slot-number">${String(i + 1).padStart(2, '0')}</span>
      ${slot.image
        ? `<img class="slot-image" src="${slot.image}" alt="slot-${i + 1}">`
        : `<span class="slot-placeholder">+</span>`}
      <span class="slot-status" title="${slotStatusLabel(slot.status)}"></span>
    `;
    el.addEventListener('click', () => onSlotClick(i));
    grid.appendChild(el);
  });
  updateUploadCount();
}

function slotStatusLabel(s) {
  return { empty: '未設定', editing: '設定中', done: '確認済' }[s] || s;
}

function updateUploadCount() {
  const filled = state.slots.filter(s => s.image).length;
  document.getElementById('upload-count').textContent = `${filled} / ${MAX_SLOTS} 枚`;
  const btnAll = document.getElementById('btn-download-all');
  btnAll.disabled = state.slots.every(s => s.status !== 'done');
}

/* ============================================================
 * スロットクリック (Phase 2 で編集モーダル)
 * ============================================================ */
function onSlotClick(index) {
  const slot = state.slots[index];
  if (!slot.image) {
    showToast('画像が未設定です。アップロードしてください。');
    return;
  }
  if (window.EmojiStudioAnimator) {
    window.EmojiStudioAnimator.open(index);
  }
}

/* ============================================================
 * 画像セット (uploader.js から呼ばれる)
 * ============================================================ */
function setSlotImage(index, dataURL, fileName) {
  if (index < 0 || index >= MAX_SLOTS) return;
  const slot = state.slots[index];
  slot.image = dataURL;
  slot.fileName = fileName;
  slot.status = 'editing';
  renderGrid();
}

function findNextEmptySlot() {
  return state.slots.findIndex(s => !s.image);
}

/* ============================================================
 * 全クリア
 * ============================================================ */
function bindGlobalEvents() {
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (state.slots.every(s => !s.image)) return;
    if (!confirm('アップロード済み画像をすべて削除します。よろしいですか？')) return;
    state.slots = createEmptySlots();
    renderGrid();
    showToast('クリアしました');
  });

  document.getElementById('btn-download-all').addEventListener('click', () => {
    showToast('一括ダウンロードは Phase 4 で実装');
  });
}

/* ============================================================
 * Toast
 * ============================================================ */
let toastTimer = null;
function showToast(message, type = '') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* expose to other modules */
window.EmojiStudio = {
  state,
  setSlotImage,
  findNextEmptySlot,
  showToast,
  renderGrid,
  MAX_SLOTS,
  MODE_CONFIG,
};
