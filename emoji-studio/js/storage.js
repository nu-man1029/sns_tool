/* ============================================================
 * EMOJI STUDIO - Phase 5: サーバー保存 / 中断再開
 *  - URLパラメータ ?p=ID で復元
 *  - 30秒インターバルの自動保存（dirty時のみ送信）
 *  - 手動「今すぐ保存」「URLコピー」
 *  - ページ離脱時に sendBeacon で確実保存
 * ============================================================ */

(function () {
  const URL_PARAM = 'p';
  const AUTOSAVE_MS = 30000;
  const ENDPOINT = 'api/project.php';

  let projectId = null;
  let dirty = false;
  let saving = false;
  let intervalId = null;
  let booted = false; // 初期化中はマークしない

  /* ---------- URL ---------- */
  function getUrlId() {
    const u = new URL(location.href);
    return u.searchParams.get(URL_PARAM);
  }
  function setUrlId(id) {
    const u = new URL(location.href);
    u.searchParams.set(URL_PARAM, id);
    history.replaceState(null, '', u.toString());
    updateProjectIdUI();
  }
  function shareUrl() {
    if (!projectId) return null;
    const u = new URL(location.href);
    u.searchParams.set(URL_PARAM, projectId);
    return u.toString();
  }

  /* ---------- API ---------- */
  async function apiNew() {
    const r = await fetch(`${ENDPOINT}?action=new`, { method: 'POST' });
    if (!r.ok) throw new Error(`new failed: HTTP ${r.status}`);
    const j = await r.json();
    return j.id;
  }
  async function apiLoad(id) {
    const r = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`);
    if (r.status === 404) throw new Error('not_found');
    if (!r.ok) throw new Error(`load failed: HTTP ${r.status}`);
    return await r.json();
  }
  async function apiSave(id, payload) {
    const r = await fetch(`${ENDPOINT}?id=${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`save failed: HTTP ${r.status} ${t}`);
    }
    return await r.json();
  }

  /* ---------- 状態 -> 保存ペイロード ---------- */
  function snapshot() {
    const studio = window.EmojiStudio;
    return {
      mode: studio.state.mode,
      slots: studio.state.slots.map(s => ({
        index: s.index,
        status: s.status,
        image: s.image,
        fileName: s.fileName,
        animation: s.animation,
        // selected はクライアント状態なので保存しない
      })),
    };
  }

  function applySnapshot(data) {
    const studio = window.EmojiStudio;
    if (!data) return;
    if (data.mode && studio.MODE_CONFIG[data.mode]) {
      studio.state.mode = data.mode;
      const conf = studio.MODE_CONFIG[data.mode];
      const badge = document.getElementById('mode-badge');
      if (badge) badge.textContent = `${conf.label} ${conf.width}×${conf.height}`;
      const modal = document.getElementById('mode-modal');
      if (modal) modal.classList.add('hidden');
    }
    if (Array.isArray(data.slots)) {
      data.slots.forEach((s, i) => {
        if (i < 0 || i >= studio.state.slots.length) return;
        const target = studio.state.slots[i];
        target.status    = s.status   ?? 'empty';
        target.image     = s.image    ?? null;
        target.fileName  = s.fileName ?? null;
        target.animation = s.animation ?? null;
        target.selected  = false;
      });
    }
    studio.renderGrid();
  }

  /* ---------- 保存処理 ---------- */
  async function saveNow() {
    if (saving) return;
    if (!booted) return;
    saving = true;
    setStatus('保存中…');
    try {
      if (!projectId) projectId = await apiNew();
      const payload = snapshot();
      const r = await apiSave(projectId, payload);
      dirty = false;
      setUrlId(projectId);
      const t = new Date(r.savedAt * 1000);
      setStatus(`保存済み ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`);
      return r;
    } catch (err) {
      console.error('[storage] save failed', err);
      setStatus('保存失敗', true);
      const studio = window.EmojiStudio;
      if (studio) studio.showToast(`保存失敗: ${err.message || err}`, 'error');
    } finally {
      saving = false;
    }
  }

  function markDirty() {
    if (!booted) return;
    dirty = true;
    setStatus('未保存…');
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function setStatus(text, isError = false) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', isError);
  }

  function updateProjectIdUI() {
    const el = document.getElementById('project-id');
    if (!el) return;
    if (projectId) {
      el.textContent = `ID: ${projectId}`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  /* ---------- 自動保存 ---------- */
  function startAutoSave() {
    if (intervalId) return;
    intervalId = setInterval(() => {
      if (dirty && !saving) saveNow();
    }, AUTOSAVE_MS);
  }

  /* ---------- 離脱時保存 ---------- */
  function attachUnloadHandler() {
    window.addEventListener('beforeunload', () => {
      if (!dirty || saving || !projectId) return;
      try {
        const blob = new Blob(
          [JSON.stringify(snapshot())],
          { type: 'application/json' }
        );
        // sendBeacon は PUT を直接サポートしない環境もあるため POST で送る
        navigator.sendBeacon(`${ENDPOINT}?id=${encodeURIComponent(projectId)}`, blob);
      } catch (_) { /* noop */ }
    });
  }

  /* ---------- ヘッダーUI ---------- */
  function bindHeaderControls() {
    const saveBtn = document.getElementById('btn-save-now');
    const shareBtn = document.getElementById('btn-share');
    if (saveBtn) saveBtn.addEventListener('click', () => saveNow());
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      // 未保存ならまず作成・保存
      if (!projectId) {
        await saveNow();
        if (!projectId) return;
      }
      const url = shareUrl();
      try {
        await navigator.clipboard.writeText(url);
        window.EmojiStudio.showToast('共有URLをコピーしました');
      } catch (_) {
        prompt('共有URL:', url);
      }
    });
  }

  /* ---------- 初期化 ---------- */
  async function init() {
    bindHeaderControls();

    const idFromUrl = getUrlId();
    if (idFromUrl) {
      setStatus('読み込み中…');
      try {
        const j = await apiLoad(idFromUrl);
        projectId = idFromUrl;
        applySnapshot(j.data);
        const savedAt = j.savedAt ? new Date(j.savedAt * 1000) : new Date();
        setStatus(`保存済み ${pad(savedAt.getHours())}:${pad(savedAt.getMinutes())}:${pad(savedAt.getSeconds())}`);
        const studio = window.EmojiStudio;
        if (studio) studio.showToast(`プロジェクト ${idFromUrl} を復元`);
        updateProjectIdUI();
      } catch (err) {
        console.error('[storage] load failed', err);
        if (err.message === 'not_found') {
          setStatus('プロジェクトが見つかりません', true);
          window.EmojiStudio.showToast(`プロジェクト ${idFromUrl} は見つかりませんでした`, 'error');
        } else {
          setStatus('読込失敗', true);
        }
      }
    } else {
      setStatus('— 未保存 —');
    }

    booted = true;
    startAutoSave();
    attachUnloadHandler();
  }

  // app.js より後にロードされる前提だが、DOMContentLoaded を待つ
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.EmojiStudioStorage = {
    saveNow,
    markDirty,
    getProjectId: () => projectId,
    shareUrl,
  };
})();
