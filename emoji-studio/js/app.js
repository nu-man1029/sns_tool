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
      selected: false,  // Phase 4: ZIP選択用
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
  notifyDirty();
}

function notifyDirty() {
  if (window.EmojiStudioStorage) window.EmojiStudioStorage.markDirty();
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
    if (slot.selected && slot.status === 'done') el.classList.add('is-selected');

    const checkboxHTML = (slot.status === 'done')
      ? `<button class="slot-check" data-i="${i}" type="button" aria-label="選択">${slot.selected ? '✓' : ''}</button>`
      : '';
    const dlHTML = (slot.status === 'done')
      ? `<button class="slot-dl" data-i="${i}" type="button" title="このスロットをAPNGでDL" aria-label="ダウンロード">⬇</button>`
      : '';

    el.innerHTML = `
      <span class="slot-number">${String(i + 1).padStart(2, '0')}</span>
      ${checkboxHTML}
      ${dlHTML}
      ${slot.image
        ? `<img class="slot-image" src="${slot.image}" alt="slot-${i + 1}">`
        : `<span class="slot-placeholder">+</span>`}
      <span class="slot-status" title="${slotStatusLabel(slot.status)}"></span>
    `;

    el.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('slot-check')) {
        e.stopPropagation();
        toggleSlotSelection(i);
        return;
      }
      if (target.classList.contains('slot-dl')) {
        e.stopPropagation();
        downloadSingle(i);
        return;
      }
      onSlotClick(i);
    });
    grid.appendChild(el);
  });
  updateUploadCount();
}

function toggleSlotSelection(i) {
  const slot = state.slots[i];
  if (slot.status !== 'done') return;
  slot.selected = !slot.selected;
  renderGrid();
}

async function downloadSingle(i) {
  const exporter = window.EmojiStudioExporter;
  if (!exporter) return;
  try {
    showToast('APNG生成中…');
    const r = await exporter.exportOne(i);
    const conf = MODE_CONFIG[state.mode];
    const sizeKB = (r.size / 1024).toFixed(1);
    const over = r.size > conf.maxKB * 1024;
    showToast(
      `${r.name} を保存 (${sizeKB}KB${over ? ' ⚠上限超過' : ''})`,
      over ? 'error' : ''
    );
  } catch (err) {
    console.error(err);
    showToast(`書き出し失敗: ${err.message || err}`, 'error');
  }
}

function slotStatusLabel(s) {
  return { empty: '未設定', editing: '設定中', done: '確認済' }[s] || s;
}

function updateUploadCount() {
  const filled = state.slots.filter(s => s.image).length;
  document.getElementById('upload-count').textContent = `${filled} / ${MAX_SLOTS} 枚`;

  const doneCount = state.slots.filter(s => s.status === 'done').length;
  const selCount  = state.slots.filter(s => s.selected && s.status === 'done').length;
  const info = document.getElementById('selection-info');
  if (info) info.textContent = `完了 ${doneCount} / 選択 ${selCount}`;

  const btnAll = document.getElementById('btn-download-all');
  if (btnAll) btnAll.disabled = doneCount === 0;
  const btnSel = document.getElementById('btn-download-selected');
  if (btnSel) btnSel.disabled = selCount === 0;
  const btnSelectAll = document.getElementById('btn-select-all');
  if (btnSelectAll) btnSelectAll.disabled = doneCount === 0;
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
  notifyDirty();
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
    notifyDirty();
  });

  document.getElementById('btn-select-all').addEventListener('click', () => {
    const doneSlots = state.slots.filter(s => s.status === 'done');
    if (!doneSlots.length) return;
    const allSelected = doneSlots.every(s => s.selected);
    state.slots.forEach(s => {
      s.selected = (s.status === 'done') ? !allSelected : false;
    });
    renderGrid();
  });

  document.getElementById('btn-download-selected').addEventListener('click', async () => {
    const exp = window.EmojiStudioExporter;
    if (!exp) return;
    const btn = document.getElementById('btn-download-selected');
    btn.disabled = true;
    try { await exp.exportSelected(); }
    catch (err) { showToast(`選択ZIP DL 失敗: ${err.message || err}`, 'error'); }
    finally { updateUploadCount(); }
  });

  document.getElementById('btn-download-all').addEventListener('click', async () => {
    const exp = window.EmojiStudioExporter;
    if (!exp) return;
    const btn = document.getElementById('btn-download-all');
    btn.disabled = true;
    try { await exp.exportAllDone(); }
    catch (err) { showToast(`一括ZIP DL 失敗: ${err.message || err}`, 'error'); }
    finally { updateUploadCount(); }
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
