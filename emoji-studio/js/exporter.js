/* ============================================================
 * EMOJI STUDIO - Phase 4: APNG書き出し / 個別DL / ZIP DL
 *  - UPNG.js (+ pako) で APNG エンコード
 *  - JSZip で複数ファイルをまとめる
 *  - ファイル名は MODE_CONFIG.fileNamePattern (LINE準拠)
 * ============================================================ */

(function () {
  /* ---------- 共通ヘルパ ---------- */
  function getMode() {
    const studio = window.EmojiStudio;
    return studio.MODE_CONFIG[studio.state.mode];
  }

  function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = dataURL;
    });
  }

  /** letterbox + transform 描画（animator と同じ計算式） */
  function drawTransformed(ctx, image, opts) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const dx = opts.dx || 0;
    const dy = opts.dy || 0;
    const scale  = opts.scale  ?? 1;
    const rotate = opts.rotate || 0;
    const alpha  = opts.alpha  ?? 1;

    const ratio = Math.min(W / image.width, H / image.height);
    const w = image.width  * ratio * scale;
    const h = image.height * ratio * scale;
    const cx = W / 2 + dx;
    const cy = H / 2 + dy;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (rotate) ctx.rotate(rotate);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /** 全フレームを RGBA ArrayBuffer の配列として生成 */
  async function renderFrames(slot, modeConf) {
    if (!window.UPNG) throw new Error('UPNG.js が読み込まれていません');
    const image = await loadImage(slot.image);

    const W = modeConf.width;
    const H = modeConf.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const anim = slot.animation || { preset: 'none', durationMs: 800, intensity: 100, fps: 12 };
    const presets = (window.EmojiStudioAnimator && window.EmojiStudioAnimator.PRESETS) || null;

    // 静止 (プリセットなし) → 1フレームの普通のPNGとして書き出す
    if (anim.preset === 'none' || !presets) {
      ctx.clearRect(0, 0, W, H);
      drawTransformed(ctx, image, {});
      const buf = ctx.getImageData(0, 0, W, H).data.buffer;
      return { frames: [buf], delays: [0], width: W, height: H, isStatic: true };
    }

    const preset = presets[anim.preset] || presets.none;
    const totalFrames   = Math.max(1, Math.round((anim.durationMs / 1000) * anim.fps));
    const delayPerFrame = Math.max(10, Math.round(anim.durationMs / totalFrames));
    const k = anim.intensity / 100;

    const frames = [];
    const delays = [];
    for (let i = 0; i < totalFrames; i++) {
      const t = i / totalFrames;
      ctx.clearRect(0, 0, W, H);
      preset.render(ctx, (opts) => drawTransformed(ctx, image, opts || {}), t, k);
      // ImageData.data の buffer は次フレームで上書きされるので必ず slice
      frames.push(ctx.getImageData(0, 0, W, H).data.buffer.slice(0));
      delays.push(delayPerFrame);
    }
    return { frames, delays, width: W, height: H, isStatic: false };
  }

  /** 1スロットを Blob (image/png) にエンコード */
  async function encodeSlot(slot, modeConf) {
    const { frames, delays, width, height, isStatic } = await renderFrames(slot, modeConf);
    // UPNG.encode(imgs, w, h, cnum, dels)
    //   cnum=0: 24bit truecolor + alpha (lossless)
    const arr = isStatic
      ? UPNG.encode(frames, width, height, 0)
      : UPNG.encode(frames, width, height, 0, delays);
    return new Blob([arr], { type: 'image/png' });
  }

  /* ---------- ダウンロード ---------- */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function zipName(modeConf) {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDhhmm
    const base  = modeConf.label === '絵文字' ? 'emoji' : 'sticker';
    return `${base}_${stamp}.zip`;
  }

  /* ---------- 公開API ---------- */
  /** スロット1個を APNG として個別DL */
  async function exportOne(slotIndex) {
    const studio = window.EmojiStudio;
    const conf = getMode();
    const slot = studio.state.slots[slotIndex];
    if (!slot.image) throw new Error('画像が未設定です');
    const blob = await encodeSlot(slot, conf);
    const name = conf.fileNamePattern(slotIndex);
    downloadBlob(blob, name);
    return { name, size: blob.size };
  }

  /** 指定スロットを ZIP に固めて DL。indices は番号配列。 */
  async function exportZip(indices, label) {
    const studio = window.EmojiStudio;
    const conf = getMode();
    if (typeof JSZip === 'undefined') throw new Error('JSZip が読み込まれていません');
    if (!indices.length) throw new Error('対象スロットがありません');

    const zip = new JSZip();
    let oversize = 0;
    let total = 0;
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n];
      const slot = studio.state.slots[i];
      if (!slot.image) continue;
      studio.showToast(`${label || 'ZIP生成'} ${n + 1}/${indices.length}…`);
      const blob = await encodeSlot(slot, conf);
      const fname = conf.fileNamePattern(i);
      zip.file(fname, blob);
      total++;
      if (blob.size > conf.maxKB * 1024) oversize++;
    }
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'STORE', // PNGは既圧縮なので無圧縮で十分
    });
    downloadBlob(zipBlob, zipName(conf));

    let msg = `${total}枚をZIPで保存しました`;
    if (oversize > 0) msg += ` (${oversize}枚が容量超過: 上限${conf.maxKB}KB)`;
    studio.showToast(msg, oversize > 0 ? 'error' : '');
  }

  async function exportAllDone() {
    const studio = window.EmojiStudio;
    const indices = studio.state.slots
      .map((s, i) => (s.status === 'done' ? i : -1))
      .filter(i => i >= 0);
    if (!indices.length) {
      studio.showToast('確定済みスロットがありません', 'error');
      return;
    }
    await exportZip(indices, '一括ZIP');
  }

  async function exportSelected() {
    const studio = window.EmojiStudio;
    const indices = studio.state.slots
      .map((s, i) => (s.selected && s.status === 'done' ? i : -1))
      .filter(i => i >= 0);
    if (!indices.length) {
      studio.showToast('選択中の確定スロットがありません', 'error');
      return;
    }
    await exportZip(indices, '選択ZIP');
  }

  window.EmojiStudioExporter = {
    exportOne,
    exportSelected,
    exportAllDone,
    encodeSlot,
    renderFrames,
  };
})();
