'use strict';

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.88;

const state = {
  items: [],
  seq: 0,
};

const $ = (id) => document.getElementById(id);
const emptyEl = $('empty');
const listWrap = $('listWrap');
const gridEl = $('grid');
const countEl = $('count');
const fileInput = $('fileInput');
const pdfBtn = $('pdfBtn');
const wordBtn = $('wordBtn');
const loadingEl = $('loading');
const loadingText = $('loadingText');
const toastEl = $('toast');

function toast(msg, ms) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, ms || 2600);
}

function setLoading(on, text) {
  loadingEl.hidden = !on;
  if (text) loadingText.textContent = text;
}

function todayTag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------- 读取图片 ---------- */

function decodeImage(file) {
  return new Promise((resolve, reject) => {
    if (window.createImageBitmap) {
      createImageBitmap(file, { imageOrientation: 'from-image' })
        .then(resolve)
        .catch(() => decodeFallback(file, resolve, reject));
    } else {
      decodeFallback(file, resolve, reject);
    }
  });
}

function decodeFallback(file, resolve, reject) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    resolve(img);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('浏览器无法识别这种图片格式'));
  };
  img.src = url;
}

function drawToBlob(source, w, h) {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(source, 0, 0, cw, ch);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve({ blob, width: cw, height: ch });
      else reject(new Error('图片处理失败'));
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isImage(file) {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file.name);
}

function pushItem(name, blob, width, height) {
  state.items.push({
    id: ++state.seq,
    name,
    blob,
    width,
    height,
    thumb: URL.createObjectURL(blob),
  });
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('页面渲染失败'));
    }, 'image/jpeg', JPEG_QUALITY);
  });
}

/* 把 PDF 每一页渲染成一张 JPEG，按页序加入列表 */
async function addPdfPages(file, onPage) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('PDF 组件未加载');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  }
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (onPage) onPage(i, doc.numPages);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, MAX_EDGE / Math.max(base.width, base.height));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await canvasToJpeg(canvas);
      pushItem(`${file.name} 第${i}页`, blob, canvas.width, canvas.height);
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
  } finally {
    await doc.destroy();
  }
}

async function addFiles(files) {
  const all = Array.from(files || []);
  const targets = all.filter((f) => isPdf(f) || isImage(f));
  if (!targets.length) {
    toast('没有可用的图片或 PDF 文件');
    return;
  }

  setLoading(true, `正在读取 0/${targets.length}`);
  let failed = 0;
  let firstErr = '';

  for (let i = 0; i < targets.length; i++) {
    const file = targets[i];
    setLoading(true, `正在读取 ${i + 1}/${targets.length}`);
    try {
      if (isPdf(file)) {
        await addPdfPages(file, (page, total) => {
          setLoading(true, `正在拆分 PDF 第 ${page}/${total} 页`);
        });
      } else {
        const src = await decodeImage(file);
        const w = src.width || src.naturalWidth;
        const h = src.height || src.naturalHeight;
        if (!w || !h) throw new Error('图片尺寸异常');
        const { blob, width, height } = await drawToBlob(src, w, h);
        if (src.close) src.close();
        pushItem(file.name, blob, width, height);
      }
    } catch (err) {
      failed++;
      if (!firstErr) firstErr = err && err.message ? err.message : '';
    }
  }

  setLoading(false);
  render();

  const n = state.items.length;
  if (failed) {
    toast(`${failed} 个文件读取失败${firstErr ? '：' + firstErr : ''}`, 3200);
  } else if (n) {
    toast(`已导入，共 ${n} 页`);
  }
}

/* ---------- 渲染 ---------- */

function render() {
  const n = state.items.length;
  const empty = n === 0;
  emptyEl.hidden = !empty;
  listWrap.hidden = empty;
  pdfBtn.disabled = empty;
  wordBtn.disabled = empty;
  countEl.textContent = empty ? '' : `共 ${n} 张 · 占用 ${formatSize(state.items.reduce((s, it) => s + it.blob.size, 0))}`;

  gridEl.innerHTML = '';
  state.items.forEach((it, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb">
        <img src="${it.thumb}" alt="${idx + 1}">
        <span class="no">${idx + 1}</span>
        <button class="del" data-act="del" aria-label="删除">×</button>
      </div>
      <div class="ops">
        <button data-act="up" ${idx === 0 ? 'disabled' : ''} aria-label="上移">↑</button>
        <button data-act="down" ${idx === n - 1 ? 'disabled' : ''} aria-label="下移">↓</button>
      </div>`;
    card.dataset.id = it.id;
    card.dataset.name = it.name;
    gridEl.appendChild(card);
  });
}

function moveItem(id, dir) {
  const i = state.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= state.items.length) return;
  const [item] = state.items.splice(i, 1);
  state.items.splice(j, 0, item);
  render();
}

function removeItem(id) {
  const i = state.items.findIndex((x) => x.id === id);
  if (i < 0) return;
  URL.revokeObjectURL(state.items[i].thumb);
  state.items.splice(i, 1);
  render();
}

/* ---------- 导出 PDF ---------- */

function blobToArrayBuffer(blob) {
  return blob.arrayBuffer();
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function exportPdf() {
  const jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!jsPDFCtor) { toast('PDF 组件未加载'); return; }
  if (!state.items.length) return;

  setLoading(true, '正在生成 PDF…');
  try {
    const pdf = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageW = 210;
    const pageH = 297;
    const margin = 10;
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2;

    for (let i = 0; i < state.items.length; i++) {
      const it = state.items[i];
      if (i > 0) pdf.addPage();
      const dataUrl = await blobToDataURL(it.blob);
      const ratio = Math.min(availW / it.width, availH / it.height);
      const w = it.width * ratio;
      const h = it.height * ratio;
      const x = (pageW - w) / 2;
      const y = (pageH - h) / 2;
      pdf.addImage(dataUrl, 'JPEG', x, y, w, h, undefined, 'FAST');
    }

    const outBlob = pdf.output('blob');
    const name = `图片转文档-${todayTag()}.pdf`;
    const how = await deliverBlob(outBlob, name, 'application/pdf');
    if (how === 'shared') toast('已发送，本地未留文件');
    else if (how === 'cancelled') toast('已取消，未保存任何文件');
    else if (how === 'wechat-ios') toast('已生成。若没弹出保存，请点右上角「…」→ 在浏览器中打开', 5200);
    else toast('已保存到下载目录');
  } catch (err) {
    toast('生成 PDF 失败：' + (err && err.message ? err.message : '未知错误'));
  } finally {
    setLoading(false);
  }
}

/* ---------- 导出 Word ---------- */

async function exportWord() {
  const D = window.docx;
  if (!D) { toast('Word 组件未加载'); return; }
  if (!state.items.length) return;

  setLoading(true, '正在生成 Word…');
  try {
    const onePage = $('onePage').checked;
    const A4_W = 11906;
    const A4_H = 16838;
    const margin = 720;
    const contentW = (A4_W - margin * 2) / 15;
    const contentH = (A4_H - margin * 2) / 15;

    const children = [];
    for (let i = 0; i < state.items.length; i++) {
      const it = state.items[i];
      const buf = await blobToArrayBuffer(it.blob);
      const ratio = Math.min(contentW / it.width, contentH / it.height, 1);
      const w = Math.round(it.width * ratio);
      const h = Math.round(it.height * ratio);

      if (i > 0 && onePage) {
        children.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      }
      children.push(new D.Paragraph({
        alignment: D.AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new D.ImageRun({ type: 'jpg', data: buf, transformation: { width: w, height: h } })],
      }));
    }

    const doc = new D.Document({
      sections: [{
        properties: {
          page: {
            size: { width: A4_W, height: A4_H },
            margin: { top: margin, right: margin, bottom: margin, left: margin },
          },
        },
        children,
      }],
    });

    const blob = await D.Packer.toBlob(doc);
    const name = `图片转文档-${todayTag()}.docx`;
    const how = await deliverBlob(blob, name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (how === 'shared') toast('已发送，本地未留文件');
    else if (how === 'cancelled') toast('已取消，未保存任何文件');
    else if (how === 'wechat-ios') toast('已生成。若没弹出保存，请点右上角「…」→ 在浏览器中打开', 5200);
    else toast('已保存到下载目录');
  } catch (err) {
    toast('生成 Word 失败：' + (err && err.message ? err.message : '未知错误'));
  } finally {
    setLoading(false);
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1200);
}

function isWeChat() {
  return /MicroMessenger/i.test(navigator.userAgent);
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* 交付方式：触屏且支持文件分享时，直接交给系统分享面板，不落地；
   否则回退为下载。返回 shared / downloaded / cancelled / wechat-ios。
   微信内置浏览器会接管 Web Share，弹出的是微信转发面板而非系统面板，
   存不了文件，所以在微信里一律走下载。 */
async function deliverBlob(blob, filename, mime) {
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const wx = isWeChat();
  if (!wx && touch && navigator.canShare && typeof File === 'function') {
    try {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      /* 其他错误（激活过期、浏览器限制）回退下载 */
    }
  }
  downloadBlob(blob, filename);
  /* iOS 微信内置浏览器不支持下载，静默失败，需要引导用户去外部浏览器 */
  return wx && isIOS() ? 'wechat-ios' : 'downloaded';
}

/* ---------- 事件 ---------- */

emptyEl.addEventListener('click', () => fileInput.click());
emptyEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
$('addTop').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  await addFiles(files);
});

gridEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  if (!card) return;
  const id = Number(card.dataset.id);
  if (btn.dataset.act === 'del') removeItem(id);
  else if (btn.dataset.act === 'up') moveItem(id, -1);
  else if (btn.dataset.act === 'down') moveItem(id, 1);
});

function releaseAll() {
  state.items.forEach((it) => URL.revokeObjectURL(it.thumb));
  state.items = [];
}

const clearBtn = $('clearAll');
let clearArmed = 0;

clearBtn.addEventListener('click', () => {
  if (!state.items.length) return;
  if (Date.now() > clearArmed) {
    clearArmed = Date.now() + 3000;
    clearBtn.textContent = '再点一次清空';
    clearBtn.classList.add('danger');
    setTimeout(() => {
      if (Date.now() >= clearArmed) {
        clearArmed = 0;
        clearBtn.textContent = '清理全部';
        clearBtn.classList.remove('danger');
      }
    }, 3000);
    return;
  }
  clearArmed = 0;
  clearBtn.textContent = '清理全部';
  clearBtn.classList.remove('danger');
  releaseAll();
  render();
  toast('已清理，占用已释放');
});

window.addEventListener('pagehide', releaseAll);

pdfBtn.addEventListener('click', exportPdf);
wordBtn.addEventListener('click', exportWord);

document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    addFiles(e.dataTransfer.files);
  }
});

render();

if (isWeChat()) {
  const tip = $('wxTip');
  const close = $('wxTipClose');
  if (tip) {
    tip.hidden = false;
    if (close) close.addEventListener('click', () => { tip.hidden = true; });
  }
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
