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

async function addFiles(files) {
  const list = Array.from(files || []).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(f.name));
  if (!list.length) {
    toast('没有可用的图片文件');
    return;
  }
  setLoading(true, `正在读取 0/${list.length}`);
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    setLoading(true, `正在读取 ${i + 1}/${list.length}`);
    const file = list[i];
    try {
      const src = await decodeImage(file);
      const w = src.width || src.naturalWidth;
      const h = src.height || src.naturalHeight;
      if (!w || !h) throw new Error('图片尺寸异常');
      const { blob, width, height } = await drawToBlob(src, w, h);
      if (src.close) src.close();
      state.items.push({
        id: ++state.seq,
        name: file.name,
        blob,
        width,
        height,
        thumb: URL.createObjectURL(blob),
      });
    } catch (err) {
      failed++;
    }
  }
  setLoading(false);
  render();
  if (failed) toast(`${failed} 张图片读取失败，可能是 HEIC 等不支持的格式`);
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

    pdf.save(`图片转文档-${todayTag()}.pdf`);
    toast('PDF 已生成');
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
    downloadBlob(blob, `图片转文档-${todayTag()}.docx`);
    toast('Word 已生成');
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

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
