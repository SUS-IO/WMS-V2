// Purchase module: Purchase Indent (PI) -> Purchase Order (PO) -> Goods Receipt Note (GRN)
import { sb, S, run, rpc, fetchAll, role, isAdmin, isStore, isPurchase, isPurchaseMgr, isDeptMgrOf, myDept, myStoreId, companyById, companyName, companyOptions, departmentName, departmentOptions, vendorById, vendorOptions, storeName, storeById, productById, productOptions, userName, purchaseOn } from '../core/api.js';
import { h, icon, pageHead, card, btn, iconBtn, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv, field, inp, textarea, modal, sectionTitle } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { navigate } from '../core/router.js';
import { docHeader, docFooter, box, printPreview } from '../core/print.js';
import { esc, fmtDate, fmtDateTime, fmtNum, num, round, CURRENCIES, amountInWords, fmtAmt } from '../core/format.js';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const canRaisePI = () => role() !== 'viewer' && !isPurchase() && (isAdmin() || !!myDept());
const cnt = (a) => (Array.isArray(a) ? a.length : 0);
const split2 = (n) => { const a = round(n / 2, 2); return [a, round(n - a, 2)]; };

/* =================================================================== signature names (typed by hand, printed on the PDF) */
function sigEditor(auth, appr, disabled) {
  const mk = (title, arr, ph) => {
    const vals = arr && arr.length ? [...arr] : []; const box_ = h('div', { class: 'col', style: { gap: '6px' } });
    const draw = () => {
      box_.replaceChildren(...vals.map((v, i) => { const t = inp({ value: v, placeholder: ph, disabled }); t.oninput = () => { vals[i] = t.value; };
        return h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, h('div', { class: 'grow' }, t), disabled ? null : iconBtn('trash', 'Remove', () => { vals.splice(i, 1); draw(); })); }),
      disabled ? null : btn('Add name', { cls: 'sm', icon: 'plus', onClick: () => { vals.push(''); draw(); box_.querySelectorAll('input')[vals.length - 1]?.focus(); } }));
      if (!vals.length && disabled) box_.prepend(h('div', { class: 'muted' }, '—'));
    };
    draw(); return { el: h('div', { class: 'field' }, h('label', null, title), box_), get: () => vals.map((x) => x.trim()).filter(Boolean) };
  };
  const a = mk('Authorized by (type name)', auth, 'Name'); const p = mk('Approved by (type name)', appr, 'Name');
  return { el: h('div', { class: 'form-grid' }, a.el, p.el), get: () => ({ sig_authorized: a.get(), sig_approved: p.get() }) };
}

/* =================================================================== PDFs */
function sigTable(prepared, verified, auth, appr, verifiedLabel = 'Verified by') {
  const slots = [['Prepared by', prepared], [verifiedLabel, verified], ...(auth.length ? auth : ['']).map((n) => ['Authorized by', n]), ...(appr.length ? appr : ['']).map((n) => ['Approved by', n])];
  const rows = []; for (let i = 0; i < slots.length; i += 4) rows.push(slots.slice(i, i + 4));
  return `<table style="width:100%;border:0;margin-top:18px;table-layout:fixed;border-collapse:collapse">${rows.map((r) => `<tr>${Array.from({ length: 4 }, (_, i) => r[i] ? `<td style="border:0;text-align:center;vertical-align:bottom;padding:34px 8px 6px"><div style="min-height:16px;font-weight:600;font-size:12px">${esc(r[i][1] || '')}</div><div style="border-top:1px solid #333;padding-top:3px;font-size:11px">${r[i][0]}</div></td>` : '<td style="border:0"></td>').join('')}</tr>`).join('')}</table>`;
}
const blankRows = (n, cols) => Array.from({ length: Math.max(0, n) }, () => `<tr class="blankrow">${'<td></td>'.repeat(cols)}</tr>`).join('');

export function piPrintHtml(pi, lines) {
  return `${docHeader({ title: 'Purchase Indent', no: pi.pi_no || '(draft)', status: pi.status === 'draft' ? 'Draft' : '', company: companyById(pi.company_id) })}
    <div class="grid3">${box('Department', `<div class="big">${esc(departmentName(pi.department_id))}</div>`)}${box('Indent date', esc(fmtDate(pi.pi_date)))}${box('Raised by', esc(userName(pi.created_by)))}</div>
    <table><thead><tr><th style="width:28px">#</th><th>Item requested</th><th class="num" style="width:70px">Qty</th><th style="width:60px">Unit</th><th style="width:28%">Remarks</th></tr></thead><tbody>
    ${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.item_text)}</td><td class="num">${fmtNum(l.qty)}</td><td>${esc(l.unit || '')}</td><td>${esc(l.remarks || '')}</td></tr>`).join('')}${blankRows(8 - lines.length, 5)}</tbody></table>
    ${pi.remarks ? `<div class="note"><b>Remarks:</b> ${esc(pi.remarks)}</div>` : ''}
    ${sigTable(userName(pi.created_by), pi.approved_by ? userName(pi.approved_by) : '', pi.sig_authorized || [], pi.sig_approved || [], 'Verified by')}
    ${docFooter(S.profile.full_name)}`;
}

export function poPrintHtml(po, lines, pi) {
  const v = vendorById(po.vendor_id); const cur = po.currency || 'INR'; const intra = po.tax_mode !== 'inter';
  const [cg, sg] = split2(Number(po.tax_total));
  const rows = lines.map((l, i) => { const p = productById(l.product_id) || {};
    return `<tr><td>${i + 1}</td><td>${esc(p.item_code || '')}</td><td>${esc(p.description || '')}</td><td class="num">${fmtNum(l.qty)}</td><td>${esc(p.uom || '')}</td><td class="num">${fmtAmt(l.rate, cur)}</td><td class="num">${fmtNum(l.gst_pct, 2)}%</td><td class="num">${fmtAmt(l.gross, cur)}</td></tr>`; }).join('');
  const tot = (k, val, b) => `<tr><td style="border:0;text-align:right;padding:2px 8px">${b ? '<b>' : ''}${k}${b ? '</b>' : ''}</td><td class="num" style="width:130px;padding:2px 8px">${b ? '<b>' : ''}${val}${b ? '</b>' : ''}</td></tr>`;
  const terms = [['Payment terms', po.payment_terms], ['Delivery terms', po.delivery_terms], ['Lead time', po.lead_time], ['Delivery location', po.delivery_location]].filter(([, t]) => t);
  return `${docHeader({ title: 'Purchase Order', no: po.po_no || '(draft)', status: po.status === 'draft' ? 'Draft' : '', company: companyById(po.company_id) })}
    <div class="grid2">${box('Vendor', `<div class="big">${esc(v?.name || '—')}</div>${esc(v?.address || '')}<br>${v?.gstin ? 'GSTIN: ' + esc(v.gstin) + '<br>' : ''}${esc([v?.contact_name, v?.phone, v?.email].filter(Boolean).join(' · '))}`)}
      ${box('Order details', `PO date: <b>${esc(fmtDate(po.po_date))}</b><br>Reference indent: <b>${esc(pi?.pi_no || '—')}</b><br>Currency: <b>${esc(cur)}</b>`)}</div>
    <table><thead><tr><th style="width:28px">#</th><th style="width:80px">Item code</th><th>Description</th><th class="num" style="width:60px">Qty</th><th style="width:44px">UoM</th><th class="num" style="width:80px">Rate</th><th class="num" style="width:54px">GST</th><th class="num" style="width:92px">Amount</th></tr></thead><tbody>${rows}${blankRows(6 - lines.length, 8)}</tbody></table>
    <table style="width:100%;border:0;margin-top:6px"><tr><td style="border:0;vertical-align:top"><div class="note" style="margin:0"><b>Amount in words:</b><br>${esc(amountInWords(po.net_total, cur))}</div></td>
      <td style="border:0;width:300px"><table style="width:100%">${tot('Taxable amount', fmtAmt(po.taxable, cur))}${intra ? tot('CGST', fmtAmt(cg, cur)) + tot('SGST', fmtAmt(sg, cur)) : tot('IGST', fmtAmt(po.tax_total, cur))}${tot('Net amount', fmtAmt(po.net_total, cur), true)}</table></td></tr></table>
    ${po.narration ? `<div class="note"><b>Narration:</b> ${esc(po.narration)}</div>` : ''}
    ${terms.length ? `<div class="note">${terms.map(([k, t]) => `<b>${k}:</b> ${esc(t)}`).join('<br>')}</div>` : ''}
    ${sigTable(userName(po.created_by), po.verified_by ? userName(po.verified_by) : '', po.sig_authorized || [], po.sig_approved || [], 'Verified by')}
    ${docFooter(S.profile.full_name)}`;
}

export function grnPrintHtml(g, lines, po) {
  const v = vendorById(g.vendor_id); const s = storeById(g.store_id);
  return `${docHeader({ title: 'Goods Receipt Note', no: g.grn_no, status: '', company: companyById(g.company_id) })}
    <div class="grid2">${box('Vendor', `<div class="big">${esc(v?.name || '—')}</div>${esc(v?.address || '')}${v?.gstin ? '<br>GSTIN: ' + esc(v.gstin) : ''}`)}${box('Received at store', `<div class="big">${esc(s?.name || '—')}</div>${esc(s?.address || '')}`)}</div>
    <div class="grid3">${box('GRN date', esc(fmtDate(g.grn_date)))}${box('Purchase Order', `<b>${esc(po?.po_no || '—')}</b>`)}${box('Invoice / Reference', `Invoice: <b>${esc(g.invoice_no)}</b><br>Ref: <b>${esc(g.ref_no)}</b>`)}</div>
    <table><thead><tr><th style="width:26px">#</th><th style="width:76px">Item code</th><th>Description</th><th style="width:40px">UoM</th><th class="num" style="width:58px">Ordered</th><th class="num" style="width:58px">Received</th><th class="num" style="width:58px">Accepted</th><th class="num" style="width:58px">Rejected</th><th style="width:20%">Remarks</th></tr></thead><tbody>
    ${lines.map((l, i) => { const p = productById(l.product_id) || {}; return `<tr><td>${i + 1}</td><td>${esc(p.item_code || '')}</td><td>${esc(p.description || '')}</td><td>${esc(p.uom || '')}</td><td class="num">${fmtNum(l.ordered_qty)}</td><td class="num">${fmtNum(l.received_qty)}</td><td class="num">${fmtNum(l.accepted_qty)}</td><td class="num">${fmtNum(l.rejected_qty)}</td><td>${esc(l.remarks || '')}</td></tr>`; }).join('')}${blankRows(6 - lines.length, 9)}</tbody></table>
    ${g.remarks ? `<div class="note"><b>Remarks:</b> ${esc(g.remarks)}</div>` : ''}
    ${sigTable(userName(g.created_by), '', g.sig_authorized || [], g.sig_approved || [], 'Verified by')}
    ${docFooter(S.profile.full_name)}`;
}

/* =================================================================== shared bits */
const piOpts = [['draft', 'Draft'], ['submitted', 'With Department Manager'], ['returned', 'Returned to requester'], ['approved', 'Approved - with Purchase'], ['purchase_returned', 'Returned by Purchase']].map(([value, label]) => ({ value, label }));
const poOpts = [['draft', 'Draft'], ['submitted', 'With Purchase Manager'], ['returned', 'Returned to team'], ['approved', 'Verified - assign store'], ['assigned', 'With store'], ['store_returned', 'Returned by store'], ['closed', 'Closed']].map(([value, label]) => ({ value, label }));
const offBanner = () => banner('warn', 'The Purchase module is switched off. The administrator can enable it in Settings.');
const reasonBanner = (r) => (r ? h('div', { class: 'mb' }, banner('warn', h('div', null, h('b', null, 'Sent back: '), r))) : null);

/* =================================================================== PURCHASE INDENT - list */
export async function piList() {
  const root = h('div'); let rows = [];
  const tbl = dataTable({
    exportName: 'purchase-indents', defaultSort: { key: 'pi_date', dir: 'desc' }, searchPlaceholder: 'Search indent, department, item...',
    rowClass: (r) => (['returned', 'purchase_returned'].includes(r.status) ? 'row-warn' : ''),
    filters: [{ key: 'status', label: 'All statuses', options: piOpts }, { key: 'department_id', label: 'All departments', options: S.departments.map((d) => ({ value: d.id, label: d.name })) }],
    columns: [
      { key: 'pi_no', label: 'Indent no', value: (r) => r.pi_no || '(draft)', render: (r) => h('span', { class: 'cell-main mono' }, r.pi_no || '(draft)') },
      { key: 'pi_date', label: 'Date', value: (r) => r.pi_date, render: (r) => fmtDate(r.pi_date) },
      { key: 'department_id', label: 'Department', value: (r) => departmentName(r.department_id) },
      { key: 'company_id', label: 'Company', value: (r) => (r.company_id ? companyName(r.company_id) : '') },
      { key: 'by', label: 'Raised by', value: (r) => userName(r.created_by) },
      { key: 'items', label: 'Items', num: true, value: (r) => cnt(r.pi_lines) },
      { key: 'pos', label: 'POs', num: true, value: (r) => cnt(r.purchase_orders) },
      { key: 'status', label: 'Status', value: (r) => r.status, render: (r) => statusBadge('pi', r.status) },
    ],
    toolbar: canRaisePI() && purchaseOn() ? [btn('New indent', { cls: 'primary sm', icon: 'plus', onClick: () => navigate('/pi/new') })] : [],
    onRowClick: (r) => navigate(`/pi/${r.id}`),
    empty: { icon: 'clipboard', title: 'No purchase indents', text: 'Indents raised by departments appear here.' },
  });
  async function load() { rows = await fetchAll(() => sb.from('purchase_indents').select('*, pi_lines(id), purchase_orders(id)').order('created_at', { ascending: false })); tbl.setRows(rows); }
  await load();
  root.append(pageHead({ title: 'Purchase Indents', sub: 'A department lists what it needs; its Department Manager approves; then the Purchase team raises Purchase Orders.' }), purchaseOn() ? null : h('div', { class: 'mb' }, offBanner()), h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== PURCHASE INDENT - form / detail */
export async function piDetail(ctx) {
  const id = ctx.params.id; const isNew = id === 'new'; const root = h('div'); const view = { el: root, isForm: false };
  let pi; let lines = []; let pos = []; let st;
  const me = S.profile.id;

  async function load() {
    if (isNew) { if (!canRaisePI()) throw new Error('You cannot raise indents.'); pi = { status: 'draft', department_id: myDept(), company_id: null, remarks: '', sig_authorized: [], sig_approved: [], created_by: me }; lines = []; pos = []; return; }
    pi = await run(sb.from('purchase_indents').select('*').eq('id', id).maybeSingle()); if (!pi) throw new Error('Indent not found.');
    [lines, pos] = await Promise.all([run(sb.from('pi_lines').select('*').eq('pi_id', id).order('line_no')), run(sb.from('purchase_orders').select('id,po_no,status,po_date,vendor_id,net_total,currency').eq('pi_id', id).order('created_at'))]);
  }
  const mine = () => pi.created_by === me;
  const canEdit = () => (isNew ? canRaisePI() : (['draft', 'returned'].includes(pi.status) && (mine() || isAdmin())) || (['submitted', 'purchase_returned'].includes(pi.status) && isDeptMgrOf(pi.department_id)));
  const canSig = () => !isNew && (canEdit() || (pi.status !== 'draft' && (mine() || isDeptMgrOf(pi.department_id) || isPurchase() || isAdmin())));

  function payload() {
    const ls = st.lines.filter((l) => l.item_text.trim() || l.qty);
    if (ls.some((l) => !l.item_text.trim() || !(num(l.qty) > 0))) throw new Error('Every line needs both an item description and a quantity');
    return { department_id: st.dept ? st.dept.getValue() : pi.department_id, company_id: st.company.getValue(), remarks: st.remarks.value, lines: ls.map((l) => ({ id: l.id || null, item_text: l.item_text, qty: num(l.qty), unit: l.unit, remarks: l.remarks })), ...st.sig.get() };
  }
  async function save(quiet) {
    if (isNew && !(st.dept ? st.dept.getValue() : pi.department_id)) throw new Error('Select the department');
    const nid = await rpc('pi_save', { p_id: isNew ? null : id, p: payload() });
    if (!quiet) toast('Saved');
    if (isNew) { navigate(`/pi/${nid}`); return null; }
    return nid;
  }
  async function reloadAll() { await load(); draw(); }
  async function send() { if (!st.company.getValue()) { st.company.markInvalid(true); throw new Error('Select the company name (mandatory)'); } const nid = isNew ? await rpc('pi_save', { p_id: null, p: payload() }) : (await save(true), id); const no = await rpc('pi_submit', { p_id: nid }); toast(`Indent ${no} sent to the Department Manager`); if (isNew) navigate(`/pi/${nid}`); else await reloadAll(); }
  async function approve() { await save(true); await rpc('pi_approve', { p_id: id }); toast('Indent approved - Purchase department notified'); await reloadAll(); }
  async function giveBack() { const r = await promptBox({ title: 'Send back to requester', label: 'What should be corrected?', confirmText: 'Send back', tone: 'danger' }); if (!r) return; await rpc('pi_return', { p_id: id, p_reason: r }); toast('Sent back', 'warn'); await reloadAll(); }
  async function purchaseBack() { const r = await promptBox({ title: 'Send back to Department Manager', label: 'What should be changed / corrected?', confirmText: 'Send back', tone: 'danger' }); if (!r) return; await rpc('pi_purchase_return', { p_id: id, p_reason: r }); toast('Sent back to the Department Manager', 'warn'); await reloadAll(); }
  async function del() { if (!(await confirmBox({ title: 'Delete this draft?', message: 'This cannot be undone.', tone: 'danger', confirmText: 'Delete' }))) return; await rpc('pi_delete', { p_id: id }); toast('Draft deleted'); navigate('/pi'); }
  async function saveSig() { const s = st.sig.get(); await rpc('doc_signatories', { p_kind: 'pi', p_id: id, p_auth: s.sig_authorized, p_appr: s.sig_approved }); toast('Names saved'); await reloadAll(); }
  async function print() { const ls = canEdit() ? st.lines.filter((l) => l.item_text.trim()).map((l) => ({ ...l, qty: num(l.qty) })) : lines; if (!ls.length) throw new Error('Add at least one item first.'); await printPreview(`Indent ${pi.pi_no || 'draft'}`, piPrintHtml(canEdit() ? { ...pi, company_id: st.company.getValue(), remarks: st.remarks.value, ...st.sig.get() } : pi, ls)); }

  function draw() {
    root.replaceChildren(); const edit = canEdit(); view.isForm = edit; ctx.setTitle(pi.pi_no || 'New Purchase Indent', departmentName(pi.department_id));
    st = { lines: lines.length ? lines.map((l) => ({ id: l.id, item_text: l.item_text, qty: l.qty, unit: l.unit || '', remarks: l.remarks || '' })) : [{ item_text: '', qty: '', unit: '', remarks: '' }] };
    st.company = selectBox({ options: companyOptions(true, pi.company_id), value: pi.company_id, disabled: !edit, clearable: false, placeholder: 'Select company' });
    if (isNew && isAdmin()) st.dept = selectBox({ options: departmentOptions(), value: pi.department_id, placeholder: 'Select department' });
    st.remarks = textarea({ value: pi.remarks || '', rows: 2, disabled: !edit, placeholder: 'Optional remarks for the Purchase department' });
    st.sig = sigEditor(pi.sig_authorized, pi.sig_approved, !canSig());
    const grid = h('div', { class: 'lines-wrap' });
    const drawLines = () => {
      const tb = h('tbody');
      st.lines.forEach((l, i) => {
        const t = inp({ value: l.item_text, placeholder: 'Describe the item (type freely)', disabled: !edit }); t.oninput = () => { l.item_text = t.value; };
        const q = inp({ type: 'number', min: '0', step: 'any', value: l.qty, placeholder: 'Qty', disabled: !edit, style: { minWidth: '80px' } }); q.oninput = () => { l.qty = q.value; };
        const u = inp({ value: l.unit, placeholder: 'Unit', disabled: !edit, style: { minWidth: '70px' } }); u.oninput = () => { l.unit = u.value; };
        const r = inp({ value: l.remarks, placeholder: 'Remarks', disabled: !edit }); r.oninput = () => { l.remarks = r.value; };
        tb.appendChild(h('tr', null, h('td', { class: 'n' }, i + 1), h('td', { style: { minWidth: '240px' } }, t), h('td', null, q), h('td', null, u), h('td', { style: { minWidth: '150px' } }, r),
          h('td', { style: { width: '48px' } }, edit ? iconBtn('trash', 'Remove line', () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push({ item_text: '', qty: '', unit: '', remarks: '' }); drawLines(); }) : null)));
      });
      grid.replaceChildren(h('table', { class: 'lines' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Item (plain text)'), h('th', null, 'Qty'), h('th', null, 'Unit'), h('th', null, 'Remarks'), h('th'))), tb));
      if (edit) grid.appendChild(h('div', { style: { marginTop: '10px' } }, btn('Add item', { cls: 'sm', icon: 'plus', onClick: () => { st.lines.push({ item_text: '', qty: '', unit: '', remarks: '' }); drawLines(); const ins = grid.querySelectorAll('tbody tr:last-child input'); ins[0]?.focus(); } })));
    };
    drawLines();

    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: act(print) })];
    const st_ = pi.status; const mgr = isDeptMgrOf(pi.department_id);
    if (edit && (isNew || ['draft', 'returned'].includes(st_)) && (isNew || mine() || isAdmin())) {
      if (!isNew && st_ === 'draft') acts.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(del) }));
      acts.push(btn('Save', { cls: 'sm', icon: 'save', onClick: act(() => save()) }), btn(st_ === 'returned' ? 'Re-send to Department Manager' : 'Send to Department Manager', { cls: 'primary', icon: 'send', onClick: act(send) }));
    }
    if (!isNew && mgr && ['submitted', 'purchase_returned'].includes(st_)) {
      acts.push(btn('Save corrections', { cls: 'sm', icon: 'save', onClick: act(() => save()) }));
      if (st_ === 'submitted') acts.push(btn('Send back', { cls: 'danger ghost', icon: 'undo', onClick: act(giveBack) }));
      acts.push(btn(st_ === 'submitted' ? 'Approve' : 'Approve & resend to Purchase', { cls: 'primary', icon: 'check', onClick: act(approve) }));
    }
    if (!isNew && st_ === 'approved' && (isPurchase() || isAdmin())) acts.push(btn('Send back to Department Manager', { cls: 'danger ghost', icon: 'undo', onClick: act(purchaseBack) }), btn('Raise Purchase Order', { cls: 'primary', icon: 'plus', onClick: () => navigate(`/po/new?pi=${id}`) }));
    if (!isNew && !edit && canSig()) acts.push(btn('Save names', { cls: 'sm', icon: 'save', onClick: act(saveSig) }));

    const poCard = !isNew && pos.length ? card({ title: 'Purchase Orders raised against this indent', body: h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['PO no', 'Date', 'Vendor', 'Net amount', 'Status'].map((x) => h('th', null, x)))),
      h('tbody', null, pos.map((o) => h('tr', { style: { cursor: 'pointer' }, onClick: () => navigate(`/po/${o.id}`) }, h('td', null, h('span', { class: 'cell-main mono' }, o.po_no || '(draft)')), h('td', null, fmtDate(o.po_date)), h('td', null, vendorById(o.vendor_id)?.name || '—'), h('td', null, fmtAmt(o.net_total, o.currency)), h('td', null, statusBadge('po', o.status)))))) }) : null;

    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, pi.pi_no || 'New Purchase Indent'), statusBadge('pi', pi.status), pi.revision ? badge(`Revision ${pi.revision}`, 'purple', true) : null), h('p', null, `${departmentName(pi.department_id)}${pi.pi_date ? ' · ' + fmtDate(pi.pi_date) : ''}`)), h('div', { class: 'actions' }, acts)),
      reasonBanner(['returned', 'purchase_returned'].includes(pi.status) ? pi.return_reason : null),
      pi.status === 'submitted' && !mgr ? h('div', { class: 'mb' }, banner('info', 'Waiting for the Department Manager to approve.')) : null,
      card({ title: 'Indent details', body: h('div', { class: 'col' },
        h('div', { class: 'form-grid' }, st.dept ? field('Department', st.dept, { required: true }) : null, field('Company', st.company, { required: true, hint: 'For documentation only - printed on the PDF and carried to the Purchase Order and GRN.' })),
        !isNew ? kv([['Raised by', userName(pi.created_by)], ['Indent date', fmtDate(pi.pi_date)], pi.approved_by ? ['Approved by', `${userName(pi.approved_by)} · ${fmtDateTime(pi.approved_at)}`] : null]) : null) }),
      card({ title: 'Items requested', body: h('div', { class: 'col' }, grid, field('Remarks', st.remarks)) }),
      card({ title: 'Names for the PDF signatures', body: h('div', { class: 'col' }, h('div', { class: 'muted' }, 'Prepared by = the person who raised it, Verified by = the Department Manager who approves. Type the Authorized by / Approved by names below - add as many as needed.'), st.sig.el) }),
      poCard);
  }
  await load(); draw();
  return view;
}

/* =================================================================== PURCHASE ORDER - list */
export async function poList() {
  const root = h('div'); let rows = [];
  const tbl = dataTable({
    exportName: 'purchase-orders', defaultSort: { key: 'po_date', dir: 'desc' }, searchPlaceholder: 'Search PO, vendor, indent...',
    rowClass: (r) => (['submitted'].includes(r.status) && isPurchaseMgr() ? 'row-warn' : r.status === 'assigned' && isStore() ? 'row-warn' : r.status === 'closed' ? 'row-muted' : ''),
    filters: [{ key: 'status', label: 'All statuses', options: poOpts }, { key: 'vendor_id', label: 'All vendors', options: S.vendors.map((v) => ({ value: v.id, label: v.name })) }],
    columns: [
      { key: 'po_no', label: 'PO no', value: (r) => r.po_no || '(draft)', render: (r) => h('span', { class: 'cell-main mono' }, r.po_no || '(draft)') },
      { key: 'po_date', label: 'Date', value: (r) => r.po_date, render: (r) => fmtDate(r.po_date) },
      { key: 'vendor_id', label: 'Vendor', value: (r) => vendorById(r.vendor_id)?.name || '' },
      { key: 'company_id', label: 'Company', value: (r) => (r.company_id ? companyName(r.company_id) : '') },
      { key: 'pi', label: 'Indent', value: (r) => r.purchase_indents?.pi_no || '' },
      { key: 'dept', label: 'Department', value: (r) => departmentName(r.purchase_indents?.department_id) },
      { key: 'net_total', label: 'Net amount', num: true, value: (r) => Number(r.net_total), render: (r) => fmtAmt(r.net_total, r.currency) },
      { key: 'store_id', label: 'Store', value: (r) => (r.store_id ? storeName(r.store_id) : '') },
      { key: 'grns', label: 'GRNs', num: true, value: (r) => cnt(r.grns) },
      { key: 'status', label: 'Status', value: (r) => r.status, render: (r) => statusBadge('po', r.status) },
    ],
    onRowClick: (r) => navigate(`/po/${r.id}`),
    empty: { icon: 'file', title: 'No purchase orders', text: 'Purchase Orders raised by the Purchase team appear here.' },
  });
  async function load() { rows = await fetchAll(() => sb.from('purchase_orders').select('*, purchase_indents(pi_no, department_id), grns(id)').order('created_at', { ascending: false })); tbl.setRows(rows); }
  await load();
  root.append(pageHead({ title: 'Purchase Orders', sub: isStore() ? 'Purchase Orders assigned to your store. Open one to create a GRN when material arrives.' : 'Orders raised to vendors against approved indents.' }), purchaseOn() ? null : h('div', { class: 'mb' }, offBanner()), h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== PURCHASE ORDER - form / detail */
export async function poDetail(ctx) {
  const id = ctx.params.id; const isNew = id === 'new'; const root = h('div'); const view = { el: root, isForm: false };
  let po; let lines = []; let pi; let piLines = []; let grns = []; let st;
  const me = S.profile.id;

  async function load() {
    if (isNew) {
      const piId = ctx.query.pi; if (!piId) throw new Error('Open an approved indent and press "Raise Purchase Order".');
      pi = await run(sb.from('purchase_indents').select('*').eq('id', piId).maybeSingle()); if (!pi || pi.status !== 'approved') throw new Error('Purchase Orders can only be raised against an approved indent.');
      piLines = await run(sb.from('pi_lines').select('*').eq('pi_id', piId).order('line_no'));
      po = { status: 'draft', pi_id: piId, company_id: pi.company_id, vendor_id: null, po_date: today(), currency: 'INR', tax_mode: 'intra', created_by: me, sig_authorized: [], sig_approved: [], taxable: 0, tax_total: 0, net_total: 0 };
      lines = piLines.map((l) => ({ pi_line_id: l.id, product_id: null, qty: l.qty, rate: '', gst_pct: '' })); grns = []; return;
    }
    po = await run(sb.from('purchase_orders').select('*').eq('id', id).maybeSingle()); if (!po) throw new Error('Purchase Order not found.');
    [pi, lines, piLines, grns] = await Promise.all([run(sb.from('purchase_indents').select('*').eq('id', po.pi_id).maybeSingle()), run(sb.from('po_lines').select('*').eq('po_id', id).order('line_no')),
      run(sb.from('pi_lines').select('*').eq('pi_id', po.pi_id).order('line_no')), run(sb.from('grns').select('*, grn_lines(*)').eq('po_id', id).order('created_at'))]);
  }
  const purch = () => isPurchase() || isAdmin(); const pm = () => isPurchaseMgr() || isAdmin();
  const canEdit = () => purch() && (isNew || ['draft', 'returned'].includes(po.status));
  const canSig = () => !isNew && purch();
  const myStore = () => isStore() && po.store_id && myStoreId() === po.store_id;

  const lineTotals = () => { let tx = 0; let tt = 0; st.lines.forEach((l) => { const g = round(num(l.qty) * num(l.rate), 2); tx += g; tt += round(g * num(l.gst_pct) / 100, 2); }); return { taxable: round(tx, 2), tax: round(tt, 2), net: round(tx + tt, 2) }; };
  function payload() {
    const ls = st.lines.filter((l) => l.product_id);
    return { vendor_id: st.vendor.getValue(), company_id: st.company.getValue(), po_date: st.date.value, currency: st.cur.getValue(), tax_mode: st.tax.getValue(), narration: st.narration.value, delivery_location: st.loc.value, payment_terms: st.pay.value, delivery_terms: st.del.value, lead_time: st.lead.value,
      lines: ls.map((l) => ({ id: l.id || null, product_id: l.product_id, pi_line_id: l.pi_line_id || null, qty: num(l.qty), rate: num(l.rate), gst_pct: num(l.gst_pct) })), ...st.sig.get(), ...(isNew ? { pi_id: po.pi_id } : {}) };
  }
  async function save(quiet) { const nid = await rpc('po_save', { p_id: isNew ? null : id, p: payload() }); if (!quiet) toast('Saved'); if (isNew) { navigate(`/po/${nid}`); return null; } return nid; }
  async function reloadAll() { await load(); draw(); }
  async function submit() { const nid = isNew ? await rpc('po_save', { p_id: null, p: payload() }) : (await save(true), id); const no = await rpc('po_submit', { p_id: nid }); toast(`PO ${no} sent to the Purchase Manager`); if (isNew) navigate(`/po/${nid}`); else await reloadAll(); }
  async function approve() { await rpc('po_approve', { p_id: id }); toast('Purchase Order verified - now assign a store'); await reloadAll(); assign(); }
  async function back() { const r = await promptBox({ title: 'Return to the purchase team', label: 'What should be corrected?', confirmText: 'Return', tone: 'danger' }); if (!r) return; await rpc('po_return', { p_id: id, p_reason: r }); toast('Returned to the purchase team', 'warn'); await reloadAll(); }
  function assign() {
    const sel = selectBox({ options: S.stores.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name, sub: s.code })), value: po.store_id, placeholder: 'Select store', clearable: false });
    const m = modal({ title: `Assign ${po.po_no} to a store`, size: 'sm', content: h('div', { class: 'col' }, h('div', { class: 'muted' }, 'The store will be notified and can raise GRNs against this order.'), field('Store', sel, { required: true })),
      foot: [btn('Cancel', { onClick: () => m.close() }), btn('Assign', { cls: 'primary', onClick: act(async () => { if (!sel.getValue()) throw new Error('Select the store'); await rpc('po_assign', { p_id: id, p_store: sel.getValue() }); toast('Assigned to ' + storeName(sel.getValue())); m.close(); await reloadAll(); }) })] });
  }
  async function storeBack() { const r = await promptBox({ title: 'Send back to Purchase Manager', label: 'What needs to be corrected / changed?', confirmText: 'Send back', tone: 'danger' }); if (!r) return; await rpc('po_store_return', { p_id: id, p_reason: r }); toast('Sent back to the Purchase Manager', 'warn'); await reloadAll(); }
  async function closePo() { const r = await promptBox({ title: `Close ${po.po_no}`, message: 'Once closed no GRN is possible any more. This is done manually when the order is complete or cancelled.', label: 'Reason / note', required: false, confirmText: 'Close PO', tone: 'danger' }); if (r === null || r === undefined) return; await rpc('po_close', { p_id: id, p_reason: r }); toast('Purchase Order closed', 'warn'); await reloadAll(); }
  async function del() { if (!(await confirmBox({ title: 'Delete this draft?', message: 'This cannot be undone.', tone: 'danger', confirmText: 'Delete' }))) return; await rpc('po_delete', { p_id: id }); toast('Draft deleted'); navigate(`/pi/${po.pi_id}`); }
  async function saveSig() { const s = st.sig.get(); await rpc('doc_signatories', { p_kind: 'po', p_id: id, p_auth: s.sig_authorized, p_appr: s.sig_approved }); toast('Names saved'); await reloadAll(); }
  async function print() {
    const edit = canEdit(); const p = edit ? payload() : null; const ls = edit ? st.lines.filter((l) => l.product_id).map((l) => ({ ...l, qty: num(l.qty), rate: num(l.rate), gst_pct: num(l.gst_pct), gross: round(num(l.qty) * num(l.rate), 2) })) : lines;
    if (!ls.length) throw new Error('Add at least one product first.');
    const t = edit ? lineTotals() : { taxable: po.taxable, tax: po.tax_total, net: po.net_total };
    await printPreview(`PO ${po.po_no || 'draft'}`, poPrintHtml(edit ? { ...po, vendor_id: p.vendor_id, company_id: p.company_id, po_date: p.po_date, currency: p.currency, tax_mode: p.tax_mode, narration: p.narration, delivery_location: p.delivery_location, payment_terms: p.payment_terms, delivery_terms: p.delivery_terms, lead_time: p.lead_time, taxable: t.taxable, tax_total: t.tax, net_total: t.net, sig_authorized: p.sig_authorized, sig_approved: p.sig_approved } : po, ls, pi));
  }

  function draw() {
    root.replaceChildren(); const edit = canEdit(); view.isForm = edit; ctx.setTitle(po.po_no || 'New Purchase Order', pi?.pi_no ? `Indent ${pi.pi_no}` : '');
    st = { lines: lines.map((l) => ({ id: l.id, pi_line_id: l.pi_line_id, product_id: l.product_id, qty: l.qty, rate: l.rate === 0 ? '' : l.rate, gst_pct: l.gst_pct })) };
    if (!st.lines.length) st.lines.push({ pi_line_id: null, product_id: null, qty: '', rate: '', gst_pct: '' });
    const D = !edit;
    st.vendor = selectBox({ options: vendorOptions(true, po.vendor_id), value: po.vendor_id, disabled: D, clearable: false, placeholder: 'Select vendor' });
    st.company = selectBox({ options: companyOptions(true, po.company_id), value: po.company_id, disabled: D, clearable: false, placeholder: 'Select company' });
    st.date = inp({ type: 'date', value: po.po_date, min: pi?.pi_date, max: today(), disabled: D });
    st.cur = selectBox({ options: Object.keys(CURRENCIES).map((c) => ({ value: c, label: `${c} (${CURRENCIES[c].major})` })), value: po.currency, disabled: D, clearable: false, onChange: () => recalc() });
    st.tax = selectBox({ options: [{ value: 'intra', label: 'CGST + SGST (same state)' }, { value: 'inter', label: 'IGST (other state)' }], value: po.tax_mode, disabled: D, clearable: false, onChange: () => recalc() });
    st.narration = textarea({ value: po.narration || '', rows: 2, disabled: D, placeholder: 'Narration' });
    st.loc = textarea({ value: po.delivery_location || '', rows: 2, disabled: D, placeholder: 'Delivery location' });
    st.pay = inp({ value: po.payment_terms || '', disabled: D, placeholder: 'e.g. 30 days from invoice' }); st.del = inp({ value: po.delivery_terms || '', disabled: D, placeholder: 'e.g. Ex-works / door delivery' }); st.lead = inp({ value: po.lead_time || '', disabled: D, placeholder: 'e.g. 10 days' });
    st.sig = sigEditor(po.sig_authorized, po.sig_approved, !canSig());
    const totals = h('div', { class: 'po-totals' }); const words = h('div', { class: 'note' });
    function recalc() {
      const t = D ? { taxable: po.taxable, tax: po.tax_total, net: po.net_total } : lineTotals(); const cur = st.cur.getValue() || 'INR'; const intra = st.tax.getValue() !== 'inter'; const [cg, sg] = split2(t.tax);
      const row = (k, v, b) => h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '24px', fontWeight: b ? '700' : '400' } }, h('span', null, k), h('span', null, v));
      totals.replaceChildren(row('Taxable amount', fmtAmt(t.taxable, cur)), ...(intra ? [row('CGST', fmtAmt(cg, cur)), row('SGST', fmtAmt(sg, cur))] : [row('IGST', fmtAmt(t.tax, cur))]), row('Net amount', fmtAmt(t.net, cur), true));
      words.replaceChildren(h('b', null, 'Amount in words: '), amountInWords(t.net, cur));
    }
    const grid = h('div', { class: 'lines-wrap' });
    const drawLines = () => {
      const tb = h('tbody'); const reqOpts = piLines.map((p) => ({ value: p.id, label: `${p.item_text} (req. ${fmtNum(p.qty)}${p.unit ? ' ' + p.unit : ''})` }));
      st.lines.forEach((l, i) => {
        const rq = selectBox({ options: reqOpts, value: l.pi_line_id, disabled: D, small: true, clearable: false, placeholder: 'Requested item', onChange: (v) => { l.pi_line_id = v; } });
        const pr = selectBox({ options: productOptions(), value: l.product_id, disabled: D, small: true, clearable: false, placeholder: 'Select product', onChange: (v) => { l.product_id = v; const p = productById(v); if ((l.gst_pct === '' || l.gst_pct == null) && p) { l.gst_pct = p.gst_pct ?? 0; drawLines(); } else recalc(); } });
        const q = inp({ type: 'number', min: '0', step: 'any', value: l.qty, disabled: D, style: { minWidth: '80px' } }); const r = inp({ type: 'number', min: '0', step: 'any', value: l.rate, disabled: D, style: { minWidth: '90px' } }); const g = inp({ type: 'number', min: '0', step: 'any', value: l.gst_pct, disabled: D, style: { minWidth: '64px' } });
        const gross = h('td', { class: 'num' }, fmtAmt(round(num(l.qty) * num(l.rate), 2), st.cur?.getValue() || 'INR'));
        const upd = () => { l.qty = q.value; l.rate = r.value; l.gst_pct = g.value; gross.textContent = fmtAmt(round(num(l.qty) * num(l.rate), 2), st.cur.getValue() || 'INR'); recalc(); };
        q.oninput = r.oninput = g.oninput = upd;
        tb.appendChild(h('tr', null, h('td', { class: 'n' }, i + 1), h('td', { style: { minWidth: '210px' } }, rq), h('td', { style: { minWidth: '230px' } }, pr), h('td', null, q), h('td', null, r), h('td', null, g), gross,
          h('td', { style: { width: '48px' } }, edit ? iconBtn('trash', 'Remove line', () => { st.lines.splice(i, 1); if (!st.lines.length) st.lines.push({ pi_line_id: null, product_id: null, qty: '', rate: '', gst_pct: '' }); drawLines(); }) : null)));
      });
      grid.replaceChildren(h('table', { class: 'lines' }, h('thead', null, h('tr', null, h('th'), h('th', null, 'Product requested (indent item)'), h('th', null, 'Product (from master)'), h('th', null, 'Qty'), h('th', null, 'Rate'), h('th', null, 'GST %'), h('th', { class: 'num' }, 'Gross amount'), h('th'))), tb));
      if (edit) grid.appendChild(h('div', { style: { marginTop: '10px' } }, btn('Add product', { cls: 'sm', icon: 'plus', onClick: () => { st.lines.push({ pi_line_id: null, product_id: null, qty: '', rate: '', gst_pct: '' }); drawLines(); } })));
      recalc();
    };
    drawLines();

    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: act(print) })]; const s_ = po.status;
    if (edit) {
      if (!isNew && s_ === 'draft' && !po.po_no) acts.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(del) }));
      acts.push(btn('Save', { cls: 'sm', icon: 'save', onClick: act(() => save()) }), btn(s_ === 'returned' ? 'Re-send to Purchase Manager' : 'Send to Purchase Manager', { cls: 'primary', icon: 'send', onClick: act(submit) }));
    }
    if (!isNew && pm()) {
      if (['submitted', 'store_returned'].includes(s_)) acts.push(btn('Return to team', { cls: 'danger ghost', icon: 'undo', onClick: act(back) }));
      if (s_ === 'submitted') acts.push(btn('Verify & approve', { cls: 'primary', icon: 'check', onClick: act(approve) }));
      if (['approved', 'store_returned'].includes(s_)) acts.push(btn(s_ === 'approved' ? 'Assign to store' : 'Assign again (same / other store)', { cls: 'primary', icon: 'store', onClick: assign }));
      if (['approved', 'assigned', 'store_returned'].includes(s_)) acts.push(btn('Close PO', { cls: 'danger ghost', icon: 'ban', onClick: act(closePo) }));
    }
    if (!isNew && myStore() && s_ === 'assigned') acts.push(btn('Send back to Purchase Manager', { cls: 'danger ghost', icon: 'undo', onClick: act(storeBack) }), btn('Create GRN', { cls: 'primary', icon: 'packagePlus', onClick: () => navigate(`/grn/new?po=${id}`) }));
    if (!isNew && !edit && canSig()) acts.push(btn('Save names', { cls: 'sm', icon: 'save', onClick: act(saveSig) }));

    const accepted = (plId) => grns.reduce((a, g) => a + (g.grn_lines || []).filter((x) => x.po_line_id === plId).reduce((b, x) => b + Number(x.accepted_qty), 0), 0);
    const progress = !isNew && po.status !== 'draft' && lines.length ? card({ title: 'Receiving progress', body: h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['Product', 'Ordered', 'Accepted so far', 'Pending'].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', null, lines.map((l) => { const p = productById(l.product_id) || {}; const a = accepted(l.id); return h('tr', null, h('td', null, `${p.item_code || ''} - ${p.description || ''}`), h('td', { class: 'num' }, fmtNum(l.qty)), h('td', { class: 'num' }, fmtNum(a)), h('td', { class: 'num' }, fmtNum(Math.max(0, l.qty - a)))); }))) }) : null;
    const grnCard = !isNew && grns.length ? card({ title: 'Goods Receipt Notes', body: h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['GRN no', 'Date', 'Invoice no', 'Reference no'].map((x) => h('th', null, x)))),
      h('tbody', null, grns.map((g) => h('tr', { style: { cursor: 'pointer' }, onClick: () => navigate(`/grn/${g.id}`) }, h('td', null, h('span', { class: 'cell-main mono' }, g.grn_no)), h('td', null, fmtDate(g.grn_date)), h('td', null, g.invoice_no), h('td', null, g.ref_no))))) }) : null;

    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, po.po_no || 'New Purchase Order'), statusBadge('po', po.status), po.revision ? badge(`Revision ${po.revision}`, 'purple', true) : null), h('p', null, `Against indent ${pi?.pi_no || ''} · ${departmentName(pi?.department_id)}${po.store_id ? ' · Store: ' + storeName(po.store_id) : ''}`)), h('div', { class: 'actions' }, acts)),
      reasonBanner(['returned', 'store_returned'].includes(po.status) ? po.return_reason : null),
      po.status === 'closed' ? h('div', { class: 'mb' }, banner('info', `Closed${po.close_reason ? ': ' + po.close_reason : ''} - no more GRN is possible.`)) : null,
      card({ title: 'Order details', body: h('div', { class: 'col' }, h('div', { class: 'form-grid' },
        field('Vendor', st.vendor, { required: true }), field('Company', st.company, { required: true, hint: 'Documentation only' }), field('Date', st.date, { required: true, hint: 'Not earlier than the indent date and not in the future' }), field('Currency', st.cur, { required: true }),
        field('Reference Purchase Indent', inp({ value: pi?.pi_no || '', disabled: true })), field('Tax type', st.tax, { required: true })), h('div', { class: 'form-grid' }, field('Delivery location', st.loc, { cls: 'span2' }), field('Narration', st.narration, { cls: 'span2' })),
        h('div', { class: 'form-grid' }, field('Payment terms', st.pay), field('Delivery terms', st.del), field('Lead time', st.lead))) }),
      card({ title: 'Products', body: h('div', { class: 'col' }, h('div', { class: 'muted' }, 'Pick the indent item each product is for. The requested item is not shown on the PDF sent to the vendor.'), grid,
        h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' } }, h('div', { class: 'grow' }, words), h('div', { style: { minWidth: '300px' } }, totals))) }),
      card({ title: 'Names for the PDF signatures', body: h('div', { class: 'col' }, h('div', { class: 'muted' }, 'Prepared by = the person who raised the PO, Verified by = the Purchase Manager. Type the Authorized by / Approved by names - add as many as needed.'), st.sig.el) }),
      progress, grnCard);
  }
  await load(); draw();
  return view;
}

/* =================================================================== GRN - list */
export async function grnList() {
  const root = h('div'); let rows = [];
  const sum = (r, k) => (r.grn_lines || []).reduce((a, l) => a + Number(l[k]), 0);
  const tbl = dataTable({
    exportName: 'grn', defaultSort: { key: 'grn_date', dir: 'desc' }, searchPlaceholder: 'Search GRN, PO, invoice, vendor...',
    filters: [{ key: 'store_id', label: 'All stores', options: S.stores.map((s) => ({ value: s.id, label: s.name })) }],
    columns: [
      { key: 'grn_no', label: 'GRN no', render: (r) => h('span', { class: 'cell-main mono' }, r.grn_no) },
      { key: 'grn_date', label: 'Date', render: (r) => fmtDate(r.grn_date) },
      { key: 'po', label: 'Purchase Order', value: (r) => r.purchase_orders?.po_no || '' },
      { key: 'vendor_id', label: 'Vendor', value: (r) => vendorById(r.vendor_id)?.name || '' },
      { key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) },
      { key: 'invoice_no', label: 'Invoice no' }, { key: 'ref_no', label: 'Reference no' },
      { key: 'acc', label: 'Accepted', num: true, value: (r) => sum(r, 'accepted_qty'), render: (r) => fmtNum(sum(r, 'accepted_qty')) },
      { key: 'rej', label: 'Rejected', num: true, value: (r) => sum(r, 'rejected_qty'), render: (r) => { const n = sum(r, 'rejected_qty'); return n ? badge(fmtNum(n), 'danger') : '0'; } },
    ],
    onRowClick: (r) => navigate(`/grn/${r.id}`),
    empty: { icon: 'packagePlus', title: 'No GRNs yet', text: 'Goods Receipt Notes created by stores appear here. Open an assigned Purchase Order to create one.' },
  });
  async function load() { rows = await fetchAll(() => sb.from('grns').select('*, purchase_orders(po_no), grn_lines(accepted_qty,rejected_qty)').order('created_at', { ascending: false })); tbl.setRows(rows); }
  await load();
  let open = null;
  if (isStore()) { try { open = (await run(sb.from('purchase_orders').select('id,po_no,vendor_id').eq('status', 'assigned').eq('store_id', myStoreId()))) || []; } catch { open = null; } }
  const openCard = open && open.length ? h('div', { class: 'mb' }, banner('info', h('div', null, h('b', null, `${open.length} Purchase Order(s) waiting for your GRN: `), open.map((o) => h('a', { href: `#/po/${o.id}`, style: { marginRight: '10px' } }, o.po_no))))) : null;
  root.append(pageHead({ title: 'Goods Receipt Notes (GRN)', sub: 'Stock is added to the store when a GRN is posted. Many GRNs are possible against one Purchase Order until it is closed.' }), purchaseOn() ? null : h('div', { class: 'mb' }, offBanner()), openCard, h('div', { class: 'card' }, tbl.el));
  return { el: root, refresh: load };
}

/* =================================================================== GRN - create / view */
export async function grnDetail(ctx) {
  const id = ctx.params.id; const isNew = id === 'new'; const root = h('div'); const view = { el: root, isForm: false };
  let g; let gl = []; let po; let pol = []; let prior = []; let pi;
  async function load() {
    if (isNew) {
      const poId = ctx.query.po; if (!poId) throw new Error('Open a Purchase Order assigned to your store and press "Create GRN".');
      po = await run(sb.from('purchase_orders').select('*').eq('id', poId).maybeSingle()); if (!po) throw new Error('Purchase Order not found.');
      if (po.status === 'closed') throw new Error('This Purchase Order is closed - no more GRN is possible.');
      if (po.status !== 'assigned' || !isStore() || myStoreId() !== po.store_id) throw new Error('Only the store this Purchase Order is assigned to can create a GRN.');
      [pol, prior] = await Promise.all([run(sb.from('po_lines').select('*').eq('po_id', poId).order('line_no')), run(sb.from('grn_lines').select('po_line_id,accepted_qty, grns!inner(po_id)').eq('grns.po_id', poId))]);
      return;
    }
    g = await run(sb.from('grns').select('*').eq('id', id).maybeSingle()); if (!g) throw new Error('GRN not found.');
    [gl, po] = await Promise.all([run(sb.from('grn_lines').select('*').eq('grn_id', id).order('line_no')), run(sb.from('purchase_orders').select('*').eq('id', g.po_id).maybeSingle())]);
  }
  async function saveSig(sig) { const s = sig.get(); await rpc('doc_signatories', { p_kind: 'grn', p_id: id, p_auth: s.sig_authorized, p_appr: s.sig_approved }); toast('Names saved'); await load(); draw(); }

  function drawNew() {
    ctx.setTitle('New GRN', po.po_no); view.isForm = true; const v = vendorById(po.vendor_id);
    const inv = inp({ placeholder: 'Vendor invoice number' }); const ref = inp({ placeholder: 'Reference number (challan / LR / other)' }); const date = inp({ type: 'date', value: today(), max: today() }); const rem = textarea({ rows: 2, placeholder: 'Remarks (optional)' });
    const sig = sigEditor([], [], false);
    const prev = (plId) => prior.filter((x) => x.po_line_id === plId).reduce((a, x) => a + Number(x.accepted_qty), 0);
    const L = pol.map((l) => { const p = prev(l.id); const pend = Math.max(0, round(l.qty - p, 3)); return { l, prev: p, pend, rec: pend, rej: '', rem: '' }; });
    const tb = h('tbody');
    L.forEach((x, i) => {
      const pr = productById(x.l.product_id) || {};
      const rec = inp({ type: 'number', min: '0', step: 'any', value: x.rec, style: { minWidth: '84px' } }); const rej = inp({ type: 'number', min: '0', step: 'any', value: x.rej, placeholder: '0', style: { minWidth: '84px' } });
      const rem_ = inp({ placeholder: 'Mandatory if rejected', value: x.rem }); const acc = h('td', { class: 'num' }, fmtNum(num(x.rec) - num(x.rej)));
      const upd = () => { x.rec = rec.value; x.rej = rej.value; x.rem = rem_.value; const a = num(rec.value) - num(rej.value); acc.textContent = fmtNum(a); acc.style.color = a < 0 || a > x.pend + 1e-9 ? 'var(--danger, #c00)' : ''; rem_.classList.toggle('invalid', num(rej.value) > 0 && !rem_.value.trim()); };
      rec.oninput = rej.oninput = rem_.oninput = upd;
      tb.appendChild(h('tr', null, h('td', { class: 'n' }, i + 1), h('td', null, h('div', { class: 'cell-main' }, pr.description || ''), h('div', { class: 'muted mono' }, pr.item_code || '')), h('td', null, pr.uom || ''), h('td', { class: 'num' }, fmtNum(x.l.qty)), h('td', { class: 'num' }, fmtNum(x.prev)), h('td', { class: 'num' }, fmtNum(x.pend)), h('td', null, rec), h('td', null, rej), acc, h('td', { style: { minWidth: '180px' } }, rem_)));
    });
    async function post() {
      if (!inv.value.trim()) { inv.classList.add('invalid'); throw new Error('Invoice number is mandatory'); } if (!ref.value.trim()) { ref.classList.add('invalid'); throw new Error('Reference number is mandatory'); }
      for (const x of L) { if (num(x.rej) > num(x.rec)) throw new Error('Rejected quantity cannot exceed received quantity'); if (num(x.rej) > 0 && !x.rem.trim()) throw new Error('Remarks are mandatory when a quantity is rejected'); }
      const lines = L.filter((x) => num(x.rec) > 0).map((x) => ({ po_line_id: x.l.id, received_qty: num(x.rec), rejected_qty: num(x.rej), remarks: x.rem }));
      if (!lines.length) throw new Error('Enter the received quantity for at least one product');
      if (!(await confirmBox({ title: 'Post this GRN?', message: 'Accepted quantities are added to your store stock immediately. This cannot be edited afterwards.', confirmText: 'Post GRN' }))) return;
      const no = await rpc('grn_post', { p: { po_id: po.id, invoice_no: inv.value, ref_no: ref.value, grn_date: date.value, remarks: rem.value, lines, ...sig.get() } });
      toast(`GRN ${no} posted - stock added`); const row = await run(sb.from('grns').select('id').eq('grn_no', no).maybeSingle()); view.isForm = false; navigate(row ? `/grn/${row.id}` : '/grn');
    }
    root.replaceChildren(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'New Goods Receipt Note'), h('p', null, `Against ${po.po_no} · ${v?.name || ''} · Store: ${storeName(po.store_id)}`)), h('div', { class: 'actions' }, btn('Cancel', { cls: 'ghost', onClick: () => navigate(`/po/${po.id}`) }), btn('Post GRN', { cls: 'primary', icon: 'check', onClick: act(post) }))),
      card({ title: 'Invoice details', body: h('div', { class: 'form-grid' }, field('Vendor', inp({ value: v?.name || '', disabled: true })), field('Company', inp({ value: companyName(po.company_id), disabled: true })), field('Invoice number', inv, { required: true }), field('Reference number', ref, { required: true }), field('GRN date', date, { required: true }), field('Purchase Order', inp({ value: po.po_no, disabled: true }))) }),
      card({ title: 'Received products', body: h('div', { class: 'col' }, h('div', { class: 'muted' }, 'Ordered quantity is filled in. Enter what was received and what is rejected - accepted quantity is worked out (received minus rejected) and only the accepted quantity is added to stock. Leave received as 0 for items that did not arrive.'),
        h('div', { class: 'lines-wrap' }, h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['', 'Product', 'UoM', 'Ordered', 'Received earlier', 'Pending', 'Received', 'Rejected', 'Accepted', 'Remarks'].map((x, i) => h('th', { class: [3, 4, 5, 8].includes(i) ? 'num' : '' }, x)))), tb)), field('Remarks', rem)) }),
      card({ title: 'Names for the PDF signatures', body: sig.el }));
  }
  function drawView() {
    view.isForm = false; ctx.setTitle(g.grn_no, `PO ${po?.po_no || ''}`); const v = vendorById(g.vendor_id);
    const sig = sigEditor(g.sig_authorized, g.sig_approved, !(isAdmin() || isPurchase() || (isStore() && myStoreId() === g.store_id)));
    const canSig = isAdmin() || isPurchase() || (isStore() && myStoreId() === g.store_id);
    const tb = h('tbody', null, gl.map((l, i) => { const p = productById(l.product_id) || {}; return h('tr', null, h('td', { class: 'n' }, i + 1), h('td', null, h('div', { class: 'cell-main' }, p.description || ''), h('div', { class: 'muted mono' }, p.item_code || '')), h('td', null, p.uom || ''), h('td', { class: 'num' }, fmtNum(l.ordered_qty)), h('td', { class: 'num' }, fmtNum(l.received_qty)), h('td', { class: 'num' }, fmtNum(l.accepted_qty)), h('td', { class: 'num' }, l.rejected_qty > 0 ? badge(fmtNum(l.rejected_qty), 'danger') : '0'), h('td', null, l.remarks || '')); }));
    root.replaceChildren(h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, g.grn_no), badge('Posted', 'ok')), h('p', null, `${fmtDate(g.grn_date)} · ${storeName(g.store_id)}`)),
      h('div', { class: 'actions' }, canSig ? btn('Save names', { cls: 'sm', icon: 'save', onClick: act(() => saveSig(sig)) }) : null, btn('Print', { cls: 'primary', icon: 'printer', onClick: act(async () => { await printPreview(`GRN ${g.grn_no}`, grnPrintHtml(g, gl, po)); }) }))),
      card({ title: 'Details', body: kv([['Purchase Order', po ? h('a', { href: `#/po/${po.id}` }, po.po_no) : ''], ['Vendor', v?.name], ['Company', companyName(g.company_id)], ['Invoice number', g.invoice_no], ['Reference number', g.ref_no], ['Received by', userName(g.created_by)], ['Remarks', g.remarks]]) }),
      card({ title: 'Products', body: h('div', { class: 'lines-wrap' }, h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['', 'Product', 'UoM', 'Ordered', 'Received', 'Accepted', 'Rejected', 'Remarks'].map((x, i) => h('th', { class: [3, 4, 5].includes(i) ? 'num' : '' }, x)))), tb)) }),
      card({ title: 'Names for the PDF signatures', body: sig.el }));
  }
  function draw() { return isNew ? drawNew() : drawView(); }
  await load(); draw();
  return view;
}
