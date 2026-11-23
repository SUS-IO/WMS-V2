// Stock Transfer DC between workshops: sender's manager creates it from workshop stock (rates are automatic),
// the receiving manager accepts the whole DC or sends the whole DC back.
import { sb, S, run, rpc, fetchAll, isManager, seesAll, myWorkshopId, wsName, productById, userName, setting } from '../core/api.js';
import { h, pageHead, btn, iconBtn, modal, act, toast, badge, banner, promptBox, tabsBar, field, inp, kv } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { dataTable } from '../core/table.js';
import { fmtDateTime, fmtQty, fmtMoney, num } from '../core/format.js';

const STATUS = { draft: ['Draft', 'neutral'], sent: ['Waiting for receiver', 'info'], accepted: ['Accepted', 'success'], sent_back: ['Sent back', 'danger'] };
const sBadge = (s) => badge(STATUS[s]?.[0] || s, STATUS[s]?.[1] || 'neutral', true);
const enabled = () => setting('enable_stock_transfer', false) === true || setting('enable_stock_transfer', false) === 'true';

export async function render(ctx) {
  const root = h('div'); const me = myWorkshopId(); let cur = ctx.query.tab || 'in'; let rows = [];
  const tbl = dataTable({ exportName: 'stock-transfers', defaultSort: { key: 'created_at', dir: 'desc' }, searchPlaceholder: 'Search transfer, workshop...',
    columns: [
      { key: 'st_no', label: 'Transfer DC', render: (r) => h('span', { class: 'cell-main mono' }, r.st_no || 'DRAFT') },
      { key: 'from_workshop', label: 'From', value: (r) => wsName(r.from_workshop) }, { key: 'to_workshop', label: 'To', value: (r) => wsName(r.to_workshop) },
      { key: 'items', label: 'Items', num: true, value: (r) => (r.stock_transfer_lines || []).length },
      { key: 'value', label: 'Value', num: true, value: (r) => (r.stock_transfer_lines || []).reduce((a, l) => a + Number(l.amount || 0), 0), render: (r) => (r.status === 'draft' ? '—' : fmtMoney((r.stock_transfer_lines || []).reduce((a, l) => a + Number(l.amount || 0), 0))) },
      { key: 'status', label: 'Status', render: (r) => sBadge(r.status) },
      { key: 'created_at', label: 'Date', render: (r) => fmtDateTime(r.sent_at || r.created_at) }],
    onRowClick: (r) => (r.status === 'draft' && isManager() && r.from_workshop === me ? editor(r) : view(r)),
    toolbar: isManager() && enabled() ? [btn('New stock transfer', { cls: 'primary sm', icon: 'plus', onClick: () => editor(null) })] : [],
    empty: { icon: 'truck', title: 'No stock transfers', text: 'Send workshop stock to another workshop with a Stock Transfer DC.' } });
  const tabsH = h('div');
  const filt = () => (cur === 'in' ? rows.filter((r) => r.to_workshop === me && r.status !== 'draft') : cur === 'out' ? rows.filter((r) => r.from_workshop === me) : rows);
  const drawTabs = () => tabsH.replaceChildren(tabsBar({ active: cur, tabs: seesAll() ? [{ key: 'all', label: 'All transfers' }] : [{ key: 'in', label: `Incoming (${rows.filter((r) => r.to_workshop === me && r.status === 'sent').length} waiting)` }, { key: 'out', label: 'Outgoing' }, { key: 'all', label: 'All' }], onChange: (k) => { cur = k; drawTabs(); tbl.setRows(filt()); } }));
  async function load() { rows = await fetchAll(() => sb.from('stock_transfers').select('*, stock_transfer_lines(*)').order('created_at', { ascending: false })); if (seesAll()) cur = 'all'; drawTabs(); tbl.setRows(filt()); }

  function view(r) {
    const lines = (r.stock_transfer_lines || []).slice().sort((a, b) => a.line_no - b.line_no);
    const canRecv = isManager() && r.to_workshop === me && r.status === 'sent';
    const foot = [];
    if (canRecv) foot.push(
      btn('Send whole DC back', { cls: 'danger ghost', onClick: act(async () => { const t = await promptBox({ title: 'Send the whole DC back', message: 'The stock returns to the sending workshop.', label: 'Reason', tone: 'danger', confirmText: 'Send back' }); if (!t) return; await rpc('st_send_back', { p_id: r.id, p_reason: t }); toast('Sent back', 'warn'); m.close(); await load(); }) }),
      btn('Accept stock', { cls: 'success', onClick: act(async () => { await rpc('st_accept', { p_id: r.id }); toast('Accepted - stock added to your workshop'); m.close(); await load(); }) }));
    foot.push(btn('Close', { onClick: () => m.close() }));
    const m = modal({ title: `Stock transfer ${r.st_no || '(draft)'}`, size: 'lg', foot, content: h('div', { class: 'col' },
      kv([['From', wsName(r.from_workshop)], ['To', wsName(r.to_workshop)], ['Status', STATUS[r.status]?.[0] || r.status], r.sent_at ? ['Sent', `${fmtDateTime(r.sent_at)} · ${userName(r.sent_by)}`] : null, r.decided_at ? ['Decision', `${fmtDateTime(r.decided_at)} · ${userName(r.decided_by)}`] : null, r.remarks ? ['Remarks', r.remarks] : null]),
      r.status === 'sent_back' ? banner('danger', `Sent back by ${wsName(r.to_workshop)}: ${r.back_reason || ''}`) : null,
      h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['#', 'Item', 'Qty', 'Rate', 'Amount'].map((x) => h('th', null, x)))),
        h('tbody', null, lines.map((l) => { const p = productById(l.product_id); return h('tr', null, h('td', null, l.line_no), h('td', null, h('div', { class: 'bold' }, p?.description || '?'), h('div', { class: 'small muted mono' }, p?.item_code || '')), h('td', null, fmtQty(p, l.qty)), h('td', null, l.rate != null ? fmtMoney(l.rate) : '—'), h('td', null, l.amount != null ? fmtMoney(l.amount) : '—')); })))) });
  }

  async function editor(t) {
    const bal = await run(sb.from('stock_balances').select('*').eq('location_type', 'workshop').eq('location_id', me).gt('qty', 0));
    const avail = new Map(bal.map((b) => [b.product_id, b])); if (!avail.size) throw new Error('Your workshop has no stock to transfer.');
    const to = selectBox({ options: S.workshops.filter((w) => w.active && w.id !== me).map((w) => ({ value: w.id, label: w.name })), value: t?.to_workshop || null, placeholder: 'Receiving workshop' });
    const rem = inp({ placeholder: 'Optional remarks', value: t?.remarks || '' }); const lines = (t?.stock_transfer_lines || []).map((l) => ({ product: l.product_id, qty: Number(l.qty) }));
    const box = h('div', { class: 'col' });
    const prod = selectBox({ options: bal.map((b) => { const p = productById(b.product_id); return { value: b.product_id, label: `${p?.item_code} · ${p?.description}`, sub: `Available ${fmtQty(p, b.qty)} @ ${fmtMoney(Number(b.value) / Number(b.qty))}` }; }), placeholder: 'Add item from workshop stock', onChange: (v) => { if (!v) return; if (!lines.some((l) => l.product === v)) lines.push({ product: v, qty: 1 }); prod.setValue(null, true); drawLines(); } });
    function drawLines() {
      box.replaceChildren(...lines.map((l, i) => { const p = productById(l.product); const b = avail.get(l.product); const q = inp({ type: 'number', min: '0', step: p?.allow_decimal ? 'any' : '1', value: l.qty, style: { width: '110px' } }); q.oninput = () => { l.qty = num(q.value); rate.textContent = fmtMoney(l.qty * Number(b.value) / Number(b.qty)); };
        const rate = h('span', { class: 'small' }, fmtMoney(l.qty * Number(b.value) / Number(b.qty)));
        return h('div', { class: 'row nowrap', style: { gap: '10px', alignItems: 'center' } }, h('div', { class: 'grow' }, h('div', { class: 'bold' }, p?.description), h('div', { class: 'small muted' }, `Available ${fmtQty(p, b.qty)} · rate ${fmtMoney(Number(b.value) / Number(b.qty))} (automatic)`)), q, h('div', { style: { width: '90px', textAlign: 'right' } }, rate), iconBtn('trash', 'Remove', () => { lines.splice(i, 1); drawLines(); })); }));
      if (!lines.length) box.append(h('div', { class: 'small muted' }, 'No items yet.'));
    }
    drawLines();
    const save = async () => {
      if (!to.getValue()) throw new Error('Select the receiving workshop'); if (!lines.length || lines.some((l) => !(l.qty > 0))) throw new Error('Add items with a quantity greater than zero');
      for (const l of lines) { const b = avail.get(l.product); if (l.qty > Number(b.qty)) throw new Error(`Only ${fmtQty(productById(l.product), b.qty)} of ${productById(l.product)?.description} is available`); }
      return rpc('st_save', { p_id: t?.id || null, p_to: to.getValue(), p_remarks: rem.value.trim(), p_lines: lines.map((l) => ({ product_id: l.product, qty: l.qty })) });
    };
    const m = modal({ title: t ? `Edit ${'draft'} transfer` : 'New stock transfer', size: 'lg', content: h('div', { class: 'col' }, banner('info', 'Stock leaves your workshop when you press "Save & send" and is added to the receiving workshop only when its manager accepts. Rates are taken automatically from your stock value.'), field('Receiving workshop', to, { required: true }), field('Items', h('div', { class: 'col' }, prod, box), { required: true }), field('Remarks', rem)),
      foot: [t ? btn('Delete draft', { cls: 'danger ghost', onClick: act(async () => { await rpc('st_delete', { p_id: t.id }); toast('Draft deleted', 'warn'); m.close(); await load(); }) }) : null, btn('Cancel', { onClick: () => m.close() }), btn('Save draft', { onClick: act(async () => { await save(); toast('Draft saved'); m.close(); await load(); }) }),
        btn('Save & send', { cls: 'primary', onClick: act(async () => { const id = await save(); const no = await rpc('st_send', { p_id: id }); toast(`Transfer ${no} sent`); m.close(); await load(); }) })].filter(Boolean) });
  }

  root.append(pageHead({ title: 'Stock Transfers', sub: enabled() ? 'Move stock between workshops. The receiving workshop manager accepts the whole DC or sends it back.' : 'Stock transfer between workshops is switched off (Administrator: Settings).' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabsH), tbl.el));
  await load();
  return { el: root, refresh: load };
}
