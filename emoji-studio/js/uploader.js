/* ============================================================
 * EMOJI STUDIO - アップローダ
 * Phase 1: 個別PNG / ZIP の取り込み → 空きスロットへ流し込み
 * ============================================================ */

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('file-input');

    zone.addEventListener('click', () => input.click());

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      handleFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      input.value = '';
    });
  });

  /* ============================================================
   * 取り込みフロー
   * ============================================================ */
  async function handleFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    const studio = window.EmojiStudio;
    if (!studio.state.mode) {
      studio.showToast('先にモード（スタンプ / 絵文字）を選択してください', 'error');
      return;
    }

    const pngs = [];
    for (const f of files) {
      if (isZip(f)) {
        try {
          const extracted = await extractPngsFromZip(f);
          pngs.push(...extracted);
        } catch (err) {
          studio.showToast(`ZIP解凍に失敗: ${f.name}`, 'error');
          console.error(err);
        }
      } else if (isPng(f)) {
        pngs.push(f);
      }
    }

    if (!pngs.length) {
      studio.showToast('PNGが見つかりませんでした', 'error');
      return;
    }

    // ファイル名でソート (01.png, 02.png… の順を期待)
    pngs.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));

    let placed = 0;
    let skipped = 0;
    for (const file of pngs) {
      const idx = studio.findNextEmptySlot();
      if (idx === -1) { skipped = pngs.length - placed; break; }
      try {
        const dataURL = await fileToDataURL(file);
        studio.setSlotImage(idx, dataURL, file.name);
        placed++;
      } catch (err) {
        console.error(err);
      }
    }

    let msg = `${placed}枚を追加しました`;
    if (skipped > 0) msg += ` (${skipped}枚はスロット不足でスキップ)`;
    studio.showToast(msg);
  }

  /* ============================================================
   * ヘルパ
   * ============================================================ */
  function isPng(file) {
    return file.type === 'image/png' || /\.png$/i.test(file.name);
  }
  function isZip(file) {
    return file.type === 'application/zip' || /\.zip$/i.test(file.name);
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function extractPngsFromZip(zipFile) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip がロードされていません');
    }
    const zip = await JSZip.loadAsync(zipFile);
    const out = [];
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      if (!/\.png$/i.test(entry.name)) continue;
      // __MACOSX や 隠しファイル除外
      if (/(^|\/)\._/.test(entry.name)) continue;
      if (/__MACOSX\//.test(entry.name)) continue;
      const blob = await entry.async('blob');
      // 拡張子を保持した File 風オブジェクトに
      const baseName = entry.name.split('/').pop();
      out.push(new File([blob], baseName, { type: 'image/png' }));
    }
    return out;
  }
})();
