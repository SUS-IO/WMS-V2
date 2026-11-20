// Reports: download MRF, Delivery Challan, Returns and Job Card reports as Excel-ready CSV files.
// Admin & Viewer: all locations (optional workshop / store filter). Other users: only their own workshop / store (also enforced by the database).
import { sb, fetchAll, isWs, isStore, seesAll, myWorkshopId, myStoreId, wsName, storeName, productById, vehicleById, employeeById, userName, companyName, workshopOptions, storeOptions } from '../core/api.js';
import { h, pageHead, card, btn, field, inp, act, toast } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { fmtDateTime, toDateInput, downloadFile, toCSV, round } from '../core/format.js';

const dt = (v) => (v ? fmtDateTime(v) : '');
const yn = (v) => (v ? 'Yes' : 'No');
const P = (id) => productById(id) || {};

export async function render() {
  const root = h('div');
  const from = inp({ type: 'date', value: toDateInput(new Date(Date.now() - 30 * 86400000)) });
  const to = inp({ type: 'date', value: toDateInput(new Date()) });
  const ws = seesAll() ? selectBox({ options: workshopOptions(false), value: null, placeholder: 'All workshops' }) : null;
  const st = seesAll() ? selectBox({ options: storeOptions(false), value: null, placeholder: 'All stores' }) : null;
  const jtype = selectBox({ options: [{ value: 'job_card', label: 'Job Cards' }, { value: 'outsourcing', label: 'Outsourcing Job Cards' }, { value: 'consumable', label: 'Consumable Job Cards' }, { value: 'facility', label: 'Facility Job Cards' }], value: null, placeholder: 'All job card types' });
  const range = () => {
    if (!from.value || !to.value) throw new Error('Choose the From and To dates');
    const a = new Date(from.value + 'T00:00:00'); const b = new Date(to.value + 'T23:59:59.999');
    if (b < a) throw new Error('The To date is before the From date');
    return [a.toISOString(), b.toISOString()];
  };
  // limit to the user's own workshop / store (the database enforces this as well)
  const scope = (q, wsCol, stCol) => {
    if (isWs() && wsCol) q = q.eq(wsCol, myWorkshopId());
    if (isStore() && stCol) q = q.eq(stCol, myStoreId());
    if (seesAll()) { if (ws?.getValue() && wsCol) q = q.eq(wsCol, ws.getValue()); if (st?.getValue() && stCol) q = q.eq(stCol, st.getValue()); }
    return q;
  };
  const save = (name, rows, header) => {
    if (!rows.length) { toast('No records in this date range', 'warn'); return; }
    downloadFile(`${name}-${from.value}_to_${to.value}.csv`, toCSV([header, ...rows]));
    toast(`${rows.length} row${rows.length === 1 ? '' : 's'} downloaded`);
  };
  const vehOf = (id) => vehicleById(id)?.reg_no || '';

  /* ---------------- MRF ---------------- */
  async function mrfReport() {
    const [a, b] = range();
    const data = await fetchAll(() => scope(sb.from('mrfs').select('*, job_cards(jc_no,vehicle_id), mrf_lines(*)').not('sent_at', 'is', null).gte('sent_at', a).lte('sent_at', b).order('sent_at'), 'workshop_id', 'store_id'));
    const rows = [];
    data.forEach((m) => {
      const base = [m.mrf_no, m.mrf_type === 'facility' ? 'Facility MRF' : m.mrf_type === 'outsourcing' ? 'Outsourcing request' : 'Job card MRF', wsName(m.workshop_id), storeName(m.store_id), m.company_id ? companyName(m.company_id) : '', m.job_cards?.jc_no || '', vehOf(m.job_cards?.vehicle_id), m.status, m.revision, userName(m.created_by), dt(m.sent_at), userName(m.sent_by)];
      const ls = (m.mrf_lines || []).slice().sort((x, y) => x.line_no - y.line_no);
      if (!ls.length) rows.push([...base, '', '', '', '', '', '', m.remarks || '', m.return_reason || '', m.close_reason || '']);
      ls.forEach((l) => rows.push([...base, l.line_no, l.item_text, l.qty, l.unit || '', l.store_status, l.store_note || '', m.remarks || '', m.return_reason || '', m.close_reason || '']));
    });
    save('MRF-report', rows, ['MRF No', 'Type', 'Workshop', 'Store', 'Company', 'Job card', 'Vehicle', 'MRF status', 'Revision', 'Raised by', 'Sent to store at', 'Sent by', 'Line', 'Requested item', 'Requested qty', 'Unit', 'Line status', 'Store note', 'MRF remarks', 'Return reason', 'Close reason']);
  }

  /* ---------------- DC ---------------- */
  async function dcReport() {
    const [a, b] = range();
    const data = await fetchAll(() => scope(sb.from('delivery_challans').select('*, job_cards(jc_no,vehicle_id), mrfs(mrf_no, mrf_lines(*)), dc_lines(*)').not('issued_at', 'is', null).gte('issued_at', a).lte('issued_at', b).order('issued_at'), 'workshop_id', 'store_id'));
    const rows = [];
    data.forEach((d) => {
      const base = [d.dc_no, storeName(d.store_id), wsName(d.workshop_id), d.company_id ? companyName(d.company_id) : '', d.mrfs?.mrf_no || '', d.job_cards?.jc_no || '', vehOf(d.job_cards?.vehicle_id), d.status, dt(d.issued_at), userName(d.issued_by)];
      (d.dc_lines || []).slice().sort((x, y) => x.line_no - y.line_no).forEach((l) => {
        const p = P(l.product_id); const ml = (d.mrfs?.mrf_lines || []).find((x) => x.id === l.mrf_line_id);
        rows.push([...base, l.line_no, ml?.item_text || '', ml ? ml.qty : '', ml?.unit || '', p.item_code || '', p.description || '', l.qty, (l.loose ? p.base_uom : p.uom) || '', yn(l.loose), l.base_qty, p.base_uom || '', l.rate, l.amount,
          l.ack_status === 'acknowledged' ? 'Acknowledged' : 'Pending', l.ack_consume, l.ack_stock, l.ack_return, dt(l.acked_at), d.reverse_reason || '', d.remarks || '']);
      });
    });
    save('DC-report', rows, ['DC No', 'Store', 'Workshop', 'Company', 'MRF No', 'Job card', 'Vehicle', 'DC status', 'Sent to workshop at', 'Issued by', 'Line', 'Requested item', 'Requested qty', 'Requested unit', 'Item code', 'Issued item', 'Issued qty', 'Issued unit', 'Loose', 'Qty in base unit', 'Base unit', 'Rate', 'Amount', 'Receipt status', 'Consumed on job card', 'Kept in workshop stock', 'Sent to return queue', 'Acknowledged at', 'Reverse reason', 'DC remarks']);
  }

  /* ---------------- Returns ---------------- */
  async function returnReport() {
    const [a, b] = range();
    const data = await fetchAll(() => scope(sb.from('return_dcs').select('*, return_dc_lines(*)').not('sent_at', 'is', null).gte('sent_at', a).lte('sent_at', b).order('sent_at'), 'workshop_id', 'store_id'));
    const rows = [];
    data.forEach((r) => {
      const base = [r.rdc_no, wsName(r.workshop_id), storeName(r.store_id), r.status, dt(r.sent_at), userName(r.sent_by), dt(r.reviewed_at), userName(r.reviewed_by)];
      (r.return_dc_lines || []).slice().sort((x, y) => x.line_no - y.line_no).forEach((l) => {
        const p = P(l.product_id);
        rows.push([...base, l.line_no, p.item_code || '', p.description || '', l.base_qty, p.base_uom || '', l.rate, round(l.base_qty * l.rate, 2), l.reason || '', l.store_status, l.store_note || '', l.store_status === 'rejected' ? yn(l.ws_accepted_back) : '', r.remarks || '']);
      });
    });
    save('Returns-report', rows, ['Return DC No', 'Workshop', 'Store', 'Status', 'Sent to store at', 'Sent by', 'Reviewed at', 'Reviewed by', 'Line', 'Item code', 'Item', 'Qty (base unit)', 'Unit', 'Rate', 'Value', 'Return reason', 'Store decision', 'Store note', 'Rejected item taken back by workshop', 'Remarks']);
  }

  /* ---------------- Job cards (all types) ---------------- */
  async function loadCards() {
    const [a, b] = range(); const t = jtype.getValue(); const out = [];
    if (!t || t === 'job_card' || t === 'outsourcing') {
      const d = await fetchAll(() => { let q = scope(sb.from('job_cards').select('*, jc_spares(*), jc_manhours(*)').gte('created_at', a).lte('created_at', b).order('created_at'), 'workshop_id', null); if (t) q = q.eq('jc_type', t === 'outsourcing' ? 'outsourcing' : 'regular'); return q; });
      d.forEach((j) => out.push({ kind: 'job_card', type: j.jc_type === 'outsourcing' ? 'Outsourcing Job Card' : 'Job Card', no: j.jc_no || '(draft)', ws: j.workshop_id, status: j.status, veh: vehOf(j.vehicle_id), j, spares: (j.jc_spares || []).map((s) => ({ ...s, voided: s.voided })), mh: j.jc_manhours || [] }));
    }
    if (!t || t === 'consumable' || t === 'facility') {
      const d = await fetchAll(() => { let q = scope(sb.from('consumable_jcs').select('*, cjc_vehicles(*), cjc_spares(*), cjc_manhours(*)').gte('created_at', a).lte('created_at', b).order('created_at'), 'workshop_id', null); if (t) q = q.eq('card_type', t); return q; });
      d.forEach((c) => out.push({ kind: 'consumable', type: c.card_type === 'facility' ? 'Facility Job Card' : 'Consumable Job Card', no: c.cjc_no || '(draft)', ws: c.workshop_id, status: c.status, veh: (c.cjc_vehicles || []).map((v) => vehOf(v.vehicle_id)).join(', '),
        j: c, spares: (c.cjc_spares || []).map((s) => ({ ...s, veh: vehOf((c.cjc_vehicles || []).find((v) => v.id === s.cjc_vehicle_id)?.vehicle_id) })), mh: c.cjc_manhours || [] }));
    }
    return out;
  }
  const hdr = (c) => [c.no, c.type, wsName(c.ws), c.status, c.veh, dt(c.j.created_at)];
  const HDR = ['Card No', 'Card type', 'Workshop', 'Status', 'Vehicle', 'Created at'];
  const hours = (m) => round((new Date(m.end_ts) - new Date(m.start_ts)) / 3600000, 2);

  async function jcSummary() {
    const cards = await loadCards();
    const rows = cards.map((c) => { const j = c.j; const sp = c.spares.filter((s) => !s.voided); const mh = c.mh.filter((m) => !m.voided);
      return [...hdr(c), userName(j.created_by), dt(j.opened_at), dt(j.completed_at), dt(j.finalized_at), j.odometer ?? '', j.engine_hour ?? '', j.aux_hour ?? '', j.complaint_type || '', j.complaint || j.remarks || '', j.cause || '', j.corrective || '',
        sp.length, round(sp.reduce((x, s) => x + Number(s.amount), 0), 2), mh.length, round(mh.reduce((x, m) => x + hours(m), 0), 2)]; });
    save('JobCards-summary', rows, [...HDR, 'Created by', 'Created/Opened on', 'Completed at', 'Finalized at', 'Odometer', 'Engine hour', 'Aux hour', 'Complaint type', 'Complaint / Remarks', 'Cause', 'Corrective action', 'Spare lines', 'Spares value', 'Man-hour entries', 'Man-hours (total)']);
  }
  async function jcSpares() {
    const cards = await loadCards(); const rows = [];
    cards.forEach((c) => c.spares.forEach((s) => { const p = P(s.product_id); rows.push([...hdr(c), c.kind === 'job_card' ? c.veh : (s.veh || ''), p.item_code || '', p.description || '', p.spare_type || '', s.qty, p.base_uom || '', s.rate, s.amount, s.source === 'dc' ? 'From delivery challan' : 'Workshop stock', yn(s.voided), s.void_reason || '', s.note || '', dt(s.created_at)]); }));
    save('JobCards-spares', rows, [...HDR, 'Vehicle (spare for)', 'Item code', 'Spare', 'Spare type', 'Qty', 'Unit', 'Rate', 'Amount', 'Source', 'Voided', 'Void reason', 'Note', 'Added at']);
  }
  async function jcManhours() {
    const cards = await loadCards(); const rows = [];
    cards.forEach((c) => c.mh.forEach((m) => { const e = employeeById(m.employee_id) || {}; rows.push([...hdr(c), e.emp_code || '', e.name || '', dt(m.start_ts), dt(m.end_ts), hours(m), m.note || '', yn(m.voided), m.void_reason || '']); }));
    save('JobCards-manhours', rows, [...HDR, 'Employee code', 'Employee', 'Start', 'End', 'Hours', 'Note', 'Voided', 'Void reason']);
  }

  /* ---------------- ZIP of images / PDFs, one folder per job card ---------------- */
  const safe = (x) => String(x || 'unknown').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'unknown';
  const loadZipLib = () => (window.JSZip ? Promise.resolve() : new Promise((res, rej) => { const el = document.createElement('script'); el.src = 'js/vendor/jszip.min.js'; el.onload = res; el.onerror = () => rej(new Error('Could not load the ZIP library')); document.head.appendChild(el); }));
  const zipStatus = h('div', { class: 'small muted' });
  async function docsZip() {
    zipStatus.textContent = 'Finding job cards...';
    const cards = await loadCards();
    if (!cards.length) { zipStatus.textContent = ''; toast('No job cards in this date range', 'warn'); return; }
    const byId = new Map(cards.map((c) => [c.j.id, c])); const atts = [];
    for (const kind of ['job_card', 'consumable']) {
      const ids = cards.filter((c) => c.kind === kind).map((c) => c.j.id);
      for (let i = 0; i < ids.length; i += 100) {
        const d = await fetchAll(() => sb.from('attachments').select('*').eq('card_kind', kind).in('card_id', ids.slice(i, i + 100)).order('created_at'));
        atts.push(...d);
      }
    }
    if (!atts.length) { zipStatus.textContent = ''; toast('No images or PDFs found for these job cards', 'warn'); return; }
    await loadZipLib();
    const zip = new window.JSZip(); const used = new Set(); const index = [['Card No', 'Card type', 'Workshop', 'Status', 'Vehicle', 'File type', 'File name', 'Saved as (in ZIP)', 'Size KB', 'Result']];
    let done = 0, failed = 0, total = atts.length;
    const one = async (a) => {
      const c = byId.get(a.card_id); if (!c) return;
      const folder = `${safe(wsName(c.ws))}/${safe(c.type)}/${safe(c.no === '(draft)' ? 'draft-' + String(a.card_id).slice(0, 8) : c.no)}/${a.att_type === 'pdf' ? 'PDFs' : 'Images'}`;
      let name = safe(a.file_name), full = `${folder}/${name}`, n = 1;
      while (used.has(full.toLowerCase())) { const dot = name.lastIndexOf('.'); n += 1; full = `${folder}/${dot > 0 ? name.slice(0, dot) + '-' + n + name.slice(dot) : name + '-' + n}`; }
      used.add(full.toLowerCase());
      const { data, error } = await sb.storage.from('job-attachments').download(a.path);
      if (error || !data) { failed += 1; index.push([c.no, c.type, wsName(c.ws), c.status, c.veh, a.att_type, a.file_name, '', '', 'FAILED']); }
      else { zip.file(full, data); index.push([c.no, c.type, wsName(c.ws), c.status, c.veh, a.att_type, a.file_name, full, Math.round(a.size_bytes / 1024), 'OK']); }
      done += 1; zipStatus.textContent = `Downloading files ${done} / ${total}...`;
    };
    const queue = atts.slice(); const worker = async () => { while (queue.length) await one(queue.shift()); };
    await Promise.all([worker(), worker(), worker(), worker()]);
    zip.file('index.csv', '\ufeff' + toCSV(index));
    zipStatus.textContent = 'Building ZIP...';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => { zipStatus.textContent = `Building ZIP ${Math.round(m.percent)}%`; });
    const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(blob); aEl.download = `JobCard-documents-${from.value}_to_${to.value}.zip`; document.body.appendChild(aEl); aEl.click();
    setTimeout(() => { URL.revokeObjectURL(aEl.href); aEl.remove(); }, 2000);
    zipStatus.textContent = `Done: ${total - failed} file(s) from ${new Set(atts.map((a) => a.card_id)).size} job card(s)${failed ? `, ${failed} failed (see index.csv)` : ''}.`;
    toast('ZIP downloaded');
  }

  /* ---------------- complete archive: every final PDF + attachments, one folder per job card ---------------- */
  const optMrf = h('input', { type: 'checkbox', checked: true }); const optDc = h('input', { type: 'checkbox', checked: true });
  const optRet = h('input', { type: 'checkbox', checked: true }); const optJc = h('input', { type: 'checkbox', checked: true }); const optDoc = h('input', { type: 'checkbox', checked: true });
  const archStatus = h('div', { class: 'small muted' }); let cancelArch = false;
  const chk = (cb, label) => h('label', { class: 'row nowrap', style: { gap: '8px', cursor: 'pointer' } }, cb, h('span', null, label));
  const loadPdfLib = async () => { await loadZipLib(); };
  async function archiveZip() {
    if (!(optMrf.checked || optDc.checked || optRet.checked || optJc.checked || optDoc.checked)) throw new Error('Tick at least one item to include');
    cancelArch = false; const [a, b] = range(); await loadPdfLib();
    const { buildPdf } = await import('../core/print.js'); const { mrfPrintHtml } = await import('./mrf.js'); const { dcPrintHtml } = await import('./dc.js');
    const { rdcPrint } = await import('./returns.js'); const { jcPrintHtml } = await import('./jobcards.js'); const { cjcPrintHtml } = await import('./cjc.js');
    const zip = new window.JSZip(); const used = new Set(); const index = [['Folder / file in ZIP', 'Document', 'Number', 'Workshop', 'Result']]; let fail = 0;
    const put = (path, data) => { let full = path, n = 1; while (used.has(full.toLowerCase())) { n += 1; full = path.replace(/(\.[^.]*)?$/, (m) => `-${n}${m || ''}`); } used.add(full.toLowerCase()); zip.file(full, data); return full; };
    const jobs = []; // {folder, name, kind, no, ws, make: () => html} or {folder, att}
    const jcInfo = new Map(); // job card id -> {ws, type, no}
    const fold = (ws0, type, no) => `${safe(wsName(ws0))}/${safe(type)}/${safe(no)}`;
    archStatus.textContent = 'Finding documents...';
    // job cards in range (PDF + attachments)
    let cards = [];
    if (optJc.checked || optDoc.checked) cards = await loadCards();
    cards.forEach((c) => jcInfo.set(c.j.id, { ws: c.ws, type: c.type, no: c.no }));
    const cardFolder = (c) => fold(c.ws, c.type, c.no === '(draft)' ? 'draft-' + String(c.j.id).slice(0, 8) : c.no);
    if (optJc.checked) cards.forEach((c) => jobs.push({ folder: cardFolder(c), name: `${safe(c.no)}.pdf`, doc: c.type, no: c.no, ws: c.ws, html: () => (c.kind === 'job_card' ? jcPrintHtml(c.j, c.j, c.mh, c.spares) : cjcPrintHtml(c.j, c.j.cjc_vehicles || [], c.spares, c.mh)) }));
    // MRFs / DCs reference job cards that may be outside the date range
    const needJc = async (ids) => { const miss = [...new Set(ids.filter((x) => x && !jcInfo.has(x)))]; const rows = []; for (let i = 0; i < miss.length; i += 100) rows.push(...await fetchAll(() => sb.from('job_cards').select('*').in('id', miss.slice(i, i + 100)))); rows.forEach((j) => jcInfo.set(j.id, { ws: j.workshop_id, type: j.jc_type === 'outsourcing' ? 'Outsourcing Job Card' : 'Job Card', no: j.jc_no || 'draft-' + String(j.id).slice(0, 8), row: j })); };
    const jcFolder = (id, ws0, sub) => { const i = jcInfo.get(id); return i ? `${fold(i.ws, i.type, i.no)}/${sub}` : `${safe(wsName(ws0))}/Facility (no job card)/${sub}`; };
    if (optMrf.checked) {
      const d = await fetchAll(() => scope(sb.from('mrfs').select('*, mrf_lines(*)').not('sent_at', 'is', null).gte('sent_at', a).lte('sent_at', b).order('sent_at'), 'workshop_id', 'store_id'));
      await needJc(d.map((m) => m.job_card_id));
      d.forEach((m) => jobs.push({ folder: jcFolder(m.job_card_id, m.workshop_id, 'MRFs'), name: `${safe(m.mrf_no)}.pdf`, doc: 'MRF', no: m.mrf_no, ws: m.workshop_id, html: () => mrfPrintHtml(m, (m.mrf_lines || []).slice().sort((x, y) => x.line_no - y.line_no), jcInfo.get(m.job_card_id)?.row || cards.find((c) => c.j.id === m.job_card_id)?.j) }));
    }
    if (optDc.checked) {
      const d = await fetchAll(() => scope(sb.from('delivery_challans').select('*, dc_lines(*), mrfs(*)').not('issued_at', 'is', null).gte('issued_at', a).lte('issued_at', b).order('issued_at'), 'workshop_id', 'store_id'));
      await needJc(d.map((x) => x.job_card_id));
      d.forEach((x) => jobs.push({ folder: jcFolder(x.job_card_id, x.workshop_id, 'Delivery Challans'), name: `${safe(x.dc_no)}.pdf`, doc: 'Delivery Challan', no: x.dc_no, ws: x.workshop_id, html: () => dcPrintHtml(x, (x.dc_lines || []).slice().sort((p, q) => p.line_no - q.line_no), x.mrfs, jcInfo.get(x.job_card_id)?.row || cards.find((c) => c.j.id === x.job_card_id)?.j) }));
    }
    if (optRet.checked) {
      const d = await fetchAll(() => scope(sb.from('return_dcs').select('*, return_dc_lines(*)').not('sent_at', 'is', null).gte('sent_at', a).lte('sent_at', b).order('sent_at'), 'workshop_id', 'store_id'));
      d.forEach((r) => jobs.push({ folder: `${safe(wsName(r.workshop_id))}/Returns`, name: `${safe(r.rdc_no)}.pdf`, doc: 'Return DC', no: r.rdc_no, ws: r.workshop_id, html: () => rdcPrint(r, (r.return_dc_lines || []).slice().sort((p, q) => p.line_no - q.line_no)) }));
    }
    // attachments
    const atts = [];
    if (optDoc.checked) for (const kind of ['job_card', 'consumable']) {
      const ids = cards.filter((c) => c.kind === kind).map((c) => c.j.id);
      for (let i = 0; i < ids.length; i += 100) atts.push(...await fetchAll(() => sb.from('attachments').select('*').eq('card_kind', kind).in('card_id', ids.slice(i, i + 100)).order('created_at')));
    }
    const total = jobs.length + atts.length; if (!total) { archStatus.textContent = ''; toast('Nothing found in this date range', 'warn'); return; }
    let done = 0; const tick = (t) => { archStatus.textContent = `${t} ${done} / ${total}  (keep this page open)`; };
    for (const j of jobs) {
      if (cancelArch) break; tick('Creating PDFs');
      try { const blob = await buildPdf(j.html()); const full = put(`${j.folder}/${j.name}`, blob); index.push([full, j.doc, j.no, wsName(j.ws), 'OK']); }
      catch (e) { fail += 1; index.push([`${j.folder}/${j.name}`, j.doc, j.no, wsName(j.ws), 'FAILED: ' + (e.message || e)]); }
      done += 1;
    }
    const byId = new Map(cards.map((c) => [c.j.id, c]));
    const queue = cancelArch ? [] : atts.slice();
    const worker = async () => { while (queue.length && !cancelArch) {
      const t = queue.shift(); const c = byId.get(t.card_id); if (!c) { done += 1; continue; } tick('Downloading files');
      const { data, error } = await sb.storage.from('job-attachments').download(t.path);
      const path = `${cardFolder(c)}/${t.att_type === 'pdf' ? 'PDFs' : 'Images'}/${safe(t.file_name)}`;
      if (error || !data) { fail += 1; index.push([path, 'Attachment', c.no, wsName(c.ws), 'FAILED']); } else { index.push([put(path, data), 'Attachment', c.no, wsName(c.ws), 'OK']); }
      done += 1; } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (cancelArch) { archStatus.textContent = 'Cancelled.'; return; }
    zip.file('index.csv', '\ufeff' + toCSV(index)); archStatus.textContent = 'Building ZIP...';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => { archStatus.textContent = `Building ZIP ${Math.round(m.percent)}%`; });
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = `WMS-archive-${from.value}_to_${to.value}.zip`; document.body.appendChild(el); el.click(); setTimeout(() => { URL.revokeObjectURL(el.href); el.remove(); }, 2000);
    archStatus.textContent = `Done: ${total - fail} item(s)${fail ? `, ${fail} failed (see index.csv)` : ''}.`; toast('ZIP downloaded');
  }

  const block = (title, dateRule, text, buttons, extra) => card({ title, cls: 'mb', body: h('div', { class: 'col' }, h('div', { class: 'small muted' }, text), h('div', { class: 'small' }, h('b', null, 'Date filter: '), dateRule), extra || null, h('div', { class: 'row' }, buttons)) });
  const dl = (label, fn) => btn(label, { cls: 'primary sm', icon: 'download', onClick: act(fn) });
  root.append(pageHead({ title: 'Reports', sub: seesAll() ? 'All workshops and stores - downloads open in Excel.' : `${isWs() ? wsName(myWorkshopId()) : storeName(myStoreId())} - your own records. Downloads open in Excel.` }),
    card({ title: 'Choose the period', cls: 'mb', body: h('div', { class: 'form-grid' }, field('From', from), field('To', to), ws ? field('Workshop', ws) : null, st ? field('Store', st) : null) }),
    block('MRF report', 'the date the MRF was sent to the store', 'One row per requested item with the MRF, workshop, store, job card, vehicle and store decision.', [dl('Download MRF report', mrfReport)]),
    block('Delivery Challan report', 'the date the DC was sent to the workshop', 'One row per issued item with the item that was requested, what was issued (pack or loose), rate, amount and what the workshop did on receipt.', [dl('Download DC report', dcReport)]),
    block('Returns report', 'the date the return DC was sent to the store', 'One row per returned item with quantity, value, reason and the store decision.', [dl('Download returns report', returnReport)]),
    isStore() ? null : block('Job card reports (all job card types)', 'the date the job card was created', 'Choose the card type, then download the summary, the spares detail or the man-hours detail.', [dl('Summary (one row per card)', jcSummary), dl('Spares detail', jcSpares), dl('Man-hours detail', jcManhours)], field('Card type', jtype)),
    block('Complete archive (PDFs + documents)', 'each document\'s own date (MRF sent, DC sent, return sent, job card created)', 'One ZIP with the final PDFs organised per job card: Workshop / Card type / Job card number / MRFs, Delivery Challans, Images, PDFs and the job card PDF itself. Returns go to Workshop / Returns, and MRFs/DCs without a job card to Facility. Creating PDFs takes about a second each, so large periods can take several minutes - keep this page open.',
      [btn('Download complete archive', { cls: 'primary sm', icon: 'download', onClick: act(archiveZip) }), btn('Cancel', { cls: 'sm ghost', onClick: () => { cancelArch = true; } })],
      h('div', { class: 'col' }, h('div', { class: 'row', style: { gap: '8px 22px', flexWrap: 'wrap' } }, chk(optMrf, 'MRFs'), chk(optDc, 'Delivery challans'), chk(optRet, 'Returns'), chk(optJc, 'Job card PDFs'), chk(optDoc, 'Images & PDFs of job cards')), archStatus)),
    isStore() ? null : block('Documents ZIP (images & PDFs)', 'the date the job card was created', 'One ZIP with a folder per job card: Workshop / Card type / Job card number / Images or PDFs, plus an index.csv listing every file. Uses the workshop chosen at the top and the card type chosen in the Job card reports box above. Large periods can take a few minutes - keep this page open.', [btn('Download documents ZIP', { cls: 'primary sm', icon: 'download', onClick: act(docsZip) })], zipStatus));
  return { el: root };
}
