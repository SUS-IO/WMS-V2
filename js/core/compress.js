// File compression done in the browser BEFORE upload, to save Supabase storage.
//  - photos : shrunk to a maximum size and re-saved as JPEG (size / quality are admin settings)
//  - PDFs   : scanned / image-heavy PDFs are re-built from low-resolution page images when that is clearly smaller;
//             otherwise the original file is kept untouched.
import { setting } from './api.js';

export const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

export async function compressImage(file) {
  const maxPx = Math.max(600, Number(setting('image_max_px', 1280)) || 1280);
  const q = Math.min(0.95, Math.max(0.3, (Number(setting('image_quality', 65)) || 65) / 100));
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', q));
  if (!blob) throw new Error('Could not process the image');
  // already small and already a JPEG: keep the original rather than making it worse
  if (k === 1 && file.type === 'image/jpeg' && file.size <= blob.size) return file;
  return blob;
}

function loadScript(src) {
  return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(el); });
}
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/';
const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

/** returns { blob, note } - blob is the original file when compression was not worthwhile */
export async function compressPdf(file, { minBytes = 500 * 1024, maxPages = 40, widthPx = 1240, quality = 0.55 } = {}) {
  if (setting('compress_pdfs', true) === false || file.size < minBytes) return { blob: file, note: '' };
  try {
    if (!window.pdfjsLib) await loadScript(PDFJS + 'pdf.min.js');
    if (!window.jspdf) await loadScript(JSPDF);
    const lib = window.pdfjsLib;
    if (!lib.GlobalWorkerOptions.workerSrc) {
      const code = await (await fetch(PDFJS + 'pdf.worker.min.js')).text();
      lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    }
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    if (pdf.numPages > maxPages) return { blob: file, note: '' };
    let doc = null;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i); const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: widthPx / v1.width });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const jpg = c.toDataURL('image/jpeg', quality);
      const w = v1.width, h = v1.height, o = w > h ? 'l' : 'p';
      if (!doc) doc = new window.jspdf.jsPDF({ orientation: o, unit: 'pt', format: [w, h], compress: true }); else doc.addPage([w, h], o);
      doc.addImage(jpg, 'JPEG', 0, 0, w, h, undefined, 'FAST');
    }
    const out = doc.output('blob');
    if (out.size < file.size * 0.8) return { blob: out, note: `compressed ${fmtSize(file.size)} → ${fmtSize(out.size)}` };
  } catch (e) { console.warn('PDF compression skipped:', e); }
  return { blob: file, note: '' };
}

export const maxPdfBytes = () => (Number(setting('max_pdf_mb', 3)) || 3) * 1048576;
