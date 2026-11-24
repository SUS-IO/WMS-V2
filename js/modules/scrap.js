// Scrap: damaged items -> scrap queue -> scrap DC (with approval PDF) -> store accepts / sends back -> Scrapped stock.
import { sb, S, rpc, fetchAll, isWs, isStore, isAdmin, seesAll, myWorkshopId, myStoreId, wsName, storeName, productById, userName } from '../core/api.js';
import { h, pageHead, card, btn, modal, act, toast, badge, banner, promptBox, tabsBar, field, inp, kv, statusBadge } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { fmtDateTime, fmtNum, fmtQty, num } from '../core/format.js';
import { compressPdf, maxPdfBytes, fmtSize } from '../core/compress.js';
import { printPreview, docHeader, docFooter, box } from '../core/print.js';
import { fmtNum as _n, esc } from '../core/format.js';

export function scrapPrintHtml(d, lines) {
  const w = S.workshops.find((x) => x.id === d.workshop_id); const s = S.stores.find((x) => x.id === d.store_id);
  const blank = Array.from({ length: Math.max(0, 6 - lines.length) }, () => '<tr class="blankrow"><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  return `${docHeader({ title: 'Scrap Delivery Challan', no: d.scrap_no, status: d.status === 'draft' ? 'Draft' : d.status === 'sent_back' ? 'Sent back' : d.status === 'accepted' ? 'Accepted' : '' })}
    <div class="grid2">
      ${box('From - Workshop', `<div class="big">${esc(w?.name)}</div>${esc(w?.address || '')}<br>${esc([w?.contact_name, w?.contact_phone].filter(Boolean).join(' · '))}`)}
      ${box('To - Store', `<div class="big">${esc(s?.name)}</div>${esc(s?.address || '')}<br>${esc([s?.contact_name, s?.contact_phone].filter(Boolean).join(' · '))}`)}
    </div>
    <div class="grid3">${box('Date & time', esc(fmtDateTime(d.sent_at || new Date())))}${box('Prepared by', esc(userName(d.created_by)))}${box('Approval PDF', d.pdf_name ? esc(d.pdf_name) : 'Not attached')}</div>
    <table><thead><tr><th style="width:26px">#</th><th style="width:16%">Item code</th><th>Description</th><th style="width:70px">Part no.</th><th class="num" style="width:80px">Qty</th></tr></thead><tbody>
      ${lines.map((l, i) => { const p = productById(l.product_id); return `<tr><td>${i + 1}</td><td>${esc(p?.item_code)}</td><td>${esc(p?.description)}</td><td>${esc(p?.part_no || '')}</td><td class="num">${_n(l.qty)} ${esc(p?.base_uom || '')}</td></tr>`; }).join('')}${blank}</tbody></table>
    ${d.remarks ? `<div class="note"><b>Remarks:</b> ${esc(d.remarks)}</div>` : ''}
    <div class="note">Damaged / unserviceable items sent for scrapping. Not for sale.</div>
    <div class="sig"><div>Prepared by</div><div>Workshop Manager</div><div>Received by (Store)</div><div>Date / time received</div></div>
    ${docFooter(userName(S.profile?.id))}`;
}

const BUCKET = 'job-attachments';
const STATUS = { draft: ['Draft', 'neutral'], sent: ['Sent to store', 'info'], accepted: ['Accepted', 'success'], sent_back: ['Sent back', 'danger'] };
const sBadge = (s) => badge(STATUS[s]?.[0] || s, STATUS[s]?.[1] || 'neutral', true);
const pName = (id) => productById(id)?.description || '?';
const itemCell = (r) => { const p = productById(r.product_id); return h('div', null, h('div', { class: 'cell-main' }, p?.description || '?'), h('div', { class: 'cell-sub mono' }, p?.item_code || '')); };

async function openPdf(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error('Could not open the PDF');
  window.open(data.signedUrl, '_blank', 'noopener');
}

/** the scrap DC dialog: lines, PDF, and the buttons that suit the viewer */
function dcDialog(d, reload) {
  const mineWs = isWs() && d.workshop_id === myWorkshopId(); const mineStore = isStore() && d.store_id === myStoreId();
  const lines = (d.scrap_dc_lines || []).slice().sort((a, b) => a.line_no - b.line_no);
  const pdfRow = h('div'); const draw = () => {
    pdfRow.replaceChildren(d.pdf_path ? h('div', { class: 'row' }, btn(d.pdf_name || 'Scrap approval PDF', { cls: 'sm', icon: 'file', onClick: act(() => openPdf(d.pdf_path)) }), badge('PDF attached', 'success', true)) : badge('PDF missing - required before sending', 'danger', true));
  };
  draw();
  const fileIn = h('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });
  fileIn.onchange = act(async () => {
    const f = fileIn.files[0]; fileIn.value = ''; if (!f) return;
    if (f.type !== 'application/pdf') throw new Error('Only a PDF file is allowed');
    const cr = await compressPdf(f); const blob = cr.blob; if (blob.size > maxPdfBytes()) throw new Error(`The PDF is ${fmtSize(blob.size)} - larger than the ${fmtSize(maxPdfBytes())} limit. Scan at a lower resolution (150 dpi).`);
    const path = `${d.workshop_id}/${d.id}/${Date.now()}.pdf`;
    const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf' }); if (up.error) throw new Error(up.error.message);
    const old = await rpc('scrap_dc_set_pdf', { p_id: d.id, p_path: path, p_name: f.name, p_size: blob.size });
    if (old) await sb.storage.from(BUCKET).remove([old]);
    d.pdf_path = path; d.pdf_name = f.name; draw(); toast('PDF attached');
  });
  const close = () => m.close();
  const foot = [];
  if (mineWs && d.status === 'draft') foot.push(
    btn('Discard draft', { cls: 'danger ghost', onClick: act(async () => { const old = await rpc('scrap_dc_discard', { p_id: d.id }); if (old) await sb.storage.from(BUCKET).remove([old]); toast('Draft discarded - items are back in the scrap queue', 'warn'); close(); await reload(); }) }),
    btn(d.pdf_path ? 'Replace PDF' : 'Attach PDF', { icon: 'upload', onClick: () => fileIn.click() }),
    btn('Send to store', { cls: 'primary', onClick: act(async () => { if (!d.pdf_path) throw new Error('Attach the scrap approval PDF first'); const no = await rpc('scrap_dc_send', { p_id: d.id }); toast(`Scrap DC ${no} sent`); close(); await reload(); }) }));
  if (mineStore && d.status === 'sent') foot.push(
    btn('Send back', { cls: 'danger ghost', onClick: act(async () => { const r = await promptBox({ title: 'Send the whole scrap DC back', label: 'Reason', confirmText: 'Send back', tone: 'danger' }); if (!r) return; await rpc('scrap_dc_send_back', { p_id: d.id, p_reason: r }); toast('Sent back to the workshop', 'warn'); close(); await reload(); }) }),
    btn('Accept scrap', { cls: 'success', onClick: act(async () => { await rpc('scrap_dc_accept', { p_id: d.id }); toast('Scrap accepted - added to Scrapped stock'); close(); await reload(); }) }));
  foot.push(btn('Print / PDF', { icon: 'printer', onClick: act(() => printPreview(d.scrap_no || 'Scrap DC', scrapPrintHtml(d, lines))) }));
  foot.push(btn('Close', { onClick: () => close() }));
  const body = h('div', { class: 'col' },
    kv([['Scrap DC', d.scrap_no || 'Draft'], ['Workshop', wsName(d.workshop_id)], ['Store', storeName(d.store_id)], ['Status', STATUS[d.status]?.[0] || d.status], d.sent_at ? ['Sent', `${fmtDateTime(d.sent_at)} · ${userName(d.sent_by)}`] : null, d.decided_at ? ['Decision', `${fmtDateTime(d.decided_at)} · ${userName(d.decided_by)}`] : null, d.remarks ? ['Remarks', d.remarks] : null]),
    d.status === 'sent_back' ? banner('danger', `Sent back by the store: ${d.back_reason || ''}`) : null,
    h('div', { class: 'row' }, h('b', null, 'Approval PDF:'), pdfRow), fileIn,
    h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['#', 'Item', 'Qty'].map((x) => h('th', null, x)))), h('tbody', null, lines.map((l) => h('tr', null, h('td', null, l.line_no), h('td', null, h('div', { class: 'bold' }, pName(l.product_id)), h('div', { class: 'small muted mono' }, productById(l.product_id)?.item_code || '')), h('td', null, fmtQty(productById(l.product_id), l.qty)))))));
  const m = modal({ title: `Scrap DC ${d.scrap_no || '(draft)'}`, size: 'lg', content: body, foot });
}

const dcColumns = (showWs) => [
  { key: 'scrap_no', label: 'Scrap DC', render: (r) => h('span', { class: 'cell-main mono' }, r.scrap_no || 'DRAFT') },
  ...(showWs ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
  { key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) },
  { key: 'items', label: 'Items', num: true, value: (r) => (r.scrap_dc_lines || []).length },
  { key: 'qty', label: 'Total qty', num: true, value: (r) => (r.scrap_dc_lines || []).reduce((a, l) => a + Number(l.qty), 0) },
  { key: 'status', label: 'Status', render: (r) => h('div', null, sBadge(r.status), r.status === 'draft' && !r.pdf_path ? h('div', { class: 'cell-sub', style: { color: 'var(--danger)' } }, 'PDF missing') : null) },
  { key: 'created_at', label: 'Created', render: (r) => fmtDateTime(r.sent_at || r.created_at) },
];

/* ============================================================ workshop side: queue, DCs, scrapped */
export async function workshop(ctx) {
  const root = h('div'); const canAct = isWs(); const ws = seesAll() ? null : myWorkshopId();
  let cur = ctx.query.tab || 'queue'; let queue = [], dcs = [], scrapped = [];
  const wsFilter = seesAll() ? [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }] : [];
  const qT = dataTable({ exportName: 'scrap-queue', searchPlaceholder: 'Search item...', filters: wsFilter,
    columns: [{ key: 'item', label: 'Item', value: (r) => pName(r.product_id), render: itemCell }, ...(seesAll() ? [{ key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }] : []),
      { key: 'qty', label: 'In scrap queue', num: true, render: (r) => h('b', null, fmtQty(productById(r.product_id), r.qty)) },
      { key: 'x', label: '', sortable: false, render: (r) => (canAct ? btn('Move back to damaged', { cls: 'sm ghost', onClick: act(() => moveBack(r)) }) : null) }],
    toolbar: canAct ? [btn('Create scrap DC', { cls: 'primary sm', icon: 'plus', onClick: act(createDc) })] : [],
    empty: { icon: 'trash', title: 'Scrap queue is empty', text: 'On the Damaged Products page use "To scrap queue" on an item.' } });
  const dT = dataTable({ exportName: 'scrap-dcs', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search scrap DC...', filters: wsFilter, columns: dcColumns(seesAll()), onRowClick: (r) => dcDialog(r, load), empty: { icon: 'file', title: 'No scrap DCs yet' } });
  const sT = dataTable({ exportName: 'scrapped-stock', searchPlaceholder: 'Search item...', columns: [{ key: 'item', label: 'Item', value: (r) => pName(r.product_id), render: itemCell }, { key: 'store_id', label: 'Held at store', value: (r) => storeName(r.store_id) }, { key: 'qty', label: 'Scrapped qty', num: true, render: (r) => h('b', null, fmtQty(productById(r.product_id), r.qty)) }], empty: { icon: 'trash', title: 'Nothing scrapped yet' } });
  const holder = h('div'); const tabsH = h('div');
  const apply = () => holder.replaceChildren(cur === 'dcs' ? dT.el : cur === 'scrapped' ? sT.el : qT.el);
  const drawTabs = () => tabsH.replaceChildren(tabsBar({ active: cur, tabs: [{ key: 'queue', label: `Scrap queue (${queue.length})` }, { key: 'dcs', label: `Scrap DCs (${dcs.length})` }, { key: 'scrapped', label: 'Scrapped stock' }], onChange: (k) => { cur = k; drawTabs(); apply(); } }));
  async function moveBack(r) {
    const t = await promptBox({ title: 'Move back to damaged stock', message: pName(r.product_id), label: 'Quantity', value: String(r.qty), multiline: false, confirmText: 'Move back' }); if (!t) return;
    const q = num(t); if (!(q > 0)) throw new Error('Enter a quantity'); await rpc('scrap_queue_remove', { p_product: r.product_id, p_qty: q }); toast('Moved back to damaged stock'); await load();
  }
  async function createDc() {
    if (!queue.length) throw new Error('The scrap queue is empty');
    const store = selectBox({ options: S.stores.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })), placeholder: 'Select the store that receives the scrap' });
    const rem = inp({ placeholder: 'Optional remarks' }); const picks = new Map();
    const list = h('div', { class: 'col', style: { gap: '6px' } }, queue.map((r) => { const cb = h('input', { type: 'checkbox' }); const q = inp({ type: 'number', min: '0', step: 'any', value: r.qty, style: { width: '110px' } });
      cb.checked = true; picks.set(r.product_id, { cb, q, max: Number(r.qty) });
      return h('label', { class: 'row nowrap', style: { gap: '10px', alignItems: 'center' } }, cb, h('div', { class: 'grow' }, h('div', { class: 'bold' }, pName(r.product_id)), h('div', { class: 'small muted' }, `In queue: ${fmtQty(productById(r.product_id), r.qty)}`)), q); }));
    const m = modal({ title: 'Create scrap DC', size: 'lg', content: h('div', { class: 'col' }, banner('info', 'The DC is saved as a draft. Attach the approval PDF, then send it. Until it is sent you can discard it and the items return to the queue.'), field('Store', store, { required: true }), field('Items & quantity', list), field('Remarks', rem)),
      foot: [btn('Cancel', { onClick: () => m.close() }), btn('Create draft', { cls: 'primary', onClick: act(async () => {
        if (!store.getValue()) throw new Error('Select the store');
        const lines = [...picks].filter(([, v]) => v.cb.checked).map(([product_id, v]) => ({ product_id, qty: num(v.q.value) }));
        if (!lines.length || lines.some((l) => !(l.qty > 0))) throw new Error('Select at least one item with a quantity');
        await rpc('scrap_dc_create', { p_store: store.getValue(), p_lines: lines, p_remarks: rem.value.trim() || null }); toast('Scrap DC draft created - attach the PDF and send it'); m.close(); cur = 'dcs'; await load();
      }) })] });
  }
  async function load() {
    const qq = sb.from('scrap_queue').select('*').gt('qty', 0); const dq = sb.from('scrap_dcs').select('*, scrap_dc_lines(*)').order('created_at', { ascending: false }); const sq = sb.from('scrapped_stock').select('*').gt('qty', 0);
    [queue, dcs, scrapped] = await Promise.all([fetchAll(() => (ws ? qq.eq('workshop_id', ws) : qq)), fetchAll(() => (ws ? dq.eq('workshop_id', ws) : dq)), fetchAll(() => sq)]);
    qT.setRows(queue); dT.setRows(dcs); sT.setRows(scrapped); drawTabs(); apply();
  }
  root.append(pageHead({ title: 'Scrap', sub: 'Damaged items you decide to scrap are queued, sent to a store on a Scrap DC (approval PDF required) and the store accepts or sends them back.' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabsH), holder));
  await load();
  return { el: root, refresh: load };
}

/* ============================================================ store side */
export async function inbox(ctx) {
  const root = h('div'); const sid = isStore() ? myStoreId() : null; let cur = ctx.query.tab || 'pending'; let dcs = [], scrapped = [];
  const dT = dataTable({ exportName: 'scrap-inbox', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search scrap DC, workshop...', columns: dcColumns(true), onRowClick: (r) => dcDialog(r, load), empty: { icon: 'inbox', title: 'No scrap DCs' } });
  const sT = dataTable({ exportName: 'scrapped-stock', searchPlaceholder: 'Search item...', columns: [{ key: 'item', label: 'Item', value: (r) => pName(r.product_id), render: itemCell }, ...(sid ? [] : [{ key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) }]), { key: 'qty', label: 'Scrapped qty', num: true, render: (r) => h('b', null, fmtQty(productById(r.product_id), r.qty)) }], empty: { icon: 'trash', title: 'No scrapped stock' } });
  const holder = h('div'); const tabsH = h('div');
  const rowsFor = () => (cur === 'pending' ? dcs.filter((r) => r.status === 'sent') : dcs.filter((r) => r.status !== 'sent'));
  const apply = () => { dT.setRows(rowsFor()); holder.replaceChildren(cur === 'scrapped' ? sT.el : dT.el); };
  const drawTabs = () => tabsH.replaceChildren(tabsBar({ active: cur, tabs: [{ key: 'pending', label: `To accept (${dcs.filter((r) => r.status === 'sent').length})` }, { key: 'done', label: 'Accepted / sent back' }, { key: 'scrapped', label: 'Scrapped stock' }], onChange: (k) => { cur = k; drawTabs(); apply(); } }));
  async function load() {
    const q = sb.from('scrap_dcs').select('*, scrap_dc_lines(*)').neq('status', 'draft').order('created_at', { ascending: false }); const s = sb.from('scrapped_stock').select('*').gt('qty', 0);
    [dcs, scrapped] = await Promise.all([fetchAll(() => (sid ? q.eq('store_id', sid) : q)), fetchAll(() => (sid ? s.eq('store_id', sid) : s))]);
    sT.setRows(scrapped); drawTabs(); apply();
  }
  root.append(pageHead({ title: 'Scrap Inbox', sub: sid ? `${storeName(sid)} - scrap sent by workshops. Accept to add it to Scrapped stock, or send the whole DC back.` : 'All stores' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabsH), holder));
  await load();
  return { el: root, refresh: load };
}
