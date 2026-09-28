/* Manual Studio — 動画から操作マニュアルを作る管理画面（デモ）
   データは IndexedDB（このブラウザ内）にのみ保存する。 */
'use strict';

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`; };
const fmtS = t => { t = Math.round(t || 0); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const today = () => new Date().toISOString().slice(0, 10);
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
const VW = 1000;
const COLORS = ['#2463b5', '#d6341f', '#e8740c', '#f2c200', '#1f9a52', '#ffffff', '#1a1a1a'];
const STATUS = { draft: '下書き', review: 'レビュー中', approved: '承認済み', published: '公開中', processing: '解析中' };
const FLOW = ['draft', 'review', 'approved', 'published'];
const LV = { none: 'なし', caution: '注意', warning: '警告', danger: '危険' };
const TYPE_LABEL = { rect: '四角', ellipse: '円', arrow: '矢印', text: 'ラベル', number: '番号', callout: '吹き出し', blur: 'ぼかし', image: '画像' };

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('manual-studio', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('projects', { keyPath: 'id' }); d.createObjectStore('blobs'); d.createObjectStore('kv'); };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); });
  },
  all: () => DB.tx('projects', 'readonly', s => s.getAll()),
  get: id => DB.tx('projects', 'readonly', s => s.get(id)),
  put: p => DB.tx('projects', 'readwrite', s => s.put(p)),
  del: id => DB.tx('projects', 'readwrite', s => s.delete(id)),
  putBlob: (k, b) => DB.tx('blobs', 'readwrite', s => s.put(b, k)),
  getBlob: k => DB.tx('blobs', 'readonly', s => s.get(k)),
  kvGet: k => DB.tx('kv', 'readonly', s => s.get(k)),
  kvPut: (k, v) => DB.tx('kv', 'readwrite', s => s.put(v, k)),
};

/* ---------- 設定 ---------- */
const DEFAULT_SETTINGS = {
  lang: 'ja', style: 'desu', sensitivity: 'mid', minGap: 1.5,
  keywords: { danger: '回転部,挟まれ,巻き込まれ,扉が開いた,高電圧', warning: '非常停止,起動,高温,重量物', caution: '保護具,保護メガネ,確認' },
  ppe: '保護メガネ,安全靴,作業手袋',
  template: 'std',
};
let SETTINGS = structuredClone(DEFAULT_SETTINGS);

/* ---------- サンプルデータ ---------- */
const PPE_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 118"><rect width="210" height="118" rx="12" fill="#fff" stroke="#1f5fae" stroke-width="4"/><circle cx="55" cy="48" r="32" fill="#1f5fae"/><path d="M28 45h54" stroke="#fff" stroke-width="5"/><circle cx="42" cy="50" r="10" fill="none" stroke="#fff" stroke-width="5"/><circle cx="68" cy="50" r="10" fill="none" stroke="#fff" stroke-width="5"/><circle cx="155" cy="48" r="32" fill="#1f5fae"/><path d="M132 60h46v-8l-16-6-4-14h-14v28z" fill="#fff"/><text x="55" y="104" font-size="15" font-weight="700" text-anchor="middle" fill="#1f5fae" font-family="sans-serif">保護メガネ</text><text x="155" y="104" font-size="15" font-weight="700" text-anchor="middle" fill="#1f5fae" font-family="sans-serif">安全靴</text></svg>`);

const SAMPLE_STEPS = [
  { t: 0, ft: 2.0, title: '作業前の確認', desc: '設備全体を目視し、加工室内や周辺に工具・異物が残っていないことを確認します。', lv: 'caution', ct: '保護メガネ・安全靴を着用してから作業を始めます。' },
  { t: 4, ft: 7.6, title: '主電源を入れる', desc: '操作盤左上の主電源スイッチを右（ON）へ90°回します。\n電源ランプ（黄）が点灯したことを確認します。', lv: 'none', ct: '' },
  { t: 9, ft: 12.2, title: '非常停止を解除する', desc: '非常停止ボタンを右に回して解除します。\n画面の E-STOP 表示が「OK」になったことを確認します。', lv: 'warning', ct: '解除する前に、設備の周囲に人がいないことを確認します。' },
  { t: 13, ft: 16.0, title: '運転モードを AUTO に切り替える', desc: 'モード切替ダイヤルを MAN から AUTO へ回します。\n画面に「MODE : AUTO」と表示されたことを確認します。', lv: 'none', ct: '' },
  { t: 17, ft: 20.2, title: '加工室の扉を閉める', desc: '加工室の扉を右へスライドさせ、完全に閉めます。\n画面の DOOR 表示が「CLOSE」になったことを確認します。', lv: 'danger', ct: '扉が開いた状態で運転しません。回転部に手を入れません。' },
  { t: 21, ft: 23.8, title: '起動ボタンを押す', desc: '起動ボタン（緑）を押します。\n起動ランプの点灯と、主軸の回転（S=1200）を確認します。', lv: 'warning', ct: '異音・振動などの異常があれば、直ちに非常停止ボタンを押します。' },
];
function sampleOverlays() {
  const O = (type, s, e, o) => ({ id: uid(), type, start: s, end: e, color: '#2463b5', sw: 5, fs: 26, ...o });
  return [
    O('blur', 0, 26, { x: 0, y: 0, w: 330, h: 36, label: 'カメラ情報をマスク' }),
    O('image', 0.3, 3.9, { x: 40, y: 405, w: 210, h: 118, img: 'ppe' }),
    O('rect', 0.3, 3.9, { x: 650, y: 72, w: 300, h: 400 }),
    O('callout', 0.3, 3.9, { x: 300, y: 455, w: 300, h: 58, text: 'この操作盤で操作します', tx: 650, ty: 390 }),
    O('number', 4.3, 8.9, { x: 150, y: 150, w: 56, h: 56, text: '1', fs: 30 }),
    O('arrow', 4.3, 8.9, { x1: 70, y1: 480, x2: 205, y2: 335, color: '#d6341f', sw: 8 }),
    O('callout', 4.3, 6.5, { x: 560, y: 330, w: 300, h: 62, text: '右へ90°回して ON', tx: 335, ty: 290 }),
    O('ellipse', 6.6, 8.9, { x: 399, y: 196, w: 120, h: 120, color: '#1f9a52', sw: 6 }),
    O('callout', 6.6, 8.9, { x: 560, y: 110, w: 330, h: 58, text: '電源ランプの点灯を確認', tx: 512, ty: 225, color: '#1f9a52' }),
    O('number', 9.3, 12.9, { x: 250, y: 230, w: 56, h: 56, text: '2', fs: 30 }),
    O('ellipse', 9.3, 12.9, { x: 318, y: 236, w: 290, h: 290, color: '#d6341f', sw: 7 }),
    O('callout', 9.3, 12.9, { x: 640, y: 250, w: 290, h: 62, text: '右に回して解除', tx: 600, ty: 360, color: '#d6341f' }),
    O('text', 11.3, 12.9, { x: 560, y: 60, w: 400, h: 52, text: '画面で E-STOP: OK を確認', color: '#2463b5' }),
    O('number', 13.3, 16.9, { x: 90, y: 250, w: 56, h: 56, text: '3', fs: 30 }),
    O('arrow', 13.3, 16.9, { x1: 190, y1: 222, x2: 400, y2: 222, sw: 8 }),
    O('callout', 13.3, 16.9, { x: 560, y: 290, w: 320, h: 62, text: 'MAN → AUTO へ回す', tx: 390, ty: 300 }),
    O('arrow', 17.3, 19.4, { x1: 300, y1: 300, x2: 600, y2: 300, color: '#2463b5', sw: 9 }),
    O('callout', 17.3, 19.4, { x: 180, y: 150, w: 280, h: 58, text: '扉を右へスライド', tx: 360, ty: 290, color: '#2463b5' }),
    O('text', 17.3, 20.9, { x: 240, y: 470, w: 520, h: 56, text: '⚠ 扉が開いた状態で運転しない', color: '#d6341f' }),
    O('number', 21.3, 25.9, { x: 300, y: 250, w: 56, h: 56, text: '4', fs: 30 }),
    O('ellipse', 21.3, 25.9, { x: 363, y: 262, w: 200, h: 200, color: '#1f9a52', sw: 7 }),
    O('callout', 21.3, 23.0, { x: 620, y: 180, w: 320, h: 62, text: '起動ボタン（緑）を押す', tx: 540, ty: 300, color: '#1f9a52' }),
    O('text', 23.0, 25.9, { x: 560, y: 46, w: 400, h: 52, text: '異常時は直ちに非常停止', color: '#d6341f' }),
  ];
}
function mkSteps(list) { return list.map(s => ({ id: uid(), t: s.t, ft: s.ft ?? s.t, title: s.title, desc: s.desc, lv: s.lv || 'none', ct: s.ct || '', ai: true })); }
function baseProject(o) {
  return {
    id: uid(), title: '', equipment: '', process: '', line: '', target: '新任オペレーター', author: '製造技術課', docNo: '', version: '1.0',
    status: 'draft', createdAt: today(), updatedAt: Date.now(), videoKey: null, videoName: '', duration: 0, width: 960, height: 540, vh: 562.5,
    ppe: SETTINGS.ppe, steps: [], overlays: [], images: {}, history: [], ...o,
  };
}
function seedProjects() {
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const sample = baseProject({
    title: 'MC-200 横形加工機 起動手順', equipment: 'MC-200 横形加工機', process: '機械加工', line: '第2工場 ライン3', docNo: 'OP-M-0142', version: '1.2',
    status: 'review', createdAt: d(2), videoKey: 'sample', videoName: 'mc200_startup.mp4', duration: 26, steps: mkSteps(SAMPLE_STEPS), overlays: sampleOverlays(), images: { ppe: PPE_SVG }, ...sampleExtras(),
    history: [{ at: d(2), who: '製造技術課', what: '動画から自動生成（6手順）' }, { at: d(1), who: '製造技術課', what: '注釈23件を追加・レビュー依頼' }],
  });
  const dummy = (title, equipment, process, line, status, days, no, steps) => baseProject({ title, equipment, process, line, status, createdAt: d(days), docNo: no, videoName: '', duration: steps.length * 5, steps: mkSteps(steps.map((s, i) => ({ t: i * 5, ...s }))), history: [{ at: d(days), who: '製造技術課', what: '動画から自動生成' }] });
  return [
    sample,
    dummy('油圧プレス 金型交換手順', '200t 油圧プレス', 'プレス', '第1工場 ライン1', 'published', 12, 'OP-P-0087', [
      { title: 'スライドを下死点へ下げる', desc: '寸動モードでスライドを下死点まで下げます。', lv: 'warning', ct: '寸動中は両手操作ボタンから手を離しません。' },
      { title: '主電源を切り、施錠する', desc: '主電源を OFF にし、個人ロックを取り付けます。', lv: 'danger', ct: 'ロックアウト・タグアウトを必ず実施します。' },
      { title: 'クランプを緩める', desc: '上型・下型のクランプボルトを対角順に緩めます。', lv: 'none', ct: '' },
      { title: '金型を搬出する', desc: 'ボルスターのローラーを上げ、金型を台車へ引き出します。', lv: 'warning', ct: '重量物のため2名で作業します。' }]),
    dummy('フォークリフト 始業点検', 'カウンター式 2.5t', '構内物流', '倉庫棟', 'approved', 6, 'OP-L-0031', [
      { title: 'タイヤ・車体の外観確認', desc: 'タイヤの亀裂・空気圧、車体の損傷を目視で確認します。', lv: 'none', ct: '' },
      { title: 'フォーク・チェーンの確認', desc: 'フォークの曲がり、チェーンの張りと注油状態を確認します。', lv: 'caution', ct: 'フォークの下に足を入れません。' },
      { title: 'ブレーキ・ホーンの作動確認', desc: '低速で走行し、ブレーキとホーンが正常に作動するか確認します。', lv: 'none', ct: '' }]),
    dummy('トルクレンチ 日常校正確認', 'デジタルトルクレンチ', '組立', '第2工場 ライン5', 'draft', 1, 'OP-A-0210', [
      { title: 'テスターの電源を入れる', desc: 'トルクテスターの電源を入れ、ゼロ点を確認します。', lv: 'none', ct: '' },
      { title: '設定トルクで3回測定する', desc: '設定値でレンチを3回締め、表示値を記録します。', lv: 'none', ct: '' }]),
    dummy('溶接ロボット 始業前点検', 'アーク溶接ロボット', '溶接', '第1工場 ライン2', 'published', 20, 'OP-W-0055', [
      { title: 'ノズル・チップの清掃', desc: 'トーチのノズル内のスパッタを除去し、チップの摩耗を確認します。', lv: 'caution', ct: '高温部に触れないよう、冷却を確認してから作業します。' },
      { title: 'ワイヤ送給の確認', desc: 'インチング操作でワイヤが正常に送給されるか確認します。', lv: 'none', ct: '' },
      { title: '安全柵・インターロック確認', desc: '安全柵の扉を開け、ロボットが停止することを確認します。', lv: 'danger', ct: '柵内への立入りは停止を確認してから行います。' }]),
  ];
}

/* ---------- state ---------- */
let PROJECTS = [];
const videoURLCache = {};
async function videoURL(p) {
  if (!p.videoKey) return null;
  if (p.videoKey === 'sample') return 'assets/sample.mp4';
  if (videoURLCache[p.videoKey]) return videoURLCache[p.videoKey];
  const b = await DB.getBlob(p.videoKey);
  if (!b) return null;
  return (videoURLCache[p.videoKey] = URL.createObjectURL(b));
}
let saveTimer;
function touch(p, immediate) {
  p.updatedAt = Date.now();
  $('#saveState').textContent = '保存中…';
  clearTimeout(saveTimer);
  const run = () => DB.put(p).then(() => { $('#saveState').textContent = '保存済み ' + new Date().toLocaleTimeString('ja-JP'); });
  if (immediate) return run();
  saveTimer = setTimeout(run, 400);
}

/* ---------- router ---------- */
let cleanup = null;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [, view = 'dashboard', id, tab] = location.hash.split('/');
  $$('.side nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (view === 'edit' ? 'manuals' : view)));
  $('#side').classList.remove('open');
  window.scrollTo(0, 0);
  if (view === 'edit') return viewEditor(id, tab || 'annot');
  if (view === 'templates') return viewTemplates(id);
  ({ dashboard: viewDashboard, upload: viewUpload, manuals: viewManuals, settings: viewSettings }[view] || viewDashboard)();
}
function crumbs(html) { $('#crumbs').innerHTML = html; }

/* ---------- サムネイル ---------- */
const thumbCache = {};
function placeholderThumb(p, i = 0) {
  const hue = [214, 205, 222, 198, 230][(p.title.length + i) % 5];
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 80% 96%)"/><stop offset="1" stop-color="hsl(${hue} 70% 88%)"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><rect x="20" y="22" width="70" height="48" rx="4" fill="#fff" stroke="hsl(${hue} 60% 70%)" stroke-width="2.5"/><rect x="100" y="22" width="40" height="48" rx="4" fill="hsl(${hue} 60% 78%)"/><circle cx="112" cy="36" r="5" fill="#fff"/><circle cx="128" cy="36" r="5" fill="rgba(255,255,255,.6)"/>${i ? `<text x="150" y="82" font-size="14" fill="hsl(${hue} 50% 45%)" text-anchor="end" font-family="monospace">${i}</text>` : ''}</svg>`);
}
async function projectThumb(p) {
  if (!p.videoKey) return placeholderThumb(p);
  const k = p.id + '|cover|' + p.updatedAt;
  if (thumbCache[k]) return thumbCache[k];
  const st = p.steps[1] || p.steps[0];
  try { return (thumbCache[k] = await renderFrame(p, st ? st.ft : 1, 320, false)); } catch { return placeholderThumb(p); }
}
function fillThumbs(root) {
  $$('[data-thumb]', root).forEach(async el => { const p = PROJECTS.find(x => x.id === el.dataset.thumb); if (p) el.style.backgroundImage = `url("${await projectThumb(p)}")`; });
}

/* ---------- ダッシュボード ---------- */
function statusBadge(s) { return `<span class="badge st-${s}">${STATUS[s] || s}</span>`; }
function totalDur(p) { return p.steps.length ? Math.max(p.duration, 0) : 0; }
function viewDashboard() {
  crumbs('<b>ダッシュボード</b>');
  const month = today().slice(0, 7);
  const n = PROJECTS.length, thisMonth = PROJECTS.filter(p => p.createdAt.startsWith(month)).length;
  const review = PROJECTS.filter(p => p.status === 'review').length;
  const pub = PROJECTS.filter(p => p.status === 'published').length;
  const steps = PROJECTS.reduce((a, p) => a + p.steps.length, 0);
  const anns = PROJECTS.reduce((a, p) => a + p.overlays.length, 0);
  const recent = [...PROJECTS].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const byProc = {}; PROJECTS.forEach(p => byProc[p.process || '未分類'] = (byProc[p.process || '未分類'] || 0) + 1);
  const max = Math.max(1, ...Object.values(byProc));
  $('#view').innerHTML = `
    <div class="row" style="margin-bottom:16px"><div class="grow"><h1>ダッシュボード</h1><p class="sub" style="margin:0">現場で撮影した操作動画から、手順書を自動で下書きします。</p></div>
      <a class="btn primary" href="#/upload">⤒ 動画をアップロード</a></div>
    <div class="kpis">
      <div class="card kpi"><small>マニュアル数</small><b>${n}</b><span>今月作成 ${thisMonth} 件</span></div>
      <div class="card kpi"><small>レビュー待ち</small><b>${review}</b><span>承認が必要な手順書</span></div>
      <div class="card kpi"><small>公開中</small><b>${pub}</b><span>現場で閲覧可能</span></div>
      <div class="card kpi"><small>手順 / 注釈</small><b>${steps}<span style="font-size:16px"> / ${anns}</span></b><span>全マニュアル合計</span></div>
    </div>
    <div class="grid2">
      <div class="card"><div class="pad" style="padding-bottom:4px"><h2>最近更新したマニュアル</h2></div>
        <div class="tscroll"><table class="t"><thead><tr><th></th><th>タイトル</th><th class="hide-sm">設備 / ライン</th><th>手順</th><th>ステータス</th></tr></thead><tbody>
        ${recent.map(p => `<tr class="click" data-open="${p.id}"><td style="width:84px"><span class="thumb" data-thumb="${p.id}"></span></td><td><b>${esc(p.title)}</b><div class="muted mono" style="font-size:11px">${esc(p.docNo)} ・ v${esc(p.version)}</div></td><td class="hide-sm">${esc(p.equipment)}<div class="muted" style="font-size:12px">${esc(p.line)}</div></td><td class="mono">${p.steps.length}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}
        </tbody></table></div></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card pad"><h2>工程別のマニュアル数</h2>
          ${Object.entries(byProc).map(([k, v]) => `<div style="display:grid;grid-template-columns:78px 1fr 24px;gap:8px;align-items:center;font-size:12px;margin:6px 0"><span>${esc(k)}</span><div class="bar" style="margin:0;height:10px"><i style="width:${v / max * 100}%"></i></div><span class="mono">${v}</span></div>`).join('')}
        </div>
        <div class="card pad"><h2>作成の流れ</h2>
          <ol class="hint" style="margin:0;padding-left:18px">
            <li><b>動画アップロード</b> … スマホで撮った作業動画をそのまま投入</li>
            <li><b>自動解析</b> … 画面の切り替わりから手順を分割し、代表フレームを抽出</li>
            <li><b>注釈編集</b> … 矢印・番号・吹き出し・画像・ぼかしを動画に重ねる</li>
            <li><b>手順編集 → 承認 → 公開</b> … 手順書と注釈入り動画を出力</li>
          </ol></div>
      </div>
    </div>`;
  $$('[data-open]').forEach(tr => tr.onclick = () => location.hash = `#/edit/${tr.dataset.open}/annot`);
  fillThumbs($('#view'));
}

/* ---------- 一覧 ---------- */
let listFilter = 'all', listQ = '';
function viewManuals() {
  crumbs('<b>マニュアル一覧</b>');
  const draw = () => {
    const rows = PROJECTS.filter(p => (listFilter === 'all' || p.status === listFilter) && (!listQ || (p.title + p.equipment + p.line + p.docNo).includes(listQ))).sort((a, b) => b.updatedAt - a.updatedAt);
    $('#mlist').innerHTML = rows.length ? rows.map(p => `<tr class="click" data-open="${p.id}"><td style="width:84px"><span class="thumb" data-thumb="${p.id}"></span></td>
      <td><b>${esc(p.title)}</b><div class="muted mono" style="font-size:11px">${esc(p.docNo)} ・ v${esc(p.version)}</div></td>
      <td class="hide-sm">${esc(p.equipment)}<div class="muted" style="font-size:12px">${esc(p.process)} ／ ${esc(p.line)}</div></td>
      <td class="mono hide-sm">${p.videoKey ? fmtS(p.duration) : '—'}</td><td class="mono">${p.steps.length}</td><td class="mono hide-sm">${p.overlays.length}</td>
      <td>${statusBadge(p.status)}</td><td class="mono hide-sm muted" style="font-size:12px">${new Date(p.updatedAt).toLocaleDateString('ja-JP')}</td>
      <td style="width:40px"><button class="btn ghost sm" data-del="${p.id}" title="削除">✕</button></td></tr>`).join('') : `<tr><td colspan="9" class="empty">該当するマニュアルはありません</td></tr>`;
    $$('[data-open]').forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-del]')) location.hash = `#/edit/${tr.dataset.open}/annot`; });
    $$('[data-del]').forEach(b => b.onclick = async () => {
      const p = PROJECTS.find(x => x.id === b.dataset.del);
      if (!confirm(`「${p.title}」を削除します。よろしいですか？`)) return;
      await DB.del(p.id); PROJECTS = PROJECTS.filter(x => x !== p); draw(); toast('削除しました');
    });
    fillThumbs($('#mlist'));
  };
  const cnt = s => s === 'all' ? PROJECTS.length : PROJECTS.filter(p => p.status === s).length;
  $('#view').innerHTML = `
    <div class="row" style="margin-bottom:14px"><div class="grow"><h1>マニュアル一覧</h1></div><a class="btn primary" href="#/upload">⤒ 動画から新規作成</a></div>
    <div class="card"><div class="pad row" style="border-bottom:1px solid var(--line)">
      <div class="chips">${['all', ...FLOW].map(s => `<button class="chip ${listFilter === s ? 'on' : ''}" data-f="${s}">${s === 'all' ? 'すべて' : STATUS[s]} <span class="mono">${cnt(s)}</span></button>`).join('')}</div>
      <div class="grow"></div><input class="in" id="q" placeholder="タイトル・設備・文書番号で検索" style="max-width:280px" value="${esc(listQ)}"></div>
      <div style="overflow-x:auto"><table class="t"><thead><tr><th></th><th>タイトル</th><th class="hide-sm">設備 / 工程</th><th class="hide-sm">動画</th><th>手順</th><th class="hide-sm">注釈</th><th>ステータス</th><th class="hide-sm">更新日</th><th></th></tr></thead><tbody id="mlist"></tbody></table></div></div>`;
  $$('[data-f]').forEach(b => b.onclick = () => { listFilter = b.dataset.f; viewManuals(); });
  $('#q').oninput = e => { listQ = e.target.value.trim(); draw(); };
  draw();
}

/* ---------- 設定 ---------- */
function viewSettings() {
  crumbs('<b>生成設定</b>');
  const s = SETTINGS;
  $('#view').innerHTML = `<h1>生成設定</h1><p class="sub">動画解析と手順書の下書きに使うルールです。全マニュアル共通で適用されます。</p>
  <div class="grid2"><div class="card pad">
    <h2>シーン分割</h2>
    <div class="fgrid">
      <label class="f"><span>検出感度</span><select class="in" id="s-sens"><option value="low">低（大きな切り替えのみ）</option><option value="mid">標準</option><option value="high">高（細かく分割）</option></select></label>
      <label class="f"><span>手順の最小間隔（秒）</span><input class="in" id="s-gap" type="number" min="0.5" step="0.5" value="${s.minGap}"></label>
    </div>
    <h2 style="margin-top:8px">文章</h2>
    <div class="fgrid">
      <label class="f"><span>出力言語</span><select class="in" id="s-lang"><option value="ja">日本語</option><option value="ja-en">日本語＋英語併記</option><option value="ja-vi">日本語＋ベトナム語併記</option></select></label>
      <label class="f"><span>文体</span><select class="in" id="s-style"><option value="desu">です・ます調</option><option value="dearu">である調（〜する）</option></select></label>
    </div>
    <label class="f"><span>保護具（手順書の冒頭に表示する既定値）</span><input class="in" id="s-ppe" value="${esc(s.ppe)}"></label>
    <h2 style="margin-top:8px">注意事項の自動付与キーワード</h2>
    <p class="hint" style="margin-top:-6px">手順の本文にこの語が含まれ、注意レベルが「なし」のとき、表記チェックで指摘します（カンマ区切り）。</p>
    <label class="f"><span>危険</span><input class="in" id="s-kd" value="${esc(s.keywords.danger)}"></label>
    <label class="f"><span>警告</span><input class="in" id="s-kw" value="${esc(s.keywords.warning)}"></label>
    <label class="f"><span>注意</span><input class="in" id="s-kc" value="${esc(s.keywords.caution)}"></label>
    <div class="row"><button class="btn primary" id="s-save">保存</button><button class="btn" id="s-reset">既定に戻す</button><button class="btn ghost" id="s-wipe" style="margin-left:auto">デモデータを初期化</button></div>
  </div>
  <div class="card pad"><h2>このデモで実際に動いている処理</h2>
    <ul class="hint" style="padding-left:18px;margin:0">
      <li>動画の読み込み・保存（ブラウザ内 IndexedDB）</li>
      <li>フレーム差分によるシーン分割と代表フレーム抽出（ブラウザ内で計算）</li>
      <li>注釈（矢印・四角・円・ラベル・番号・吹き出し・ぼかし・画像）の編集と表示時間の設定</li>
      <li>注釈を焼き込んだ手順画像の生成、手順書のHTML保存・印刷</li>
      <li>注釈入り動画の書き出し（ブラウザの録画機能を使用）</li>
    </ul>
    <h2 style="margin-top:16px">本番で API に置き換える処理</h2>
    <ul class="hint" style="padding-left:18px;margin:0">
      <li>音声の文字起こし</li>
      <li>手順タイトル・本文・注意事項の文章生成</li>
      <li>多言語への翻訳</li>
    </ul>
    <p class="hint">このデモではサンプル動画に限り、あらかじめ用意した文章を当てはめます。それ以外の動画は、手順の枠と代表フレームだけを作ります。</p>
  </div></div>`;
  $('#s-sens').value = s.sensitivity; $('#s-lang').value = s.lang; $('#s-style').value = s.style;
  $('#s-save').onclick = async () => {
    Object.assign(SETTINGS, { sensitivity: $('#s-sens').value, minGap: +$('#s-gap').value || 1.5, lang: $('#s-lang').value, style: $('#s-style').value, ppe: $('#s-ppe').value, keywords: { danger: $('#s-kd').value, warning: $('#s-kw').value, caution: $('#s-kc').value } });
    await DB.kvPut('settings', SETTINGS); toast('設定を保存しました');
  };
  $('#s-reset').onclick = async () => { SETTINGS = structuredClone(DEFAULT_SETTINGS); await DB.kvPut('settings', SETTINGS); viewSettings(); toast('既定に戻しました'); };
  $('#s-wipe').onclick = async () => {
    if (!confirm('このブラウザに保存したマニュアルと動画をすべて消して、初期状態に戻します。よろしいですか？')) return;
    DB.db?.close(); DB.db = null;
    await new Promise(r => { const q = indexedDB.deleteDatabase('manual-studio'); q.onsuccess = q.onerror = q.onblocked = r; });
    location.hash = '#/dashboard'; location.reload();
  };
}

/* ---------- アップロード & 解析 ---------- */
function viewUpload() {
  crumbs('<b>動画アップロード</b>');
  $('#view').innerHTML = `<h1>動画アップロード</h1><p class="sub">作業の様子を撮影した動画を入れると、画面の切り替わりで手順を分けて下書きを作ります。</p>
  <div class="grid2">
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card pad">
        <div class="drop" id="drop"><div style="font-size:30px">⤒</div><b>動画ファイルをドロップ</b><span class="muted">または クリックして選択（mp4 / mov / webm）</span></div>
        <input type="file" id="vf" accept="video/*" hidden>
        <div class="row" style="margin-top:12px;justify-content:center"><span class="muted" style="font-size:12px">手元に動画がない場合は</span><button class="btn sm" id="useSample">サンプル動画（加工機の起動操作・26秒）で試す</button></div>
      </div>
      <div class="card pad"><h2>マニュアル情報</h2>
        <label class="f"><span>タイトル</span><input class="in" id="u-title" placeholder="例）MC-200 横形加工機 起動手順"></label>
        <div class="fgrid">
          <label class="f"><span>設備名</span><input class="in" id="u-eq" placeholder="例）MC-200 横形加工機"></label>
          <label class="f"><span>工程</span><input class="in" id="u-proc" placeholder="例）機械加工"></label>
          <label class="f"><span>ライン / 場所</span><input class="in" id="u-line" placeholder="例）第2工場 ライン3"></label>
          <label class="f"><span>文書番号</span><input class="in" id="u-no" placeholder="例）OP-M-0143"></label>
          <label class="f"><span>対象者</span><select class="in" id="u-target"><option>新任オペレーター</option><option>全作業者</option><option>保全担当</option><option>外国人技能実習生</option></select></label>
          <label class="f"><span>シーン検出感度</span><select class="in" id="u-sens"><option value="low">低</option><option value="mid">標準</option><option value="high">高</option></select></label>
        </div>
      </div>
    </div>
    <div class="card pad" id="pipeCard"><h2>解析の進み具合</h2>
      <div id="vinfo" class="hint">動画を選ぶと解析を始めます。</div>
      <ul class="pipe" id="pipe"></ul>
      <canvas class="diffgraph" id="dg" hidden></canvas>
      <div class="scenes" id="scenes"></div>
      <div id="pipeDone" style="margin-top:14px"></div>
    </div>
  </div>`;
  $('#u-sens').value = SETTINGS.sensitivity;
  const drop = $('#drop'), vf = $('#vf');
  drop.onclick = () => vf.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) startPipeline(f); };
  vf.onchange = () => vf.files[0] && startPipeline(vf.files[0]);
  $('#useSample').onclick = async () => {
    $('#useSample').disabled = true;
    const b = await fetch('assets/sample.mp4').then(r => r.blob());
    const f = new File([b], 'mc200_startup.mp4', { type: 'video/mp4' });
    if (!$('#u-title').value) { $('#u-title').value = 'MC-200 横形加工機 起動手順（再作成）'; $('#u-eq').value = 'MC-200 横形加工機'; $('#u-proc').value = '機械加工'; $('#u-line').value = '第2工場 ライン3'; $('#u-no').value = 'OP-M-0143'; }
    startPipeline(f, true);
  };
  let aborted = false; cleanup = () => { aborted = true; };

  async function startPipeline(file, isSample = false) {
    if (!file.type.startsWith('video/')) { toast('動画ファイルを選んでください'); return; }
    drop.style.pointerEvents = 'none'; drop.style.opacity = .5; $('#useSample').disabled = true;
    const STEPS = [
      ['load', 'ファイル読み込み・保存', '動画をこのブラウザ内に保存'],
      ['meta', 'メタデータ取得', '長さ・解像度'],
      ['scan', 'フレーム解析', '一定間隔でフレームを取り出し、前後の差分を計算'],
      ['cut', 'シーン分割', '差分が大きい位置を手順の区切りにする'],
      ['frame', '代表フレーム抽出', '各手順の写真に使う1枚を選ぶ'],
      ['asr', '音声の文字起こし', '', 'API接続予定'],
      ['gen', '手順文・注意事項の下書き', '', 'API接続予定'],
    ];
    $('#pipe').innerHTML = STEPS.map(([k, t, d, tag]) => `<li data-k="${k}"><span class="dot"></span><div class="grow"><b>${t}</b>${tag ? `<span class="tag">${tag}</span>` : ''}<small>${d}</small></div></li>`).join('');
    const st = (k, s, note) => { const li = $(`#pipe [data-k="${k}"]`); if (!li) return; li.className = s; if (note != null) $('small', li).innerHTML = note; };
    const key = 'v_' + uid();
    st('load', 'run');
    await DB.putBlob(key, file);
    const url = URL.createObjectURL(file); videoURLCache[key] = url;
    st('load', 'done', `${esc(file.name)}（${(file.size / 1048576).toFixed(1)} MB）`);
    st('meta', 'run');
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    try { await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('decode')); setTimeout(() => rej(new Error('timeout')), 15000); }); }
    catch { st('meta', '', '<span style="color:var(--red)">このブラウザでは再生できない形式です（H.264 の mp4 をお試しください）</span>'); return; }
    const dur = v.duration, W = v.videoWidth, H = v.videoHeight;
    st('meta', 'done', `${fmtS(dur)}（${dur.toFixed(1)} 秒） ・ ${W}×${H}`);
    $('#vinfo').innerHTML = `<b>${esc(file.name)}</b> ・ ${fmtS(dur)} ・ ${W}×${H}`;
    // フレーム差分
    st('scan', 'run');
    const step = Math.max(0.25, dur / 400), sw = 96, sh = Math.round(96 * H / W) || 54;
    const c = document.createElement('canvas'); c.width = sw; c.height = sh; const cx = c.getContext('2d', { willReadFrequently: true });
    let prev = null; const diffs = [];
    $('#pipe [data-k="scan"] small').insertAdjacentHTML('afterend', '<div class="bar"><i id="scanbar"></i></div>');
    for (let t = 0; t < dur; t += step) {
      if (aborted) return;
      await seekTo(v, t); cx.drawImage(v, 0, 0, sw, sh);
      const px = cx.getImageData(0, 0, sw, sh).data; const g = new Float32Array(sw * sh);
      for (let i = 0; i < g.length; i++) g[i] = px[i * 4] * .3 + px[i * 4 + 1] * .59 + px[i * 4 + 2] * .11;
      let d = 0; if (prev) { for (let i = 0; i < g.length; i++) d += Math.abs(g[i] - prev[i]); d /= g.length; }
      diffs.push({ t, d }); prev = g;
      $('#scanbar').style.width = (t / dur * 100) + '%';
    }
    $('#scanbar').style.width = '100%';
    st('scan', 'done', `${diffs.length} フレームを解析（${step.toFixed(2)} 秒間隔）`);
    // シーン分割
    st('cut', 'run');
    const ds = diffs.slice(1).map(x => x.d); const mean = ds.reduce((a, b) => a + b, 0) / (ds.length || 1);
    const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / (ds.length || 1));
    const k = { low: 3.5, mid: 2.5, high: 1.6 }[$('#u-sens').value];
    const th = Math.max(mean + k * sd, 6);
    const cuts = [0];
    diffs.forEach(x => { if (x.d > th && x.t - cuts[cuts.length - 1] >= SETTINGS.minGap) cuts.push(+(x.t).toFixed(2)); });
    drawDiffGraph($('#dg'), diffs, th, dur);
    st('cut', 'done', `${cuts.length} 手順に分割（しきい値 ${th.toFixed(1)}）`);
    // 代表フレーム
    st('frame', 'run');
    const scenes = cuts.map((t, i) => { const e = cuts[i + 1] ?? dur; return { t, e, ft: +(t + Math.min((e - t) * 0.6, 3)).toFixed(2) }; });
    const sc = document.createElement('canvas'); sc.width = 320; sc.height = Math.round(320 * H / W);
    $('#scenes').innerHTML = '';
    for (const [i, s] of scenes.entries()) {
      if (aborted) return;
      await seekTo(v, s.ft); sc.getContext('2d').drawImage(v, 0, 0, sc.width, sc.height);
      $('#scenes').insertAdjacentHTML('beforeend', `<figure><img src="${sc.toDataURL('image/jpeg', .7)}" alt=""><figcaption class="mono">#${i + 1} ${fmt(s.t)}</figcaption></figure>`);
    }
    st('frame', 'done', `${scenes.length} 枚を抽出`);
    // 文字起こし・文章生成（デモ）
    const useScript = isSample;
    st('asr', 'run'); await sleep(500);
    st('asr', 'done', useScript ? 'サンプル動画のため、用意した台本を使用' : 'デモのため未実行（本番では音声からナレーションを文字起こし）');
    st('gen', 'run'); await sleep(600);
    st('gen', 'done', useScript ? '台本から手順タイトル・本文・注意事項を当てはめ' : 'デモのため未実行（手順の枠と代表フレームのみ作成）');
    // プロジェクト作成
    let steps;
    if (useScript) {
      steps = mkSteps(SAMPLE_STEPS.map((s, i) => ({ ...s, t: scenes.length === SAMPLE_STEPS.length ? scenes[i].t : s.t })));
    } else {
      steps = scenes.map((s, i) => ({ id: uid(), t: s.t, ft: s.ft, title: `手順 ${i + 1}`, desc: '', lv: 'none', ct: '', ai: false }));
    }
    const p = baseProject({
      title: $('#u-title').value.trim() || file.name.replace(/\.[^.]+$/, ''), equipment: $('#u-eq').value.trim(), process: $('#u-proc').value.trim(), line: $('#u-line').value.trim(),
      docNo: $('#u-no').value.trim(), target: $('#u-target').value, videoKey: key, videoName: file.name, duration: dur, width: W, height: H, vh: VW * H / W,
      steps, overlays: useScript ? sampleOverlays() : [], images: useScript ? { ppe: PPE_SVG } : {}, ...(useScript ? sampleExtras() : {}),
      history: [{ at: today(), who: '製造技術課', what: `動画から自動生成（${steps.length}手順）` }],
    });
    await DB.put(p); PROJECTS.push(p);
    $('#pipeDone').innerHTML = `<div class="row"><b class="grow">下書きができました（${steps.length} 手順${useScript ? ` ・ 注釈 ${p.overlays.length} 件` : ''}）</b><a class="btn primary" href="#/edit/${p.id}/annot">注釈を編集する →</a></div>`;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function seekTo(v, t) {
  return new Promise(res => {
    let done = false; const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin); setTimeout(fin, 2500);
    v.currentTime = Math.min(t, Math.max(0, (v.duration || t) - 0.04));
  });
}
function drawDiffGraph(cv, diffs, th, dur) {
  cv.hidden = false; const w = cv.clientWidth * devicePixelRatio, h = cv.clientHeight * devicePixelRatio; cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); const max = Math.max(th * 1.3, ...diffs.map(x => x.d));
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink-3'); g.lineWidth = devicePixelRatio;
  g.beginPath(); diffs.forEach((x, i) => { const px = x.t / dur * w, py = h - x.d / max * h; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke();
  g.strokeStyle = '#1f6feb'; g.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio]); g.beginPath(); g.moveTo(0, h - th / max * h); g.lineTo(w, h - th / max * h); g.stroke();
}

/* ---------- 注釈の描画（SVG / Canvas 共通の形状定義） ---------- */
function arrowGeom(o) {
  const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const hl = Math.min(L * .6, o.sw * 3.2 + 14), hw = o.sw * 2.2 + 8;
  const bx = o.x2 - ux * hl, by = o.y2 - uy * hl;
  return { bx, by, head: [[o.x2, o.y2], [bx - uy * hw / 2, by + ux * hw / 2], [bx + uy * hw / 2, by - ux * hw / 2]] };
}
function tailGeom(o) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, dx = o.tx - cx, dy = o.ty - cy, L = Math.hypot(dx, dy) || 1;
  const bw = Math.min(o.w, o.h) * .45; const px = -dy / L * bw / 2, py = dx / L * bw / 2;
  return [[cx + px, cy + py], [cx - px, cy - py], [o.tx, o.ty]];
}
const textInk = c => (c === '#ffffff' || c === '#f2c200') ? '#1a1a1a' : '#ffffff';
function svgText(o, x, y, w, h, fill) {
  const lines = String(o.text || '').split('\n'), lh = o.fs * 1.3, y0 = y + h / 2 - (lines.length - 1) * lh / 2;
  return `<text x="${x + w / 2}" font-size="${o.fs}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${fill}" style="font-family:'Noto Sans JP','Hiragino Sans',sans-serif">${lines.map((l, i) => `<tspan x="${x + w / 2}" y="${y0 + i * lh}">${esc(l)}</tspan>`).join('')}</text>`;
}
function ovSVG(o, images, editing) {
  const c = o.color, sw = o.sw;
  switch (o.type) {
    case 'rect': return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="6" fill="${c}" fill-opacity=".08" stroke="${c}" stroke-width="${sw}"/>`;
    case 'ellipse': return `<ellipse cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" rx="${o.w / 2}" ry="${o.h / 2}" fill="${c}" fill-opacity=".08" stroke="${c}" stroke-width="${sw}"/>`;
    case 'arrow': { const g = arrowGeom(o); return `<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="transparent" stroke-width="26"/><line x1="${o.x1}" y1="${o.y1}" x2="${g.bx}" y2="${g.by}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/><polygon points="${g.head.map(p => p.join(',')).join(' ')}" fill="${c}"/>`; }
    case 'text': return `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="6" fill="${c}"/>` + svgText(o, o.x, o.y, o.w, o.h, textInk(c));
    case 'number': return `<circle cx="${o.x + o.w / 2}" cy="${o.y + o.h / 2}" r="${Math.min(o.w, o.h) / 2}" fill="${c}" stroke="#fff" stroke-width="3"/>` + svgText(o, o.x, o.y, o.w, o.h, textInk(c));
    case 'callout': { const t = tailGeom(o); return `<polygon points="${t.map(p => p.join(',')).join(' ')}" fill="#fff" stroke="${c}" stroke-width="3" stroke-linejoin="round"/><rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="10" fill="#fff" stroke="${c}" stroke-width="3"/><rect x="${o.x}" y="${o.y}" width="8" height="${o.h}" rx="4" fill="${c}"/>` + svgText(o, o.x + 6, o.y, o.w - 6, o.h, '#1a1a1a'); }
    case 'blur': return editing ? `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="rgba(0,0,0,.001)" stroke="#9ab" stroke-width="1.5" stroke-dasharray="6 4"/>` : '';
    case 'image': return images[o.img] ? `<image href="${images[o.img]}" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="none"/>` : `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" fill="#555"/>`;
  }
  return '';
}
const imgEls = {};
function loadImg(src) {
  if (imgEls[src]) return imgEls[src];
  return (imgEls[src] = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function cvText(g, o, x, y, w, h, fill) {
  const lines = String(o.text || '').split('\n'), lh = o.fs * 1.3, y0 = y + h / 2 - (lines.length - 1) * lh / 2;
  g.fillStyle = fill; g.font = `700 ${o.fs}px "Noto Sans JP","Hiragino Sans",sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, x + w / 2, y0 + i * lh));
}
/* ctx は VW 単位に scale 済みであること */
async function drawOverlaysCanvas(g, p, t, srcCanvas, scale) {
  const list = p.overlays.filter(o => t >= o.start && t < o.end);
  for (const o of list) {
    const c = o.color; g.save(); g.lineWidth = o.sw; g.strokeStyle = c; g.fillStyle = c; g.lineJoin = 'round'; g.lineCap = 'round';
    if (o.type === 'rect') { rr(g, o.x, o.y, o.w, o.h, 6); g.globalAlpha = .08; g.fill(); g.globalAlpha = 1; g.stroke(); }
    else if (o.type === 'ellipse') { g.beginPath(); g.ellipse(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2); g.globalAlpha = .08; g.fill(); g.globalAlpha = 1; g.stroke(); }
    else if (o.type === 'arrow') { const a = arrowGeom(o); g.beginPath(); g.moveTo(o.x1, o.y1); g.lineTo(a.bx, a.by); g.stroke(); g.beginPath(); a.head.forEach((q, i) => i ? g.lineTo(...q) : g.moveTo(...q)); g.closePath(); g.fill(); }
    else if (o.type === 'text') { rr(g, o.x, o.y, o.w, o.h, 6); g.fill(); cvText(g, o, o.x, o.y, o.w, o.h, textInk(c)); }
    else if (o.type === 'number') { g.beginPath(); g.arc(o.x + o.w / 2, o.y + o.h / 2, Math.min(o.w, o.h) / 2, 0, Math.PI * 2); g.fill(); g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke(); cvText(g, o, o.x, o.y, o.w, o.h, textInk(c)); }
    else if (o.type === 'callout') {
      const tg = tailGeom(o); g.lineWidth = 3; g.fillStyle = '#fff';
      g.beginPath(); tg.forEach((q, i) => i ? g.lineTo(...q) : g.moveTo(...q)); g.closePath(); g.fill(); g.stroke();
      rr(g, o.x, o.y, o.w, o.h, 10); g.fill(); g.stroke(); g.fillStyle = c; rr(g, o.x, o.y, 8, o.h, 4); g.fill();
      cvText(g, o, o.x + 6, o.y, o.w - 6, o.h, '#1a1a1a');
    }
    else if (o.type === 'blur' && srcCanvas) {
      // 縮小→拡大でぼかす（ブラウザ差が出にくい方式）
      const sx = o.x * scale, sy = o.y * scale, sw = o.w * scale, sh = o.h * scale;
      const tw = Math.max(2, Math.round(sw / 14)), th = Math.max(2, Math.round(sh / 14));
      const tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
      tc.getContext('2d').drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, tw, th);
      g.imageSmoothingEnabled = true; g.drawImage(tc, 0, 0, tw, th, o.x, o.y, o.w, o.h);
    }
    else if (o.type === 'image' && p.images[o.img]) { const im = await loadImg(p.images[o.img]); if (im) g.drawImage(im, o.x, o.y, o.w, o.h); }
    g.restore();
  }
}
/* フレーム取得（隠し video を順番に使う） */
let grabQ = Promise.resolve();
function renderFrame(p, t, width = 800, withOverlays = true) {
  const job = grabQ.then(async () => {
    const url = await videoURL(p); if (!url) return placeholderThumb(p);
    const v = $('#grabber');
    if (v.dataset.src !== url) { v.dataset.src = url; v.src = url; await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); }); }
    await seekTo(v, t);
    const H = Math.round(width * p.vh / VW);
    const src = document.createElement('canvas'); src.width = width; src.height = H; src.getContext('2d').drawImage(v, 0, 0, width, H);
    if (!withOverlays) return src.toDataURL('image/jpeg', .8);
    const out = document.createElement('canvas'); out.width = width; out.height = H; const g = out.getContext('2d');
    g.drawImage(src, 0, 0); const s = width / VW; g.scale(s, s);
    await drawOverlaysCanvas(g, p, t, src, s);
    return out.toDataURL('image/jpeg', .86);
  });
  grabQ = job.catch(() => { });
  return job;
}

/* ---------- 編集画面 ---------- */
let E = null; // 編集状態
async function viewEditor(id, tab) {
  const p = PROJECTS.find(x => x.id === id);
  if (!p) { $('#view').innerHTML = '<div class="empty">マニュアルが見つかりません。<a href="#/manuals">一覧へ戻る</a></div>'; return; }
  crumbs(`<a href="#/manuals" style="color:inherit">マニュアル一覧</a> ／ <b>${esc(p.title)}</b>`);
  const keepT = E && E.p === p ? E.t : (p.steps[0]?.ft ?? 0);
  E = { p, tab, t: keepT, sel: E && E.p === p ? E.sel : null, tool: 'select', color: '#2463b5', undo: E && E.p === p ? E.undo : [] };
  const fi = FLOW.indexOf(p.status);
  $('#view').innerHTML = `
    <div class="ed-head">
      <input class="ed-title" id="ptitle" value="${esc(p.title)}" aria-label="タイトル">
      <div class="flow">${FLOW.map((s, i) => `<span class="${i === fi ? 'on' : i < fi ? 'past' : ''}">${STATUS[s]}</span>`).join('')}</div>
      <div class="row" style="margin-left:auto">${flowButtons(p)}</div>
    </div>
    <nav class="tabs">
      <a href="#/edit/${p.id}/annot" class="${tab === 'annot' ? 'on' : ''}">① 動画に注釈を入れる<span>${p.overlays.length}</span></a>
      <a href="#/edit/${p.id}/steps" class="${tab === 'steps' ? 'on' : ''}">② 手順を編集<span>${p.steps.length}</span></a>
      <a href="#/edit/${p.id}/preview" class="${tab === 'preview' ? 'on' : ''}">③ プレビュー・出力</a>
      <a href="#/edit/${p.id}/info" class="${tab === 'info' ? 'on' : ''}">文書情報・履歴</a>
    </nav>
    <div id="tabBody"></div>`;
  $('#ptitle').onchange = e => { p.title = e.target.value; touch(p); crumbs(`<a href="#/manuals" style="color:inherit">マニュアル一覧</a> ／ <b>${esc(p.title)}</b>`); };
  $$('[data-flow]').forEach(b => b.onclick = () => {
    const to = b.dataset.flow; const labels = { review: 'レビュー依頼', approved: '承認', published: '公開', draft: '差し戻し' };
    if (to === 'published' && !confirm('公開すると現場の閲覧端末に表示されます。公開しますか？')) return;
    if (to === 'published') p.version = bumpVersion(p.version, p.status);
    p.history.push({ at: today(), who: '製造技術課 管理者', what: labels[to] + (to === 'published' ? `（v${p.version}）` : '') });
    p.status = to; touch(p, true); toast(`${labels[to]}しました`); viewEditor(p.id, tab);
  });
  if (tab === 'annot') return tabAnnot(p);
  if (tab === 'steps') return tabSteps(p);
  if (tab === 'preview') return tabPreview(p);
  return tabInfo(p);
}
function bumpVersion(v, from) { const [a, b] = String(v).split('.').map(Number); return from === 'approved' ? `${a}.${(b || 0) + 1}` : v; }
function flowButtons(p) {
  if (p.status === 'draft') return `<button class="btn primary" data-flow="review">レビュー依頼</button>`;
  if (p.status === 'review') return `<button class="btn" data-flow="draft">差し戻し</button><button class="btn primary" data-flow="approved">承認する</button>`;
  if (p.status === 'approved') return `<button class="btn" data-flow="draft">差し戻し</button><button class="btn primary" data-flow="published">公開する</button>`;
  return `<button class="btn" data-flow="draft">改訂する（下書きに戻す）</button>`;
}

/* ===== ① 注釈タブ ===== */
const TOOL_ICONS = {
  select: '<path d="M5 3l12 7-5 1.5L9 17z" fill="currentColor"/>',
  arrow: '<path d="M3 17L16 4M16 4H8M16 4v8" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  rect: '<rect x="3" y="5" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="2" fill="none"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7.5" ry="6" stroke="currentColor" stroke-width="2" fill="none"/>',
  text: '<rect x="2" y="5" width="16" height="10" rx="2" fill="currentColor"/><path d="M7 8h6M10 8v5" stroke="var(--panel)" stroke-width="1.8"/>',
  number: '<circle cx="10" cy="10" r="7.5" fill="currentColor"/><text x="10" y="14" font-size="10" text-anchor="middle" fill="var(--panel)" font-weight="700">1</text>',
  callout: '<path d="M3 4h14v9H9l-4 4v-4H3z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>',
  blur: '<rect x="3" y="4" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2" fill="none"/><circle cx="8" cy="9" r="2" fill="currentColor" opacity=".5"/><circle cx="12" cy="11" r="2.5" fill="currentColor" opacity=".3"/>',
  image: '<rect x="2.5" y="4" width="15" height="12" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="7" cy="8.5" r="1.6" fill="currentColor"/><path d="M4 15l4.5-4.5 3 3 2-2 3.5 3.5" stroke="currentColor" stroke-width="1.8" fill="none"/>',
};
async function tabAnnot(p) {
  const url = await videoURL(p);
  const body = $('#tabBody');
  body.innerHTML = `<div class="ed">
    <div class="card" style="overflow:hidden">
      <div class="tools" id="tools">
        ${['select', 'arrow', 'rect', 'ellipse', 'number', 'text', 'callout', 'blur', 'image'].map(k => `<button class="tool" data-tool="${k}" title="${k === 'select' ? '選択・移動（V）' : TYPE_LABEL[k]}"><svg viewBox="0 0 20 20">${TOOL_ICONS[k]}</svg><span>${k === 'select' ? '選択' : TYPE_LABEL[k]}</span></button>`).join('')}
        <span class="sep"></span>
        <div class="swatches" id="sws">${COLORS.map(c => `<button class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
        <span class="grow"></span>
        <button class="tool" id="undoBtn" title="元に戻す（⌘Z / Ctrl+Z）">↶ 元に戻す</button>
      </div>
      <div class="stage-wrap">
        ${url ? `<div class="stage" id="stage"><video id="vid" src="${url}" playsinline preload="auto"></video><div class="blurs" id="blurs"></div><svg class="ov" id="ov" viewBox="0 0 ${VW} ${p.vh}"></svg></div>`
      : `<div class="stage-empty"><div style="text-align:center"><p>このマニュアルには動画が登録されていません（一覧表示用のダミーデータ）。</p><button class="btn" id="attachV">動画を登録する</button><input type="file" id="attachF" accept="video/*" hidden></div></div>`}
      </div>
      <div class="ctrl">
        <button class="btn sm" id="play" style="min-width:70px">▶ 再生</button>
        <button class="btn sm ghost" id="fb" title="1コマ戻る（←）">◀︎|</button><button class="btn sm ghost" id="ff" title="1コマ進む（→）">|▶︎</button>
        <span class="time" id="time"></span>
        <select class="in" id="rate" style="width:auto;padding:3px 6px"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
        <span class="grow"></span>
        <button class="btn sm" id="addStep">＋ この位置で手順を追加</button>
        <button class="btn sm" id="setFrame" title="現在の手順の写真を、この位置のフレームに変更">📷 手順写真にする</button>
      </div>
      <div class="tl" id="tl">
        <div class="tl-head"><span>タイムライン（上段：手順の区切り ／ 下段：注釈の表示時間）</span><span>クリックで移動・注釈はドラッグで時間調整</span></div>
        <div class="tl-body" id="tlBody"><div class="ruler" id="ruler"></div><div class="lanes" id="lanes"></div><div class="playhead" id="ph"></div></div>
      </div>
    </div>
    <div class="card side-panel" id="sp"></div>
  </div>`;
  if (!url) {
    $('#attachV').onclick = () => $('#attachF').click();
    $('#attachF').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const key = 'v_' + uid(); await DB.putBlob(key, f); videoURLCache[key] = URL.createObjectURL(f);
      const v = document.createElement('video'); v.src = videoURLCache[key]; await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; });
      Object.assign(p, { videoKey: key, videoName: f.name, duration: v.duration || p.duration, width: v.videoWidth || 960, height: v.videoHeight || 540 }); p.vh = VW * p.height / p.width;
      touch(p, true); viewEditor(p.id, 'annot');
    };
    ['play', 'fb', 'ff', 'addStep', 'setFrame', 'rate'].forEach(i => $('#' + i).disabled = true);
    $$('.tool,.sw').forEach(b => b.disabled = true);
    $('#sp').innerHTML = `<div class="sec hint">動画を登録すると、注釈を入れられるようになります。手順の文章は「② 手順を編集」から編集できます。</div>`;
    return;
  }
  const vid = $('#vid'), ov = $('#ov'), stage = $('#stage');
  E.vid = vid;
  await new Promise(r => { if (vid.readyState >= 1) r(); else { vid.onloadedmetadata = r; vid.onerror = r; } });
  if (isFinite(vid.duration) && vid.duration > 0) p.duration = vid.duration;
  vid.currentTime = Math.min(E.t, p.duration - 0.05);

  const setTool = k => {
    if (k === 'image') { $('#imgInput').click(); return; }
    E.tool = k; $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === k)); stage.classList.toggle('draw', k !== 'select');
  };
  const markColor = c => { E.color = c; $$('.sw[data-c]').forEach(b => b.classList.toggle('on', b.dataset.c === c)); };
  const setColor = c => { markColor(c); const o = selO(); if (o && o.type !== 'blur' && o.type !== 'image') { pushUndo(); o.color = c; changed(); } };
  $$('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $$('.sw[data-c]').forEach(b => b.onclick = () => setColor(b.dataset.c));
  setTool('select'); markColor(E.color);

  const selO = () => p.overlays.find(o => o.id === E.sel);
  const pushUndo = () => { E.undo.push(JSON.stringify(p.overlays)); if (E.undo.length > 40) E.undo.shift(); };
  const undo = () => { const s = E.undo.pop(); if (!s) { toast('これ以上戻せません'); return; } p.overlays = JSON.parse(s); if (!selO()) E.sel = null; changed(); };
  $('#undoBtn').onclick = undo;
  function changed(skipPanel) { touch(p); drawOv(); drawTL(); if (!skipPanel) drawPanel(); }

  /* --- ステージ描画 --- */
  function drawOv() {
    const t = vid.currentTime, vis = p.overlays.filter(o => t >= o.start && t < o.end);
    const k = VW / (stage.clientWidth || VW), hs = 7 * k;
    let html = vis.map(o => `<g data-id="${o.id}">${ovSVG(o, p.images, true)}</g>`).join('');
    const o = selO();
    if (o && vis.includes(o)) {
      if (o.type === 'arrow') html += [['p1', o.x1, o.y1], ['p2', o.x2, o.y2]].map(([h, x, y]) => `<circle class="h" data-h="${h}" cx="${x}" cy="${y}" r="${hs}"/>`).join('');
      else {
        html += `<rect class="sel-box" x="${o.x - 4 * k}" y="${o.y - 4 * k}" width="${o.w + 8 * k}" height="${o.h + 8 * k}"/>`;
        html += [['nw', o.x, o.y], ['ne', o.x + o.w, o.y], ['sw', o.x, o.y + o.h], ['se', o.x + o.w, o.y + o.h]].map(([h, x, y]) => `<rect class="h" data-h="${h}" x="${x - hs}" y="${y - hs}" width="${hs * 2}" height="${hs * 2}" rx="2"/>`).join('');
        if (o.type === 'callout') html += `<circle class="h" data-h="tail" cx="${o.tx}" cy="${o.ty}" r="${hs}" style="fill:#ffd24d"/>`;
      }
    }
    ov.innerHTML = html;
    $('#blurs').innerHTML = vis.filter(o => o.type === 'blur').map(o => `<div style="left:${o.x / VW * 100}%;top:${o.y / p.vh * 100}%;width:${o.w / VW * 100}%;height:${o.h / p.vh * 100}%"></div>`).join('');
    $('#time').textContent = `${fmt(t)} / ${fmt(p.duration)}`;
    const ph = $('#ph'); if (ph) ph.style.left = (t / p.duration * 100) + '%';
  }
  const pt = e => { const r = ov.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * VW, y: (e.clientY - r.top) / r.height * p.vh }; };
  const stepAt = t => { let s = null; p.steps.forEach(x => { if (x.t <= t + 0.01) s = x; }); return s; };
  const nextStepT = t => { const n = [...p.steps].sort((a, b) => a.t - b.t).find(x => x.t > t + 0.05); return n ? n.t : p.duration; };
  function newOverlay(type, a, b) {
    const t = +vid.currentTime.toFixed(2); const end = +Math.min(p.duration, Math.min(nextStepT(t), t + 8), Math.max(t + 1, nextStepT(t))).toFixed(2);
    const base = { id: uid(), type, start: t, end: end > t ? end : Math.min(p.duration, t + 3), color: E.color, sw: 6, fs: 26 };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const small = w < 12 && h < 12;
    if (type === 'arrow') return { ...base, x1: a.x, y1: a.y, x2: small ? a.x + 160 : b.x, y2: small ? a.y - 90 : b.y, sw: 8 };
    if (type === 'number') { const n = p.overlays.filter(o => o.type === 'number').length + 1; return { ...base, x: a.x - 28, y: a.y - 28, w: 56, h: 56, text: String(n), fs: 30 }; }
    if (type === 'text') return { ...base, x: small ? a.x : x, y: small ? a.y : y, w: small ? 320 : Math.max(w, 80), h: small ? 54 : Math.max(h, 40), text: 'ラベルを入力' };
    if (type === 'callout') return { ...base, x: small ? a.x + 60 : x, y: small ? a.y - 110 : y, w: small ? 300 : Math.max(w, 100), h: small ? 62 : Math.max(h, 44), text: '説明を入力', tx: a.x, ty: a.y };
    return { ...base, x: small ? a.x - 80 : x, y: small ? a.y - 60 : y, w: small ? 160 : w, h: small ? 120 : h, ...(type === 'blur' ? { color: '#888888', label: 'ぼかし' } : {}) };
  }

  /* --- ステージ操作 --- */
  let drag = null;
  ov.onpointerdown = e => {
    if (e.button) return; e.preventDefault(); vid.pause();
    const q = pt(e);
    if (E.tool !== 'select') {
      pushUndo();
      const o = newOverlay(E.tool, q, q); p.overlays.push(o); E.sel = o.id;
      drag = ['arrow', 'number'].includes(E.tool) ? (E.tool === 'arrow' ? { mode: 'h', h: 'p2', o, created: true, q0: q } : null) : { mode: 'create', o, q0: q };
      if (drag && drag.mode === 'create' && !['text', 'callout'].includes(o.type)) Object.assign(o, { x: q.x, y: q.y, w: 1, h: 1 });
      if (drag?.created) Object.assign(o, { x2: q.x, y2: q.y });
      ov.setPointerCapture(e.pointerId); changed(); return;
    }
    const hEl = e.target.closest('[data-h]'), gEl = e.target.closest('g[data-id]');
    if (hEl) { pushUndo(); drag = { mode: 'h', h: hEl.dataset.h, o: selO(), q0: q }; }
    else if (gEl) { E.sel = gEl.dataset.id; const o = selO(); pushUndo(); drag = { mode: 'move', o, q0: q, s: JSON.parse(JSON.stringify(o)) }; }
    else { E.sel = null; }
    ov.setPointerCapture(e.pointerId); changed();
  };
  ov.onpointermove = e => {
    if (!drag) return; const q = pt(e), o = drag.o, dx = q.x - drag.q0.x, dy = q.y - drag.q0.y;
    if (drag.mode === 'move') {
      const s = drag.s;
      if (o.type === 'arrow') Object.assign(o, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
      else { o.x = s.x + dx; o.y = s.y + dy; if (o.type === 'callout') { o.tx = s.tx + dx; o.ty = s.ty + dy; } }
    } else if (drag.mode === 'create') {
      const a = drag.q0; o.x = Math.min(a.x, q.x); o.y = Math.min(a.y, q.y); o.w = Math.abs(q.x - a.x); o.h = Math.abs(q.y - a.y);
      if (o.type === 'callout') { o.tx = a.x; o.ty = a.y; o.w = 300; o.h = 62; if (Math.hypot(dx, dy) < 24) { o.x = a.x + 60; o.y = a.y - 110; } else { o.x = q.x - o.w / 2; o.y = q.y - o.h / 2; } }
      if (o.type === 'text') { o.w = Math.max(o.w, 60); o.h = Math.max(o.h, 36); }
      if (e.shiftKey && (o.type === 'ellipse' || o.type === 'rect')) { const m = Math.max(o.w, o.h); o.w = o.h = m; }
    } else if (drag.mode === 'h') {
      const h = drag.h;
      if (h === 'p1') { o.x1 = q.x; o.y1 = q.y; } else if (h === 'p2') { o.x2 = q.x; o.y2 = q.y; }
      else if (h === 'tail') { o.tx = q.x; o.ty = q.y; }
      else {
        const r = { l: o.x, t: o.y, r: o.x + o.w, b: o.y + o.h };
        if (h.includes('w')) r.l = Math.min(q.x, r.r - 10); if (h.includes('e')) r.r = Math.max(q.x, r.l + 10);
        if (h.includes('n')) r.t = Math.min(q.y, r.b - 10); if (h.includes('s')) r.b = Math.max(q.y, r.t + 10);
        if (o.type === 'number' || (e.shiftKey && o.type === 'image')) {
          const ar = o.type === 'number' ? 1 : (drag.ar ||= o.w / o.h); const w = r.r - r.l; const hh = w / ar;
          if (h.includes('n')) r.t = r.b - hh; else r.b = r.t + hh;
        }
        Object.assign(o, { x: r.l, y: r.t, w: r.r - r.l, h: r.b - r.t });
        if (o.type === 'number') o.fs = Math.round(o.w * .54);
      }
    }
    drawOv();
  };
  ov.onpointerup = () => {
    if (!drag) return;
    const o = drag.o;
    if (drag.mode === 'create' && o.w < 12 && o.h < 12) Object.assign(o, newOverlay(o.type, drag.q0, drag.q0), { id: o.id });
    const wasCreate = drag.mode === 'create' || drag.created || (E.tool !== 'select');
    drag = null;
    if (wasCreate) { setTool('select'); if (['text', 'callout', 'number'].includes(o.type)) setTimeout(() => { const ta = $('#p-text'); ta && (ta.focus(), ta.select()); }, 30); }
    changed();
  };
  ov.ondblclick = e => { if (e.target.closest('g[data-id]')) { const ta = $('#p-text'); ta && (ta.focus(), ta.select()); } };

  /* 画像挿入 */
  const ii = $('#imgInput');
  ii.value = '';
  ii.onchange = () => {
    const f = ii.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      const src = await shrinkImage(fr.result, 900);
      const im = await loadImg(src); const id = 'img_' + uid(); p.images[id] = src;
      const w = 280, h = im ? w * im.height / im.width : 180;
      pushUndo();
      const t = +vid.currentTime.toFixed(2);
      const o = { id: uid(), type: 'image', start: t, end: +Math.min(p.duration, Math.max(t + 2, Math.min(nextStepT(t), t + 8))).toFixed(2), x: VW / 2 - w / 2, y: p.vh / 2 - h / 2, w, h, img: id, color: '#888888', sw: 0, fs: 26, label: f.name };
      p.overlays.push(o); E.sel = o.id; changed(); toast('画像を挿入しました。ドラッグで位置、四隅で大きさを調整できます');
    };
    fr.readAsDataURL(f); ii.value = '';
  };

  /* --- 再生コントロール --- */
  let raf = 0;
  const loop = () => { drawOv(); raf = requestAnimationFrame(loop); };
  vid.onplay = () => { $('#play').textContent = '❚❚ 停止'; cancelAnimationFrame(raf); loop(); };
  vid.onpause = () => { $('#play').textContent = '▶ 再生'; cancelAnimationFrame(raf); E.t = vid.currentTime; drawOv(); drawPanel(); };
  vid.onseeked = () => { E.t = vid.currentTime; drawOv(); };
  $('#play').onclick = () => vid.paused ? vid.play() : vid.pause();
  const seek = t => { vid.pause(); vid.currentTime = clamp(t, 0, p.duration - 0.03); E.t = vid.currentTime; drawOv(); drawPanel(); };
  $('#fb').onclick = () => seek(vid.currentTime - 1 / 24); $('#ff').onclick = () => seek(vid.currentTime + 1 / 24);
  $('#rate').onchange = e => vid.playbackRate = +e.target.value;
  $('#addStep').onclick = () => {
    const t = +vid.currentTime.toFixed(2);
    if (p.steps.some(s => Math.abs(s.t - t) < .3)) { toast('この位置にはすでに手順があります'); return; }
    p.steps.push({ id: uid(), t, ft: t, title: '新しい手順', desc: '', lv: 'none', ct: '', ai: false }); p.steps.sort((a, b) => a.t - b.t);
    touch(p); drawTL(); drawPanel(); $('.tabs a:nth-child(2) span').textContent = p.steps.length; toast(`${fmt(t)} に手順を追加しました`);
  };
  $('#setFrame').onclick = () => { const s = stepAt(vid.currentTime); if (!s) return; s.ft = +vid.currentTime.toFixed(2); touch(p); toast(`「${s.title}」の写真を ${fmt(s.ft)} のフレームに変更しました`); };

  /* --- タイムライン --- */
  function packLanes() {
    const sorted = [...p.overlays].sort((a, b) => a.start - b.start); const ends = []; const lane = {};
    sorted.forEach(o => { let i = ends.findIndex(e => e <= o.start + 0.001); if (i < 0) { i = ends.length; ends.push(0); } ends[i] = o.end; lane[o.id] = i; });
    return { lane, n: Math.max(ends.length, 1) };
  }
  function drawTL() {
    const D = p.duration || 1, pct = t => (t / D * 100) + '%';
    const stepEvery = D > 300 ? 60 : D > 120 ? 30 : D > 40 ? 10 : 5;
    let r = '';
    for (let t = 0; t <= D; t += 1) { const big = t % stepEvery === 0; if (D > 120 && !big && t % 5) continue; r += `<div class="tick ${big ? 'big' : ''}" style="left:${pct(t)}">${big ? `<b>${fmtS(t)}</b>` : ''}</div>`; }
    r += p.steps.map((s, i) => `<div class="flag" data-st="${s.id}" style="left:${pct(s.t)}" title="${esc(s.title)}"><span>${i + 1}</span></div>`).join('');
    $('#ruler').innerHTML = r;
    const { lane, n } = packLanes();
    $('#lanes').innerHTML = Array.from({ length: n }, (_, i) => `<div class="lane">${p.overlays.filter(o => lane[o.id] === i).map(o => `<div class="clip ${o.id === E.sel ? 'sel' : ''}" data-clip="${o.id}" style="left:${pct(o.start)};width:${pct(o.end - o.start)};background:${o.type === 'blur' || o.type === 'image' ? '#6b7280' : o.color === '#ffffff' ? '#9aa1a6' : o.color};${o.color === '#f2c200' ? 'color:#1a1a1a' : ''}"><span class="e l"></span>${TYPE_LABEL[o.type]} ${esc(o.text || o.label || '')}<span class="e r"></span></div>`).join('')}</div>`).join('');
    $('#ph').style.left = pct(vid.currentTime);
  }
  const tlBody = $('#tlBody');
  const tAt = e => { const r = $('#ruler').getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * p.duration; };
  let tdrag = null;
  tlBody.onpointerdown = e => {
    const clip = e.target.closest('[data-clip]'), flag = e.target.closest('[data-st]');
    if (flag) { const s = p.steps.find(x => x.id === flag.dataset.st); seek(s.ft); return; }
    if (clip) {
      const o = p.overlays.find(x => x.id === clip.dataset.clip); E.sel = o.id; pushUndo();
      tdrag = { o, mode: e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm', t0: tAt(e), s: o.start, en: o.end, moved: false };
      vid.pause(); drawTL(); drawPanel();
    } else { tdrag = { mode: 'seek' }; seek(tAt(e)); }
    tlBody.setPointerCapture(e.pointerId);
  };
  tlBody.onpointermove = e => {
    if (!tdrag) return;
    if (tdrag.mode === 'seek') { seek(tAt(e)); return; }
    const o = tdrag.o, dt = tAt(e) - tdrag.t0; tdrag.moved = true;
    const snap = v => { const cands = [...p.steps.map(s => s.t), vid.currentTime, 0, p.duration]; const near = cands.find(c => Math.abs(c - v) < p.duration * 0.008); return +(near ?? v).toFixed(2); };
    if (tdrag.mode === 'm') { const len = tdrag.en - tdrag.s; o.start = snap(clamp(tdrag.s + dt, 0, p.duration - len)); o.end = +(o.start + len).toFixed(2); }
    if (tdrag.mode === 'l') o.start = snap(clamp(tdrag.s + dt, 0, o.end - 0.2));
    if (tdrag.mode === 'r') o.end = snap(clamp(tdrag.en + dt, o.start + 0.2, p.duration));
    drawTL(); drawOv(); drawPanel();
  };
  tlBody.onpointerup = () => {
    if (tdrag && tdrag.o) { if (!tdrag.moved) { E.undo.pop(); if (vid.currentTime < tdrag.o.start || vid.currentTime >= tdrag.o.end) seek(tdrag.o.start + 0.01); } else touch(p); }
    tdrag = null;
  };

  /* --- 右パネル --- */
  function drawPanel() {
    const o = selO(), sp = $('#sp'), t = vid.currentTime, cur = stepAt(t);
    let html = '';
    if (o) {
      const hasText = ['text', 'callout', 'number'].includes(o.type), hasColor = !['blur', 'image'].includes(o.type), hasSw = ['rect', 'ellipse', 'arrow'].includes(o.type);
      html += `<div class="sec"><h3>選択中の注釈 ・ ${TYPE_LABEL[o.type]}</h3>
        ${hasText ? `<label class="f"><span>${o.type === 'number' ? '番号' : 'テキスト（改行可）'}</span><textarea class="in" id="p-text" rows="${o.type === 'number' ? 1 : 2}">${esc(o.text)}</textarea></label>` : ''}
        ${o.type === 'blur' || o.type === 'image' ? `<label class="f"><span>メモ（書き出しには出ません）</span><input class="in" id="p-label" value="${esc(o.label || '')}"></label>` : ''}
        ${hasColor ? `<label class="f"><span>色</span><div class="swatches">${COLORS.map(c => `<button class="sw ${o.color === c ? 'on' : ''}" data-pc="${c}" style="background:${c}"></button>`).join('')}</div></label>` : ''}
        ${hasSw ? `<label class="f"><span>線の太さ ${o.sw}</span><input type="range" id="p-sw" min="2" max="16" value="${o.sw}" style="width:100%"></label>` : ''}
        ${hasText && o.type !== 'number' ? `<label class="f"><span>文字サイズ ${o.fs}</span><input type="range" id="p-fs" min="14" max="60" value="${o.fs}" style="width:100%"></label>` : ''}
        <div class="two"><label class="f"><span>表示開始（秒）</span><input class="in mono" type="number" step="0.1" id="p-start" value="${o.start}"></label><label class="f"><span>表示終了（秒）</span><input class="in mono" type="number" step="0.1" id="p-end" value="${o.end}"></label></div>
        <div class="row" style="gap:6px;margin-bottom:8px"><button class="btn sm" id="p-sn">開始を現在位置に</button><button class="btn sm" id="p-en">終了を現在位置に</button><button class="btn sm" id="p-step">手順の終わりまで</button></div>
        <div class="row" style="gap:6px"><button class="btn sm" id="p-dup">複製</button><button class="btn sm" id="p-front">最前面へ</button><button class="btn sm" id="p-back">最背面へ</button><button class="btn sm" id="p-del" style="margin-left:auto;color:var(--red)">削除</button></div>
      </div>`;
    } else {
      html += `<div class="sec"><h3>使い方</h3><div class="hint">上のツールを選んで動画の上をドラッグすると注釈が入ります。入れた注釈は、下のタイムラインで表示する時間を調整できます。<br><br>
        <kbd>Space</kbd> 再生/停止　<kbd>←</kbd><kbd>→</kbd> 1コマ移動（<kbd>Shift</kbd>で1秒）<br><kbd>Delete</kbd> 注釈を削除　<kbd>V</kbd> 選択ツール　<kbd>⌘Z</kbd> 元に戻す</div></div>`;
    }
    const vis = p.overlays.filter(x => t >= x.start && t < x.end);
    html += `<div class="sec"><h3>この時点で表示中の注釈（${vis.length} / 全 ${p.overlays.length}）</h3><ul class="ovlist">${[...p.overlays].sort((a, b) => a.start - b.start).map(x => `<li data-ol="${x.id}" class="${x.id === E.sel ? 'sel' : ''}" style="${vis.includes(x) ? '' : 'opacity:.5'}"><span class="c" style="background:${x.type === 'blur' || x.type === 'image' ? '#888' : x.color}"></span>${TYPE_LABEL[x.type]} <span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px">${esc(x.text || x.label || '')}</span><span class="tm">${x.start.toFixed(1)}–${x.end.toFixed(1)}</span></li>`).join('') || '<li class="muted">まだ注釈はありません</li>'}</ul></div>`;
    html += `<div class="sec"><h3>手順（${p.steps.length}）</h3><ul class="ovlist">${p.steps.map((s, i) => `<li data-sj="${s.id}" class="${cur && cur.id === s.id ? 'sel' : ''}"><b class="mono" style="width:18px">${i + 1}</b>${esc(s.title)}<span class="tm">${fmt(s.t)}</span></li>`).join('')}</ul></div>`;
    sp.innerHTML = html;
    $$('[data-ol]', sp).forEach(li => li.onclick = () => { const x = p.overlays.find(y => y.id === li.dataset.ol); E.sel = x.id; if (t < x.start || t >= x.end) seek(x.start + 0.01); else { drawOv(); drawTL(); drawPanel(); } });
    $$('[data-sj]', sp).forEach(li => li.onclick = () => seek(p.steps.find(s => s.id === li.dataset.sj).ft));
    if (!o) return;
    const bind = (id, fn, ev = 'input') => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    let typed = false;
    bind('p-text', e => { if (!typed) { pushUndo(); typed = true; } o.text = e.target.value; touch(p); drawOv(); drawTL(); });
    bind('p-label', e => { o.label = e.target.value; touch(p); drawTL(); });
    bind('p-sw', e => { o.sw = +e.target.value; e.target.previousElementSibling.textContent = '線の太さ ' + o.sw; touch(p); drawOv(); });
    bind('p-fs', e => { o.fs = +e.target.value; e.target.previousElementSibling.textContent = '文字サイズ ' + o.fs; touch(p); drawOv(); });
    $$('[data-pc]', sp).forEach(b => b.onclick = () => { pushUndo(); o.color = b.dataset.pc; changed(); });
    bind('p-start', e => { pushUndo(); o.start = clamp(+e.target.value, 0, o.end - .1); changed(); }, 'change');
    bind('p-end', e => { pushUndo(); o.end = clamp(+e.target.value, o.start + .1, p.duration); changed(); }, 'change');
    bind('p-sn', () => { pushUndo(); o.start = +Math.min(vid.currentTime, o.end - .1).toFixed(2); changed(); }, 'click');
    bind('p-en', () => { pushUndo(); o.end = +Math.max(vid.currentTime, o.start + .1).toFixed(2); changed(); }, 'click');
    bind('p-step', () => { pushUndo(); o.end = +nextStepT(o.start).toFixed(2); changed(); }, 'click');
    bind('p-dup', () => { pushUndo(); const c = { ...JSON.parse(JSON.stringify(o)), id: uid() }; if (c.type === 'arrow') { c.x1 += 20; c.y1 += 20; c.x2 += 20; c.y2 += 20; } else { c.x += 20; c.y += 20; if (c.tx != null) { c.tx += 20; c.ty += 20; } } p.overlays.push(c); E.sel = c.id; changed(); }, 'click');
    bind('p-front', () => { pushUndo(); p.overlays = p.overlays.filter(x => x !== o).concat(o); changed(); }, 'click');
    bind('p-back', () => { pushUndo(); p.overlays = [o, ...p.overlays.filter(x => x !== o)]; changed(); }, 'click');
    bind('p-del', () => delSel(), 'click');
  }
  function delSel() { const o = selO(); if (!o) return; pushUndo(); p.overlays = p.overlays.filter(x => x !== o); E.sel = null; changed(); $('.tabs a:nth-child(1) span').textContent = p.overlays.length; }

  /* --- キーボード --- */
  const onKey = e => {
    if (e.target.closest('input,textarea,select')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#play').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(vid.currentTime - (e.shiftKey ? 1 : 1 / 24)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(vid.currentTime + (e.shiftKey ? 1 : 1 / 24)); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (E.sel) { e.preventDefault(); delSel(); } }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'v') setTool('select');
    else if (e.key === 'Escape') { E.sel = null; setTool('select'); changed(); }
  };
  document.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => drawOv()); ro.observe(stage);
  cleanup = () => { document.removeEventListener('keydown', onKey); cancelAnimationFrame(raf); ro.disconnect(); vid.pause(); E.t = vid.currentTime; };
  drawOv(); drawTL(); drawPanel();
}
function shrinkImage(src, max) {
  return new Promise(res => {
    if (src.startsWith('data:image/svg')) return res(src);
    const i = new Image(); i.onload = () => {
      const s = Math.min(1, max / Math.max(i.width, i.height)); const c = document.createElement('canvas'); c.width = Math.round(i.width * s); c.height = Math.round(i.height * s);
      c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); res(c.toDataURL(src.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', .9));
    }; i.onerror = () => res(src); i.src = src;
  });
}

/* ===== ② 手順タブ ===== */
function lintSteps(p) {
  const out = []; const kw = lv => SETTINGS.keywords[lv].split(/[,、]/).map(s => s.trim()).filter(Boolean);
  p.steps.forEach((s, i) => {
    const n = `手順${i + 1}`;
    if (!s.title.trim() || /^手順 ?\d+$/.test(s.title) || s.title === '新しい手順') out.push([s.id, `${n}：タイトルが仮のままです`]);
    if (!s.desc.trim()) out.push([s.id, `${n}：作業内容が空欄です`]);
    for (const lv of ['danger', 'warning']) { const hit = kw(lv).find(k => (s.title + s.desc).includes(k)); if (hit && (s.lv === 'none' || s.lv === 'caution')) { out.push([s.id, `${n}：「${hit}」を含みますが、注意レベルが「${LV[s.lv]}」です（推奨：${LV[lv]}）`]); break; } }
    if (s.lv !== 'none' && !s.ct.trim()) out.push([s.id, `${n}：注意レベルを設定していますが、注意文が空欄です`]);
    const da = /(ます|ません)。?\s*$/m.test(s.desc), de = /(する|しない|こと)。?\s*$/m.test(s.desc);
    if (SETTINGS.style === 'desu' && de) out.push([s.id, `${n}：である調の文末があります（設定：です・ます調）`]);
    if (SETTINGS.style === 'dearu' && da) out.push([s.id, `${n}：です・ます調の文末があります（設定：である調）`]);
  });
  return out;
}
function tabSteps(p) {
  const body = $('#tabBody');
  const draw = () => {
    const lint = lintSteps(p);
    body.innerHTML = `
      <div class="card pad row" style="margin-bottom:12px;gap:14px">
        <div class="grow"><b>表記チェック</b> <span class="muted" style="font-size:12px">（生成設定のルールで判定）</span>
          ${lint.length ? `<ul class="hint" style="margin:6px 0 0;padding-left:18px">${lint.map(([, m]) => `<li>${esc(m)}</li>`).join('')}</ul>` : '<div class="hint" style="color:var(--green)">✓ 指摘はありません</div>'}</div>
        <button class="btn" id="addBlank">＋ 手順を追加</button>
      </div>
      <div class="steps">${p.steps.map((s, i) => `
        <div class="card step" data-s="${s.id}">
          <div class="no">${i + 1}</div>
          <div><div class="img" data-img="${s.id}"><span class="t">${fmt(s.ft)}</span></div>
            <div class="acts"><a class="btn sm" href="#/edit/${p.id}/annot" data-goto="${s.id}">✎ 注釈を編集</a><button class="btn sm" data-mv="-1" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-mv="1" ${i < p.steps.length - 1 ? '' : 'disabled'}>↓</button><button class="btn sm" data-rm style="color:var(--red)">削除</button></div></div>
          <div>
            <label class="f"><span>手順タイトル</span><input class="in" data-k="title" value="${esc(s.title)}"></label>
            <label class="f"><span>作業内容</span><textarea class="in" data-k="desc" rows="3" placeholder="作業の内容を入力">${esc(s.desc)}</textarea></label>
            <div class="row" style="align-items:flex-start;gap:12px">
              <div><span style="font-size:12px;color:var(--ink-2)">注意レベル</span><div class="lv" style="margin-top:3px">${Object.entries(LV).map(([k, l]) => `<button data-lv="${k}" class="${s.lv === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
              <label class="f grow" style="margin:0"><span>注意文</span><input class="in" data-k="ct" value="${esc(s.ct)}" placeholder="${s.lv === 'none' ? '（注意レベル「なし」のときは表示しません）' : '注意する内容'}"></label>
            </div>
            <div class="row" style="margin-top:8px;justify-content:space-between"><span class="ai-note">${s.ai ? '◆ 自動生成された下書き' : '手入力'}${lint.some(l => l[0] === s.id) ? ' ・ <span style="color:var(--accent)">表記チェックの指摘あり</span>' : ''}</span><span class="muted mono" style="font-size:11px">区切り ${fmt(s.t)} ／ 写真 ${fmt(s.ft)}</span></div>
          </div>
        </div>`).join('') || '<div class="card empty">手順がありません</div>'}</div>`;
    $$('[data-img]').forEach(async el => {
      const s = p.steps.find(x => x.id === el.dataset.img);
      const src = p.videoKey ? await renderFrame(p, s.ft + 0.01, 640) : placeholderThumb(p, p.steps.indexOf(s) + 1);
      el.insertAdjacentHTML('afterbegin', `<img src="${src}" alt="">`);
    });
    $$('.step').forEach(card => {
      const s = p.steps.find(x => x.id === card.dataset.s);
      $$('[data-k]', card).forEach(inp => { inp.oninput = () => { s[inp.dataset.k] = inp.value; s.ai = false; touch(p); }; inp.onchange = draw; });
      $$('[data-lv]', card).forEach(b => b.onclick = () => { s.lv = b.dataset.lv; touch(p); draw(); });
      $('[data-rm]', card).onclick = () => { if (!confirm(`手順「${s.title}」を削除しますか？（注釈は残ります）`)) return; p.steps = p.steps.filter(x => x !== s); touch(p); draw(); };
      $$('[data-mv]', card).forEach(b => b.onclick = () => {
        const i = p.steps.indexOf(s), j = i + +b.dataset.mv; [p.steps[i], p.steps[j]] = [p.steps[j], p.steps[i]];
        touch(p); draw();
      });
      $('[data-goto]', card).onclick = () => { E.t = s.ft; };
    });
    $('#addBlank').onclick = () => { const last = p.steps[p.steps.length - 1]; const t = last ? Math.min(p.duration, last.t + 1) : 0; p.steps.push({ id: uid(), t, ft: t, title: '新しい手順', desc: '', lv: 'none', ct: '', ai: false }); touch(p); draw(); };
    $('.tabs a:nth-child(2) span').textContent = p.steps.length;
  };
  draw();
}

/* ===== 出力フォーマット（テンプレート） ===== */
const LBL = {
  ja: { title: 'タイトル', docNo: '文書番号', process: '工程', equipment: '設備・型式', line: 'ライン・場所', target: '対象者', version: '版', date: '発行日', page: '頁', author: '作成部署',
    info: '基本情報', ppe: '必要な保護具', spec: '仕様', steps: '作業手順', notes: '注意事項', tools: '工具・治具', materials: '使用材料', forms: '関連帳票', freq: '記入頻度', rev: '改訂履歴', revNo: '版', revDesc: '改訂内容', revDate: '日付', stepCnt: '手順数' },
  zh: { title: '描述', docNo: '工序号', process: '工序', equipment: '型号', line: '线别', target: '作业者', version: '版次', date: '发行日', page: '页', author: '部门',
    info: '基本信息', ppe: '防护用品', spec: '仕样', steps: '步骤', notes: '注意事项', tools: '工具仪器', materials: '使用材料', forms: '相关表单', freq: '检查频率', rev: '修订履历', revNo: '版次', revDesc: '修订内容', revDate: '日期', stepCnt: '步骤数' },
  en: { title: 'Description', docNo: 'WI No.', process: 'Process', equipment: 'Model', line: 'Line', target: 'Operator', version: 'Rev.', date: 'Issued', page: 'Page', author: 'Dept.',
    info: 'Overview', ppe: 'PPE', spec: 'Specification', steps: 'Steps', notes: 'Notes', tools: 'Tools', materials: 'Materials', forms: 'Related forms', freq: 'Frequency', rev: 'Revision', revNo: 'Rev.', revDesc: 'Description', revDate: 'Date', stepCnt: 'Steps' },
};
const LANGS = { ja: '日本語', 'ja-en': '日本語＋英語', 'ja-zh': '日本語＋中国語', 'en-ja': '英語＋日本語', 'zh-ja': '中国語＋日本語' };
const lbl = (T, k) => { const [a, b] = T.lang.split('-'); return b ? `${LBL[a][k]}<small>${LBL[b][k]}</small>` : LBL[a][k]; };
const HEADER_KEYS = ['docNo', 'process', 'equipment', 'title', 'line', 'target', 'version', 'date', 'page', 'author'];
const SECTION_NAMES = { info: '基本情報（設備・工程・対象者）', ppe: '必要な保護具', spec: '仕様表', steps: '作業手順', notes: '注意事項のまとめ', resources: '工具・材料・関連帳票', rev: '改訂履歴', sign: '承認欄' };
const DOC_COLORS = ['#1a1a1a', '#1f3fae', '#1c5fb8', '#0f7a5c', '#b3261e'];
const BUILTIN_TEMPLATES = [
  { id: 'std', builtin: true, name: '標準（A4縦・1手順1行）', heading: '作業標準書（操作手順）', orient: 'portrait', cols: 1, flow: 'z', arrows: false, imgPos: 'left', imgSize: 'l', notesPos: 'inline',
    header: ['docNo', 'version', 'date'], sections: [['info', 1], ['ppe', 1], ['spec', 0], ['steps', 1], ['notes', 0], ['resources', 0], ['rev', 0], ['sign', 1]], footerRow: false, sign: '作成,確認,承認', signReverse: true, lang: 'ja', color: '#1a1a1a', fs: 'm', showTime: true },
  { id: 'wi', builtin: true, name: '作業指導書（A4横・フロー型）', heading: '作業指導書　WORK INSTRUCTION', orient: 'landscape', cols: 5, flow: 'snake', arrows: true, imgPos: 'below', imgSize: 'l', notesPos: 'side',
    header: ['docNo', 'process', 'equipment', 'title', 'version', 'page'], sections: [['spec', 1], ['steps', 1], ['notes', 1], ['resources', 1], ['rev', 1], ['sign', 1], ['info', 0], ['ppe', 0]], footerRow: true, sign: '作成,確認,承認', signReverse: false, lang: 'ja-zh', color: '#1f3fae', fs: 's', showTime: false },
  { id: 'card', builtin: true, name: '現場掲示用（A4横・写真大きめ3列）', heading: '操作手順', orient: 'landscape', cols: 3, flow: 'z', arrows: true, imgPos: 'above', imgSize: 'l', notesPos: 'inline',
    header: ['equipment', 'line', 'version'], sections: [['ppe', 1], ['steps', 1], ['info', 0], ['spec', 0], ['notes', 0], ['resources', 0], ['rev', 0], ['sign', 0]], footerRow: false, sign: '作成,確認,承認', signReverse: true, lang: 'ja', color: '#1c5fb8', fs: 'l', showTime: false },
];
let CUSTOM_TEMPLATES = [];
const allTemplates = () => [...BUILTIN_TEMPLATES, ...CUSTOM_TEMPLATES];
const getT = id => allTemplates().find(t => t.id === id) || BUILTIN_TEMPLATES[0];
let tplSaveTimer;
function saveTemplates() { clearTimeout(tplSaveTimer); tplSaveTimer = setTimeout(() => DB.kvPut('templates', CUSTOM_TEMPLATES).then(() => { $('#saveState').textContent = '保存済み ' + new Date().toLocaleTimeString('ja-JP'); }), 300); }

/* 手順写真のキャッシュ（プレビューを何度も組み直すため） */
const stepImgCache = {};
function stepImages(p, withAnn) {
  const k = `${p.id}|${p.updatedAt}|${withAnn}`;
  if (!stepImgCache[k]) stepImgCache[k] = (async () => { const out = []; for (const [i, s] of p.steps.entries()) out.push(p.videoKey ? await renderFrame(p, s.ft + 0.01, 640, withAnn) : placeholderThumb(p, i + 1)); return out; })();
  return stepImgCache[k];
}

function renderDoc(el, p, imgs, T) {
  el.className = `doc ${T.orient === 'landscape' ? 'land' : ''} fs-${T.fs}`;
  el.style.setProperty('--dc', T.color);
  el.dataset.orient = T.orient;
  el.innerHTML = docHTML(p, imgs, T);
}
function docHTML(p, imgs, T) {
  const L = k => lbl(T, k);
  const val = { docNo: p.docNo || '—', process: p.process || '—', equipment: p.equipment || '—', line: p.line || '—', target: p.target || '—', version: p.version, date: p.revisions.at(-1)?.[2] || p.createdAt, page: '1 / 1', title: p.title, author: p.author };
  const lvName = { caution: '注意', warning: '警告', danger: '危険' };
  const ct = s => s.lv !== 'none' && s.ct ? `<div class="ct ${s.lv}"><b>${lvName[s.lv]}</b>${esc(s.ct)}</div>` : '';
  const on = T.sections.filter(x => x[1]).map(x => x[0]);
  const side = T.notesPos === 'side' && on.includes('notes');
  const top = T.header.includes('title')
    ? `<div class="dt-top"><h1>${esc(T.heading)}</h1></div>`
    : `<div class="dt-top left"><div class="dt-kicker">${esc(T.heading)}</div><h1>${esc(p.title)}</h1></div>`;
  const htable = T.header.length ? `<table class="dt-t dt-h"><tr>${T.header.map(k => `<th>${L(k)}</th>`).join('')}</tr><tr>${T.header.map(k => `<td>${esc(val[k])}</td>`).join('')}</tr></table>` : '';
  const steps = () => {
    const n = p.steps.length, C = Math.max(1, Math.min(+T.cols || 1, n || 1));
    const pos = i => { const r = Math.floor(i / C); let c = i % C; if (T.flow === 'snake' && r % 2) c = C - 1 - c; return [r, c]; };
    const iw = { s: 32, m: 42, l: 52 }[T.imgSize], iw2 = { s: 70, m: 85, l: 100 }[T.imgSize];
    const cells = p.steps.map((s, i) => {
      const [r, c] = pos(i); let ar = '';
      if (T.arrows && i < n - 1) { const [r2, c2] = pos(i + 1); if (!(r2 > r && c2 !== c)) ar = `<span class="ar ar-${r2 > r ? 'd' : c2 > c ? 'r' : 'l'}"></span>`; }
      const img = `<img src="${imgs[i]}" alt="手順${i + 1}">`;
      const txt = `<div class="ctx"><div class="chd"><b>${i + 1}</b><span>${esc(s.title)}</span></div><p>${esc(s.desc)}</p>${T.notesPos !== 'side' ? ct(s) : ''}${T.showTime ? `<div class="tm">動画 ${fmt(s.t)}〜</div>` : ''}</div>`;
      return `<div class="cell img-${T.imgPos}" style="grid-row:${r + 1};grid-column:${c + 1};--iw:${iw}%;--iw2:${iw2}%">${T.imgPos === 'below' ? txt + img : img + txt}${ar}</div>`;
    }).join('');
    return `<h4 class="dt-sh">${L('steps')}</h4><div class="dt-grid ${T.imgPos === 'left' ? 'rows' : ''}" style="grid-template-columns:repeat(${C},minmax(0,1fr))">${cells}</div>`;
  };
  const notes = () => {
    const gen = String(p.notes || '').split('\n').map(x => x.trim()).filter(Boolean);
    const fromSteps = T.notesPos === 'inline' ? [] : p.steps.map((s, i) => [s, i]).filter(([s]) => s.lv !== 'none' && s.ct);
    if (!gen.length && !fromSteps.length) return '';
    return `<div class="dt-notes"><h4>${L('notes')}</h4><ol>${gen.map(g => `<li>${esc(g)}</li>`).join('')}${fromSteps.map(([s, i]) => `<li><b class="lv-${s.lv}">［${lvName[s.lv]}］</b>手順${i + 1}：${esc(s.ct)}</li>`).join('')}</ol></div>`;
  };
  const list = (k, arr) => `<table class="dt-t"><tr><th>${L(k)}</th></tr>${arr.length ? arr.map((x, i) => `<tr><td>${i + 1}. ${esc(x)}</td></tr>`).join('') : '<tr><td>—</td></tr>'}</table>`;
  const signLabels = String(T.sign || '').split(/[,、]/).map(x => x.trim()).filter(Boolean);
  const stampN = { draft: 1, review: 2, approved: 99, published: 99 }[p.status] || 0;
  const signCells = signLabels.map((l, i) => ({ l, stamped: i < stampN }));
  if (T.signReverse) signCells.reverse();
  const sec = {
    info: () => `<div class="info"><div><small>${L('equipment')}</small>${esc(val.equipment)}</div><div><small>${L('process')} / ${L('line')}</small>${esc(val.process)} ／ ${esc(val.line)}</div><div><small>${L('target')}</small>${esc(val.target)}</div><div><small>${L('stepCnt')}</small>${p.steps.length}</div></div>`,
    ppe: () => p.ppe ? `<div class="ppe"><b>${L('ppe')}</b><span>${esc(p.ppe).split(/[,、]/).join('　・　')}</span></div>` : '',
    spec: () => p.specs.length ? `<h4 class="dt-sh">${L('spec')}</h4><table class="dt-t dt-spec"><tr>${p.specs.map(r => `<th>${esc(r[0])}</th>`).join('')}</tr><tr>${p.specs.map(r => `<td>${esc(r[1])}</td>`).join('')}</tr></table>` : '',
    steps: () => side ? `<div class="dt-with-side"><div>${steps()}</div><aside>${notes()}</aside></div>` : steps(),
    notes: () => side ? '' : notes(),
    resources: () => `<div class="dt-res">${list('tools', p.tools)}${list('materials', p.materials)}<table class="dt-t"><tr><th>${L('forms')}</th><th>${L('freq')}</th></tr>${p.forms.length ? p.forms.map(f => `<tr><td>${esc(f[0])}</td><td>${esc(f[1])}</td></tr>`).join('') : '<tr><td>—</td><td></td></tr>'}</table></div>`,
    rev: () => `<table class="dt-t dt-rev"><tr><th>${L('revNo')}</th><th>${L('revDesc')}</th><th>${L('revDate')}</th></tr>${p.revisions.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="nw">${esc(r[2])}</td></tr>`).join('')}</table>`,
    sign: () => signCells.length ? `<div class="dt-sign"><table class="dt-t"><tr>${signCells.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr><tr>${signCells.map(c => `<td>${c.stamped ? `<span class="stampc">${esc(c.l)}</span>` : ''}</td>`).join('')}</tr></table></div>` : '',
  };
  const inl = k => T.footerRow && ['resources', 'rev', 'sign'].includes(k);
  const body = on.map(k => { const h = sec[k](); return h ? `<section class="dt-sec ${inl(k) ? 'inl inl-' + k : ''}">${h}</section>` : ''; }).join('');
  return `${top}${htable}<div class="dt-body">${body}</div><div class="foot"><span>${esc(p.author)} ／ ${STATUS[p.status]}</span><span>${esc(T.name)}</span></div>`;
}
function fitDoc(el) {
  const wrap = el.parentElement; el.style.zoom = 1;
  const s = Math.min(1, (wrap.clientWidth - 2) / el.offsetWidth); el.style.zoom = s < 1 ? s : '';
}
function pageCSS(T) { return `@page{size:A4 ${T.orient};margin:8mm}`; }
function setPrintPage(T) { let st = $('#pageSize'); if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); } st.textContent = pageCSS(T); }

/* ===== ③ プレビュー・出力 ===== */
async function tabPreview(p) {
  const body = $('#tabBody');
  body.innerHTML = `<div class="doc-wrap">
    <div class="doc-side card pad">
      <h2>出力フォーマット</h2>
      <select class="in" id="tplSel">${allTemplates().map(t => `<option value="${t.id}" ${t.id === p.template ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <a class="btn sm" style="margin-top:8px" href="#/templates/${esc(p.template)}">⚙ フォーマットを編集・新規作成</a>
      <h2 style="margin-top:16px">出力</h2>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn" id="xPrint">🖨 印刷する</button>
        <button class="btn" id="xHtml">⤓ 手順書をHTMLで保存</button>
        <button class="btn" id="xVideo" ${p.videoKey ? '' : 'disabled'}>🎬 注釈入り動画を書き出し</button>
      </div>
      <label class="row" style="font-size:13px;gap:6px;margin-top:12px"><input type="checkbox" id="optAnn" checked> 写真に注釈を入れる</label>
      <p class="hint" style="margin-top:10px">仕様表・工具・改訂履歴などの中身は「文書情報・履歴」タブで入力します。</p>
    </div>
    <div class="grow doc-fit" style="min-width:0"><div class="doc" id="doc"><div class="empty">手順書を組み立てています…</div></div></div>
  </div>`;
  const build = async () => {
    const T = getT(p.template); setPrintPage(T);
    const imgs = await stepImages(p, $('#optAnn').checked);
    renderDoc($('#doc'), p, imgs, T); fitDoc($('#doc'));
  };
  $('#tplSel').onchange = e => { p.template = e.target.value; touch(p); $('.doc-side a.btn').href = `#/templates/${p.template}`; build(); };
  $('#optAnn').onchange = build;
  $('#xPrint').onclick = () => { const d = $('#doc'); d.style.zoom = ''; window.print(); fitDoc(d); };
  $('#xHtml').onclick = () => {
    const d = $('#doc').cloneNode(true); d.style.zoom = ''; d.removeAttribute('id');
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><style>${docCSS()}${pageCSS(getT(p.template))}</style></head><body>${d.outerHTML}</body></html>`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' })); a.download = `${p.docNo || 'manual'}_${p.title}.html`; a.click();
    toast('HTMLファイルを保存しました（画像込みの1ファイル）');
  };
  $('#xVideo').onclick = () => exportVideo(p);
  const ro = new ResizeObserver(() => fitDoc($('#doc'))); ro.observe($('.doc-fit'));
  cleanup = () => ro.disconnect();
  await build();
}
function docCSS() {
  const sheet = [...document.styleSheets].find(s => (s.href || '').includes('app.css'));
  let css = 'body{margin:0;background:#eee;font-family:"Noto Sans JP","Hiragino Sans",sans-serif}.doc{margin:20px auto}@media print{body{background:#fff}.doc{margin:0;box-shadow:none}}';
  try { css += [...sheet.cssRules].map(r => r.cssText).filter(t => t.startsWith('.doc')).join('\n'); } catch { }
  return css;
}

/* ===== フォーマット編集画面 ===== */
async function viewTemplates(id) {
  crumbs('<b>出力フォーマット</b>');
  let T = getT(id || 'wi');
  const sample = PROJECTS.find(x => x.videoKey === 'sample') || PROJECTS[0];
  let prevId = (viewTemplates.prev && PROJECTS.find(x => x.id === viewTemplates.prev)) ? viewTemplates.prev : sample?.id;
  const opt = (k, v, l) => `<option value="${v}" ${String(T[k]) === String(v) ? 'selected' : ''}>${l}</option>`;
  const dis = T.builtin ? 'disabled' : '';
  $('#view').innerHTML = `
    <div class="row" style="margin-bottom:14px"><div class="grow"><h1>出力フォーマット</h1><p class="sub" style="margin:0">手順書の見た目を、列数・並び順・見出し項目・載せる欄の組み合わせで作れます。全マニュアルで共通に使えます。</p></div></div>
    <div class="tpl">
      <div class="card tpl-list">
        <div class="sec"><h3>フォーマット一覧</h3>
          <ul class="ovlist">${allTemplates().map(t => `<li data-tid="${t.id}" class="${t.id === T.id ? 'sel' : ''}"><span class="grow">${esc(t.name)}</span>${t.builtin ? '<span class="tag">標準</span>' : ''}</li>`).join('')}</ul>
          <button class="btn sm" id="tDup" style="margin-top:10px;width:100%">＋ このフォーマットを複製して新規作成</button>
        </div>
        <div class="sec hint"><b>既存の帳票から作る</b><span class="tag">API接続予定</span><br>いま使っている作業指導書（PDF・Excel）を読み込ませて、AIがレイアウトを読み取り、近い設定を作る機能を想定しています。このデモでは未実装です。代わりに、上の「作業指導書（A4横・フロー型）」が、横型の作業指導書を例にした設定です。</div>
      </div>
      <div class="card tpl-form">
        ${T.builtin ? `<div class="sec" style="background:var(--accent-soft)"><span class="hint">標準のフォーマットは直接は変更できません。「複製して新規作成」から編集してください。</span></div>` : ''}
        <div class="sec"><h3>基本</h3>
          <label class="f"><span>フォーマット名</span><input class="in" data-t="name" value="${esc(T.name)}" ${dis}></label>
          <label class="f"><span>文書の見出し</span><input class="in" data-t="heading" value="${esc(T.heading)}" ${dis}></label>
          <div class="two">
            <label class="f"><span>用紙</span><select class="in" data-t="orient" ${dis}>${opt('orient', 'portrait', 'A4 縦')}${opt('orient', 'landscape', 'A4 横')}</select></label>
            <label class="f"><span>見出しの言語</span><select class="in" data-t="lang" ${dis}>${Object.entries(LANGS).map(([k, v]) => opt('lang', k, v)).join('')}</select></label>
            <label class="f"><span>文字サイズ</span><select class="in" data-t="fs" ${dis}>${opt('fs', 's', '小')}${opt('fs', 'm', '中')}${opt('fs', 'l', '大')}</select></label>
            <label class="f"><span>罫線・見出しの色</span><div class="swatches" style="margin-top:4px">${DOC_COLORS.map(c => `<button class="sw ${T.color === c ? 'on' : ''}" data-tc="${c}" style="background:${c}" ${dis}></button>`).join('')}</div></label>
          </div>
        </div>
        <div class="sec"><h3>手順の並べ方</h3>
          <div class="two">
            <label class="f"><span>列数 ${T.cols}</span><input type="range" min="1" max="6" data-t="cols" value="${T.cols}" ${dis} style="width:100%"></label>
            <label class="f"><span>並び順</span><select class="in" data-t="flow" ${dis}>${opt('flow', 'z', '左→右（改行して左から）')}${opt('flow', 'snake', 'S字（行ごとに折り返し）')}</select></label>
            <label class="f"><span>写真の位置</span><select class="in" data-t="imgPos" ${dis}>${opt('imgPos', 'above', '文章の上')}${opt('imgPos', 'below', '文章の下')}${opt('imgPos', 'left', '文章の左')}</select></label>
            <label class="f"><span>写真の大きさ</span><select class="in" data-t="imgSize" ${dis}>${opt('imgSize', 's', '小')}${opt('imgSize', 'm', '中')}${opt('imgSize', 'l', '大')}</select></label>
            <label class="f"><span>注意の出し方</span><select class="in" data-t="notesPos" ${dis}>${opt('notesPos', 'inline', '各手順の中')}${opt('notesPos', 'side', '右側の注意事項欄にまとめる')}${opt('notesPos', 'both', '両方')}</select></label>
            <div>
              <label class="row" style="font-size:13px;gap:6px;margin-top:18px"><input type="checkbox" data-t="arrows" ${T.arrows ? 'checked' : ''} ${dis}> 手順間に矢印</label>
              <label class="row" style="font-size:13px;gap:6px;margin-top:4px"><input type="checkbox" data-t="showTime" ${T.showTime ? 'checked' : ''} ${dis}> 動画の時刻を表示</label>
            </div>
          </div>
        </div>
        <div class="sec"><h3>ヘッダーに出す項目</h3>
          <div class="chkgrid">${HEADER_KEYS.map(k => `<label><input type="checkbox" data-h="${k}" ${T.header.includes(k) ? 'checked' : ''} ${dis}> ${LBL.ja[k]}</label>`).join('')}</div>
          <p class="hint" style="margin:6px 0 0">「タイトル」を入れると、タイトルは表の中に入り、大見出しは「文書の見出し」になります。</p>
        </div>
        <div class="sec"><h3>載せる欄と順番</h3>
          <ul class="seclist">${T.sections.map(([k, v], i) => `<li><label class="grow"><input type="checkbox" data-s="${k}" ${v ? 'checked' : ''} ${dis}> ${SECTION_NAMES[k]}</label><button class="btn sm ghost" data-su="${i}" ${dis || (i ? '' : 'disabled')}>↑</button><button class="btn sm ghost" data-sd="${i}" ${dis || (i < T.sections.length - 1 ? '' : 'disabled')}>↓</button></li>`).join('')}</ul>
          <label class="row" style="font-size:13px;gap:6px;margin-top:8px"><input type="checkbox" data-t="footerRow" ${T.footerRow ? 'checked' : ''} ${dis}> 工具・材料／改訂履歴／承認欄を横一列に並べる</label>
          <label class="f" style="margin-top:10px"><span>承認欄の項目（左から、カンマ区切り）</span><input class="in" data-t="sign" value="${esc(T.sign)}" ${dis}></label>
          <label class="row" style="font-size:13px;gap:6px"><input type="checkbox" data-t="signReverse" ${T.signReverse ? 'checked' : ''} ${dis}> 右から左へ並べる（作成を右端に）</label>
        </div>
        ${T.builtin ? '' : `<div class="sec row"><button class="btn sm" id="tDel" style="color:var(--red);margin-left:auto">このフォーマットを削除</button></div>`}
      </div>
      <div class="tpl-prev">
        <div class="row" style="margin-bottom:8px"><span class="muted" style="font-size:12px">プレビューに使うマニュアル</span><select class="in" id="tPrev" style="width:auto;max-width:260px">${PROJECTS.map(x => `<option value="${x.id}" ${x.id === prevId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></div>
        <div class="doc-fit"><div class="doc" id="doc"><div class="empty">組み立てています…</div></div></div>
      </div>
    </div>`;
  let seq = 0;
  const preview = async () => {
    const p = PROJECTS.find(x => x.id === prevId); if (!p) return;
    const my = ++seq; const imgs = await stepImages(p, true); if (my !== seq) return;
    renderDoc($('#doc'), p, imgs, T); fitDoc($('#doc'));
  };
  const upd = (redraw) => { saveTemplates(); preview(); if (redraw) viewTemplates(T.id); };
  $$('[data-tid]').forEach(li => li.onclick = () => { location.hash = `#/templates/${li.dataset.tid}`; });
  $('#tPrev').onchange = e => { prevId = viewTemplates.prev = e.target.value; preview(); };
  $('#tDup').onclick = () => {
    const c = { ...structuredClone(T), id: 't_' + uid(), builtin: false, name: T.name.replace(/（コピー.*$/, '') + '（コピー）' };
    CUSTOM_TEMPLATES.push(c); saveTemplates(); location.hash = `#/templates/${c.id}`; toast('複製しました。自由に変更できます');
  };
  if (T.builtin) { const ro = new ResizeObserver(() => fitDoc($('#doc'))); ro.observe($('.tpl-prev')); cleanup = () => ro.disconnect(); return preview(); }
  $$('[data-t]').forEach(el => {
    const k = el.dataset.t;
    el.addEventListener(el.type === 'text' ? 'input' : 'change', () => {
      T[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
      if (k === 'cols') el.previousElementSibling.textContent = '列数 ' + T.cols;
      if (k === 'name') { $(`[data-tid="${T.id}"] .grow`).textContent = T.name; }
      upd(false);
    });
    if (el.type === 'range') el.addEventListener('input', () => { T.cols = +el.value; el.previousElementSibling.textContent = '列数 ' + T.cols; upd(false); });
  });
  $$('[data-tc]').forEach(b => b.onclick = () => { T.color = b.dataset.tc; $$('[data-tc]').forEach(x => x.classList.toggle('on', x === b)); upd(false); });
  $$('[data-h]').forEach(cb => cb.onchange = () => { T.header = HEADER_KEYS.filter(k => $(`[data-h="${k}"]`).checked); upd(false); });
  $$('[data-s]').forEach(cb => cb.onchange = () => { T.sections.find(s => s[0] === cb.dataset.s)[1] = cb.checked ? 1 : 0; upd(false); });
  const mv = (i, d) => { const a = T.sections; [a[i], a[i + d]] = [a[i + d], a[i]]; upd(true); };
  $$('[data-su]').forEach(b => b.onclick = () => mv(+b.dataset.su, -1));
  $$('[data-sd]').forEach(b => b.onclick = () => mv(+b.dataset.sd, 1));
  $('#tDel').onclick = () => {
    if (!confirm(`フォーマット「${T.name}」を削除しますか？使っているマニュアルは標準フォーマットに戻ります。`)) return;
    CUSTOM_TEMPLATES = CUSTOM_TEMPLATES.filter(x => x !== T);
    PROJECTS.filter(p => p.template === T.id).forEach(p => { p.template = 'std'; touch(p); });
    saveTemplates(); location.hash = '#/templates/wi';
  };
  const ro = new ResizeObserver(() => fitDoc($('#doc'))); ro.observe($('.tpl-prev')); cleanup = () => ro.disconnect();
  preview();
}

async function exportVideo(p) {
  const url = await videoURL(p);
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
  if (!mime) { toast('このブラウザは動画の書き出しに対応していません'); return; }
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal"><h2><span class="rec-dot"></span> 注釈入り動画を書き出し中</h2><p class="hint">動画を最初から再生しながら録画しています（実時間かかります）。このまま待ってください。</p><div class="bar"><i id="xbar"></i></div><p class="mono hint" id="xt"></p><div class="row" style="justify-content:flex-end"><button class="btn" id="xcancel">中止</button></div></div>`;
  document.body.appendChild(bg);
  const v = document.createElement('video'); v.src = url; v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
  await new Promise(r => { v.onloadeddata = r; v.onerror = r; });
  const W = Math.min(1280, v.videoWidth || 960), H = Math.round(W * p.vh / VW);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const src = document.createElement('canvas'); src.width = W; src.height = H; const sg = src.getContext('2d');
  await Promise.all(Object.values(p.images).map(loadImg));
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 4e6 }); const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  let stop = false, busy = false;
  const frame = async () => {
    if (stop) return;
    if (!busy) {
      busy = true; sg.drawImage(v, 0, 0, W, H); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(src, 0, 0); const s = W / VW; g.scale(s, s);
      await drawOverlaysCanvas(g, p, v.currentTime, src, s); busy = false;
      $('#xbar', bg).style.width = (v.currentTime / p.duration * 100) + '%'; $('#xt', bg).textContent = `${fmt(v.currentTime)} / ${fmt(p.duration)}`;
    }
    requestAnimationFrame(frame);
  };
  rec.onstop = () => {
    bg.remove(); if (!chunks.length) return;
    const ext = mime.includes('mp4') ? 'mp4' : 'webm'; const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${p.docNo || 'manual'}_注釈入り.${ext}`; a.click();
    toast(`注釈入り動画（${ext}・${(blob.size / 1048576).toFixed(1)} MB）を保存しました`);
  };
  $('#xcancel', bg).onclick = () => { stop = true; chunks.length = 0; v.pause(); rec.stop(); };
  v.onended = () => { stop = true; setTimeout(() => rec.state !== 'inactive' && rec.stop(), 150); };
  rec.start(200); await v.play(); frame();
}

/* ===== 文書情報・履歴 ===== */
function tabInfo(p) {
  const f = (k, l, ph = '') => `<label class="f"><span>${l}</span><input class="in" data-k="${k}" value="${esc(p[k])}" placeholder="${ph}"></label>`;
  const ta = (k, l, v, ph, rows = 4) => `<label class="f"><span>${l}</span><textarea class="in mono-ish" data-l="${k}" rows="${rows}" placeholder="${ph}">${esc(v)}</textarea></label>`;
  $('#tabBody').innerHTML = `<div class="grid2"><div style="display:flex;flex-direction:column;gap:14px"><div class="card pad"><h2>文書情報</h2>
    <div class="fgrid">${f('equipment', '設備名・型式')}${f('process', '工程')}${f('line', 'ライン / 場所')}${f('docNo', '文書番号')}${f('version', '版')}${f('target', '対象者')}${f('author', '作成部署')}${f('ppe', '必要な保護具（カンマ区切り）')}</div>
    <div class="hint">元動画：${esc(p.videoName || '（未登録）')} ${p.videoKey ? `・ ${fmtS(p.duration)} ・ ${p.width}×${p.height}` : ''}</div></div>
    <div class="card pad"><h2>手順書に載せる内容</h2><p class="hint" style="margin-top:-6px">出力フォーマットで表示する欄を選べます。1行に1件ずつ入力します。</p>
      ${ta('specs', '仕様表（「項目: 値」）', p.specs.map(r => r.join(': ')).join('\n'), '例）巻線回数: 900Ts', 4)}
      <div class="fgrid">${ta('tools', '工具・治具', p.tools.join('\n'), '例）トルクレンチ', 4)}${ta('materials', '使用材料', p.materials.join('\n'), '例）絶縁テープ W=17.5mm', 4)}</div>
      ${ta('forms', '関連帳票（「帳票名 | 記入頻度」）', p.forms.map(r => r.join(' | ')).join('\n'), '例）設備始業点検表 | 始業前', 3)}
      ${ta('notes', '注意事項（全体）', p.notes, '例）機械が完全に停止するまで扉を開けない', 3)}
      ${ta('revisions', '改訂履歴（「版 | 内容 | 日付」）', p.revisions.map(r => r.join(' | ')).join('\n'), '例）1.0 | 初版発行 | 2026-06-02', 3)}
    </div></div>
    <div class="card pad"><h2>変更履歴</h2><table class="t"><tbody>${[...p.history].reverse().map(h => `<tr><td class="mono" style="font-size:12px;white-space:nowrap">${esc(h.at)}</td><td>${esc(h.what)}<div class="muted" style="font-size:11px">${esc(h.who)}</div></td></tr>`).join('')}</tbody></table></div></div>`;
  $$('[data-k]').forEach(i => i.oninput = () => { p[i.dataset.k] = i.value; touch(p); });
  const lines = v => v.split('\n').map(x => x.trim()).filter(Boolean);
  const parse = { specs: v => lines(v).map(l => { const m = l.split(/[:：]/); return [m[0].trim(), m.slice(1).join(':').trim()]; }), tools: lines, materials: lines, notes: v => v,
    forms: v => lines(v).map(l => { const m = l.split('|'); return [m[0].trim(), (m[1] || '').trim()]; }),
    revisions: v => lines(v).map(l => { const m = l.split('|').map(x => x.trim()); return [m[0] || '', m[1] || '', m[2] || '']; }) };
  $$('[data-l]').forEach(i => i.oninput = () => { p[i.dataset.l] = parse[i.dataset.l](i.value); touch(p); });
}
function sampleExtras() {
  return {
    template: 'wi',
    specs: [['機械型式', 'MC-200'], ['主軸回転数', 'S=1200 min⁻¹'], ['運転モード', 'AUTO'], ['起動条件', '扉CLOSE・E-STOP解除'], ['所要時間', '約1分']],
    tools: ['保護メガネ', '安全靴', '作業手袋', 'ウエス'],
    materials: ['加工プログラム O1200', 'ワーク（素材）'],
    forms: [['設備始業点検表', '始業前'], ['加工条件記録表', '段取り替え時'], ['不具合連絡票', '発生時']],
    notes: '機械が完全に停止するまで、扉を開けない。\n異常があれば直ちに非常停止を押し、班長へ連絡する。\n機械の上に工具や部品を置かない。',
    revisions: [['1.0', '初版発行', '2026-06-02'], ['1.1', '非常停止解除前の周囲確認を追加', '2026-08-18'], ['1.2', '扉の注意事項を「危険」に変更', '2026-09-26']],
  };
}
function normalizeProject(p) {
  p.template ??= 'std'; p.specs ??= []; p.tools ??= []; p.materials ??= []; p.forms ??= []; p.notes ??= '';
  p.revisions ??= [[p.version, '初版発行', p.createdAt]];
  return p;
}

/* ---------- 起動 ---------- */
(async function init() {
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  try {
    const s = await DB.kvGet('settings'); if (s) SETTINGS = { ...SETTINGS, ...s };
    PROJECTS = await DB.all();
    if (!PROJECTS.length && !(await DB.kvGet('seeded'))) { PROJECTS = seedProjects(); for (const p of PROJECTS) await DB.put(p); await DB.kvPut('seeded', true); await DB.kvPut('seeded-v2', true); }
    else if (!(await DB.kvGet('seeded-v2'))) {
      // 配色変更（白×青）に合わせて、同梱サンプルだけ作り直す
      const fresh = seedProjects()[0];
      for (const old of PROJECTS.filter(p => p.videoKey === 'sample')) { await DB.del(old.id); }
      PROJECTS = PROJECTS.filter(p => p.videoKey !== 'sample').concat(fresh); await DB.put(fresh); await DB.kvPut('seeded-v2', true);
    }
    for (const p of PROJECTS) { if (p.videoKey === 'sample' && !p.specs) Object.assign(p, sampleExtras()); normalizeProject(p); }
    CUSTOM_TEMPLATES = (await DB.kvGet('templates')) || [];
  } catch (e) { console.warn('IndexedDB を使えないため、保存なしで動かします', e); PROJECTS = seedProjects().map(normalizeProject); DB.put = DB.del = DB.putBlob = DB.kvPut = async () => { }; }
  window.addEventListener('hashchange', route);
  route();
})();
