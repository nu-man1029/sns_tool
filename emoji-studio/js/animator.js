/* ============================================================
 * EMOJI STUDIO - Phase 2: Canvasアニメーション編集モーダル
 *  - プリセット定義 / Canvasプレビュー / 設定保存
 *  - 実APNG書き出しは Phase 3 以降で対応
 * ============================================================ */

(function () {
  /* ---------- アニメーションプリセット ----------
   * 各プリセットは (ctx, drawImage(t, k), t, k) を受け取り、
   * canvas の描画を行う関数。
   *   t : 0..1 の正規化時刻（ループ）
   *   k : 強度倍率（0.2～2.0 想定。slider 100% = 1.0）
   * drawImage(transformFn) は letterbox 描画ヘルパ。
   */
  const PRESETS = {
    none: {
      label: 'なし',
      render(ctx, draw) {
        draw();
      },
    },
    bounce: {
      label: 'バウンス',
      render(ctx, draw, t, k) {
        const amp = 18 * k;
        const dy = -Math.abs(Math.sin(t * Math.PI * 2)) * amp;
        draw({ dy });
      },
    },
    shake: {
      label: 'シェイク',
      render(ctx, draw, t, k) {
        const dx = Math.sin(t * Math.PI * 8) * 7 * k;
        const dy = Math.cos(t * Math.PI * 6) * 3 * k;
        draw({ dx, dy });
      },
    },
    pulse: {
      label: 'パルス',
      render(ctx, draw, t, k) {
        const s = 1 + Math.sin(t * Math.PI * 2) * 0.12 * k;
        draw({ scale: s });
      },
    },
    rotate: {
      label: '回転',
      render(ctx, draw, t, k) {
        draw({ rotate: t * Math.PI * 2 * k });
      },
    },
    fade: {
      label: 'フェード',
      render(ctx, draw, t, k) {
        const a = 0.3 + (1 - 0.3) * (0.5 + 0.5 * Math.cos(t * Math.PI * 2));
        const alpha = Math.max(0, Math.min(1, 1 - (1 - a) * k));
        draw({ alpha });
      },
    },
    'slide-x': {
      label: '横スライド',
      render(ctx, draw, t, k) {
        const dx = Math.sin(t * Math.PI * 2) * 28 * k;
        draw({ dx });
      },
    },
    zoom: {
      label: 'ズーム',
      render(ctx, draw, t, k) {
        const s = 1 + Math.sin(t * Math.PI * 2) * 0.3 * k;
        draw({ scale: Math.max(0.2, s) });
      },
    },
  };

  /* ---------- 編集モーダル制御 ---------- */
  const editor = {
    modalEl: null,
    canvas: null,
    ctx: null,
    image: null,           // HTMLImageElement
    slotIndex: null,       // 編集中スロットのインデックス
    rafId: null,
    startTime: 0,
    pausedAt: 0,           // 一時停止時の経過 ms
    playing: false,

    settings: {
      preset: 'none',
      durationMs: 800,
      intensity: 100,      // 20..200 (%)
      fps: 12,
    },

    open(slotIndex) {
      const studio = window.EmojiStudio;
      const slot = studio.state.slots[slotIndex];
      if (!slot || !slot.image) return;
      this.slotIndex = slotIndex;

      // モードからキャンバスサイズを設定
      const conf = studio.MODE_CONFIG[studio.state.mode];
      this.canvas.width = conf.width;
      this.canvas.height = conf.height;

      // ヘッダ更新
      document.getElementById('edit-slot-num').textContent =
        `スロット ${String(slotIndex + 1).padStart(2, '0')}`;
      document.getElementById('edit-mode-info').textContent =
        `${conf.label} ${conf.width}×${conf.height}`;

      // 既存の設定があれば復元、無ければ初期化
      if (slot.animation) {
        this.settings = Object.assign(
          { preset: 'none', durationMs: 800, intensity: 100, fps: 12 },
          slot.animation
        );
      } else {
        this.settings = { preset: 'none', durationMs: 800, intensity: 100, fps: 12 };
      }
      this.syncUIFromSettings();

      // 画像ロード
      this.image = new Image();
      this.image.onload = () => {
        this.modalEl.classList.remove('hidden');
        this.startPlay();
      };
      this.image.onerror = () => {
        studio.showToast('画像の読み込みに失敗しました', 'error');
      };
      this.image.src = slot.image;
    },

    close() {
      this.stopPlay();
      this.modalEl.classList.add('hidden');
      this.slotIndex = null;
      this.image = null;
    },

    save() {
      const studio = window.EmojiStudio;
      if (this.slotIndex == null) return;
      const slot = studio.state.slots[this.slotIndex];
      slot.animation = { ...this.settings };
      slot.status = 'done';
      studio.renderGrid();
      studio.showToast('アニメ設定を保存しました');
      this.close();
    },

    /* ---------- UI同期 ---------- */
    syncUIFromSettings() {
      // プリセットボタン
      document.querySelectorAll('#anim-presets .preset-btn').forEach(b => {
        b.classList.toggle('is-active', b.dataset.preset === this.settings.preset);
      });
      // スライダ
      document.getElementById('duration-slider').value = this.settings.durationMs;
      document.getElementById('intensity-slider').value = this.settings.intensity;
      document.getElementById('fps-slider').value = this.settings.fps;
      this.updateValueLabels();
    },

    updateValueLabels() {
      document.getElementById('duration-value').textContent =
        `${this.settings.durationMs} ms`;
      document.getElementById('intensity-value').textContent =
        `${this.settings.intensity} %`;
      document.getElementById('fps-value').textContent =
        `${this.settings.fps} fps`;
      const total = Math.max(1, Math.round((this.settings.durationMs / 1000) * this.settings.fps));
      document.getElementById('total-frames').textContent = total;
    },

    /* ---------- 再生制御 ---------- */
    startPlay() {
      this.stopPlay();
      this.startTime = performance.now() - this.pausedAt;
      this.playing = true;
      document.getElementById('btn-play').textContent = '❚❚ 一時停止';
      const loop = (now) => {
        if (!this.playing) return;
        const elapsed = now - this.startTime;
        this.drawFrame(elapsed);
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    },

    pausePlay() {
      if (!this.playing) return;
      this.pausedAt = performance.now() - this.startTime;
      this.playing = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      document.getElementById('btn-play').textContent = '▶ 再生';
    },

    stopPlay() {
      this.playing = false;
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
    },

    restart() {
      this.pausedAt = 0;
      this.startPlay();
    },

    /* ---------- フレーム描画 ---------- */
    drawFrame(elapsedMs) {
      const { ctx, canvas, image, settings } = this;
      if (!image) return;
      const dur = Math.max(50, settings.durationMs);
      const tRaw = (elapsedMs % dur) / dur;
      // FPSに沿って時間を量子化（プレビューでも実書出時の段階感を再現）
      const totalFrames = Math.max(1, Math.round((dur / 1000) * settings.fps));
      const frameIdx = Math.floor(tRaw * totalFrames);
      const t = frameIdx / totalFrames;
      const k = settings.intensity / 100;

      // クリア
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const preset = PRESETS[settings.preset] || PRESETS.none;
      preset.render(ctx, (opts) => this.drawTransformed(opts || {}), t, k);

      // フレーム情報
      const sec = (elapsedMs % dur) / 1000;
      document.getElementById('frame-info').textContent =
        `${frameIdx + 1}/${totalFrames}f  ${sec.toFixed(2)}s`;
    },

    /**
     * letterbox + transform で画像を描画。
     * opts: { dx, dy, scale, rotate, alpha }
     */
    drawTransformed(opts) {
      const { ctx, canvas, image } = this;
      const dx = opts.dx || 0;
      const dy = opts.dy || 0;
      const scale = opts.scale ?? 1;
      const rotate = opts.rotate || 0;
      const alpha = opts.alpha ?? 1;

      // contain サイズ計算
      const ratio = Math.min(canvas.width / image.width, canvas.height / image.height);
      const w = image.width * ratio * scale;
      const h = image.height * ratio * scale;
      const cx = canvas.width / 2 + dx;
      const cy = canvas.height / 2 + dy;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      if (rotate) ctx.rotate(rotate);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, -w / 2, -h / 2, w, h);
      ctx.restore();
    },

    /* ---------- 起動/イベント束 ---------- */
    init() {
      this.modalEl = document.getElementById('edit-modal');
      this.canvas = document.getElementById('edit-canvas');
      this.ctx = this.canvas.getContext('2d');

      // 閉じる
      document.getElementById('edit-close').addEventListener('click', () => this.close());
      document.getElementById('btn-edit-cancel').addEventListener('click', () => this.close());
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl) this.close();
      });
      document.addEventListener('keydown', (e) => {
        if (this.modalEl.classList.contains('hidden')) return;
        if (e.key === 'Escape') this.close();
      });

      // 確定
      document.getElementById('btn-edit-save').addEventListener('click', () => this.save());

      // プリセット
      document.querySelectorAll('#anim-presets .preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.settings.preset = btn.dataset.preset;
          this.syncUIFromSettings();
          this.restart();
        });
      });

      // スライダ
      document.getElementById('duration-slider').addEventListener('input', (e) => {
        this.settings.durationMs = parseInt(e.target.value, 10);
        this.updateValueLabels();
      });
      document.getElementById('intensity-slider').addEventListener('input', (e) => {
        this.settings.intensity = parseInt(e.target.value, 10);
        this.updateValueLabels();
      });
      document.getElementById('fps-slider').addEventListener('input', (e) => {
        this.settings.fps = parseInt(e.target.value, 10);
        this.updateValueLabels();
      });

      // 再生制御
      document.getElementById('btn-play').addEventListener('click', () => {
        if (this.playing) this.pausePlay();
        else this.startPlay();
      });
      document.getElementById('btn-restart').addEventListener('click', () => this.restart());

      // AI 提案
      document.getElementById('btn-ai-suggest').addEventListener('click', () => this.requestAISuggestions());

      // APNG書き出し (Phase 4)
      document.getElementById('btn-edit-export').addEventListener('click', () => this.exportThis());
    },

    /* ---------- Phase 4: 個別APNG書き出し ---------- */
    async exportThis() {
      const studio   = window.EmojiStudio;
      const exporter = window.EmojiStudioExporter;
      if (!exporter || this.slotIndex == null) return;
      const slot = studio.state.slots[this.slotIndex];
      if (!slot || !slot.image) return;

      // 編集中の最新設定を反映してから書き出す（未保存でも書き出せる）
      const tempAnim = slot.animation;
      slot.animation = { ...this.settings };

      const btn = document.getElementById('btn-edit-export');
      const sizeEl = document.getElementById('export-size');
      btn.disabled = true;
      btn.textContent = '生成中…';
      sizeEl.textContent = '';

      try {
        const r = await exporter.exportOne(this.slotIndex);
        const conf = studio.MODE_CONFIG[studio.state.mode];
        const sizeKB = (r.size / 1024).toFixed(1);
        const over = r.size > conf.maxKB * 1024;
        sizeEl.textContent = `${r.name} : ${sizeKB} KB${over ? ' ⚠上限超過' : ''}`;
        sizeEl.className = 'export-size' + (over ? ' is-over' : '');
        studio.showToast(`${r.name} を保存 (${sizeKB}KB)`, over ? 'error' : '');
      } catch (err) {
        studio.showToast(`書き出し失敗: ${err.message || err}`, 'error');
      } finally {
        slot.animation = tempAnim; // 確定前の状態に戻す
        btn.disabled = false;
        btn.textContent = 'APNG書き出し';
      }
    },

    /* ---------- Phase 3: AI 提案 ---------- */
    async requestAISuggestions() {
      const studio = window.EmojiStudio;
      if (this.slotIndex == null) return;
      const slot = studio.state.slots[this.slotIndex];
      if (!slot || !slot.image) return;

      const btn = document.getElementById('btn-ai-suggest');
      const body = document.getElementById('ai-suggest-body');
      const txt = btn.querySelector('.ai-btn-text');

      btn.disabled = true;
      btn.classList.add('is-loading');
      txt.textContent = '解析中…';
      body.hidden = false;
      body.innerHTML = '<div class="ai-loading">画像を解析しています…</div>';

      try {
        const res = await fetch('api/suggest.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: slot.image, mode: studio.state.mode }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !Array.isArray(data.suggestions)) {
          const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        this.renderSuggestions(data.suggestions);
      } catch (err) {
        body.innerHTML =
          `<div class="ai-error">提案に失敗しました: ${escapeHtml(err.message || String(err))}</div>`;
        studio.showToast('AI提案に失敗しました', 'error');
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        txt.textContent = '3案を再提案';
      }
    },

    renderSuggestions(list) {
      const presetLabel = (p) => (PRESETS[p] && PRESETS[p].label) || p;
      const html = list.map((s, i) => `
        <div class="ai-card" data-idx="${i}">
          <div class="ai-card-head">
            <span class="ai-card-num">#${i + 1}</span>
            <span class="ai-card-preset">${escapeHtml(presetLabel(s.preset))}</span>
          </div>
          <div class="ai-card-meta">
            ${s.durationMs}ms / ${s.intensity}% / ${s.fps}fps
          </div>
          <p class="ai-card-reason">${escapeHtml(s.reason || '')}</p>
          <button type="button" class="ai-card-apply" data-idx="${i}">この設定を適用</button>
        </div>
      `).join('');
      const body = document.getElementById('ai-suggest-body');
      body.innerHTML = html;
      body.querySelectorAll('.ai-card-apply').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const s = list[idx];
          this.settings = {
            preset: s.preset,
            durationMs: s.durationMs,
            intensity: s.intensity,
            fps: s.fps,
          };
          this.syncUIFromSettings();
          this.restart();
          // 選択中マーク
          body.querySelectorAll('.ai-card').forEach(c => c.classList.remove('is-applied'));
          body.querySelector(`.ai-card[data-idx="${idx}"]`)?.classList.add('is-applied');
        });
      });
    },
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  document.addEventListener('DOMContentLoaded', () => editor.init());

  // 公開 API
  window.EmojiStudioAnimator = {
    open: (i) => editor.open(i),
    PRESETS,
  };
})();
