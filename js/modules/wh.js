// Workshop Head: approve MRFs the stores ask approval for, hold / release a whole MRF or a single item.
import { sb, S, run, rpc, fetchAll, isWH, wsName, storeName, userName, productById } from '../core/api.js';
import { h, pageHead, card, btn, modal, act, toast, badge, banner, promptBox, tabsBar, kv } from '../core/ui.js';
import { dataTable } from '../core/table.js';
import { fmtDateTime, fmtNum } from '../core/format.js';
import { whTags } from './mrfwh.js';

export async function render(ctx) {
  const root = h('div'); let cur = 'pending'; let rows = [];
  const can = isWH();
  const jcNo = (r) => r.job_cards?.jc_no || (r.mrf_type === 'facility' ? 'Facility' : '');
  const tabsHolder = h('div');
  const tbl = dataTable({
    exportName: 'wh-approvals', defaultSort: { key: 'wh_requested_at', dir: 'asc' }, searchPlaceholder: 'Search MRF, workshop, store...',
    filters: [{ key: 'workshop_id', label: 'All workshops', options: S.workshops.map((w) => ({ value: w.id, label: w.name })) }, { key: 'store_id', label: 'All stores', options: S.stores.map((w) => ({ value: w.id, label: w.name })) }],
    columns: [
      { key: 'mrf_no', label: 'MRF no', render: (r) => h('span', { class: 'cell-main mono' }, r.mrf_no) },
      { key: 'workshop_id', label: 'Workshop', value: (r) => wsName(r.workshop_id) }, { key: 'store_id', label: 'Store', value: (r) => storeName(r.store_id) },
      { key: 'jc', label: 'Job card', value: jcNo }, { key: 'items', label: 'Items', num: true, value: (r) => r.mrf_lines.length },
      { key: 'state', label: 'State', value: (r) => (r.wh_hold ? 'On hold' : r.wh_state === 'pending' ? 'Approval pending' : r.wh_state === 'approved' ? 'Approved' : 'Open'), render: (r) => h('div', null, whTags(r) || badge('Open', 'info', true), r.mrf_lines.some((l) => l.wh_hold) ? badge('Item(s) on hold', 'danger', true) : null) },
      { key: 'wh_requested_at', label: 'Requested', render: (r) => (r.wh_requested_at ? h('div', null, h('div', null, fmtDateTime(r.wh_requested_at)), h('div', { class: 'cell-sub' }, r.wh_request_note || '')) : '') },
    ],
    onRowClick: (r) => open(r), empty: { icon: 'shield', title: 'Nothing here' },
  });
  const filt = () => ({
    pending: rows.filter((r) => r.wh_state === 'pending'),
    hold: rows.filter((r) => r.wh_hold || r.mrf_lines.some((l) => l.wh_hold)),
    approved: rows.filter((r) => r.wh_state === 'approved'),
    all: rows,
  }[cur]);
  const drawTabs = () => tabsHolder.replaceChildren(tabsBar({ active: cur, tabs: [
    { key: 'pending', label: `Awaiting approval (${rows.filter((r) => r.wh_state === 'pending').length})` }, { key: 'hold', label: `On hold (${rows.filter((r) => r.wh_hold || r.mrf_lines.some((l) => l.wh_hold)).length})` },
    { key: 'approved', label: 'Approved' }, { key: 'all', label: 'All open MRFs' }], onChange: (k) => { cur = k; drawTabs(); tbl.setRows(filt()); } }));
  async function load() { rows = await fetchAll(() => sb.from('mrfs').select('*, job_cards(jc_no), mrf_lines(*)').eq('status', 'sent').order('sent_at', { ascending: true })); drawTabs(); tbl.setRows(filt()); }

  function open(r0) {
    let r = r0;
    const body = h('div', { class: 'col' });
    const draw = () => {
      const lines = (r.mrf_lines || []).slice().sort((a, b) => a.line_no - b.line_no);
      body.replaceChildren(
        kv([['Workshop', wsName(r.workshop_id)], ['Store', storeName(r.store_id)], ['Job card', jcNo(r)], ['Requested approval', r.wh_requested_at ? `${userName(r.wh_requested_by)} · ${fmtDateTime(r.wh_requested_at)}${r.wh_request_note ? ' - ' + r.wh_request_note : ''}` : '-'],
          ['Approval', r.wh_state === 'approved' ? `Approved ${fmtDateTime(r.wh_decided_at)}${r.wh_remarks ? ' - ' + r.wh_remarks : ''}` : r.wh_state === 'pending' ? 'Pending' : 'Not requested']]),
        r.wh_hold ? banner('danger', h('span', null, h('b', null, 'Whole MRF on hold: '), r.wh_hold_remarks || '', r.wh_hold_justification ? ` - Workshop Manager's justification: ${r.wh_hold_justification}` : ' (waiting for the Workshop Manager\'s justification)')) : null,
        h('table', { class: 'lines' }, h('thead', null, h('tr', null, ['#', 'Item', 'Qty', 'Store status', ''].map((x) => h('th', null, x)))),
          h('tbody', null, lines.map((l) => h('tr', null, h('td', { class: 'n' }, l.line_no), h('td', null, h('div', { class: 'bold' }, l.item_text), l.wh_hold ? h('div', { class: 'small', style: { color: 'var(--danger)' } }, `On hold: ${l.wh_hold_remarks || ''}${l.wh_hold_justification ? ' · Justification: ' + l.wh_hold_justification : ''}`) : null),
            h('td', null, fmtNum(l.qty)), h('td', null, l.store_status),
            h('td', null, can ? (l.wh_hold ? btn('Release', { cls: 'sm', onClick: act(() => lineAct(l, true)) }) : btn('Hold item', { cls: 'sm danger ghost', onClick: act(() => lineAct(l, false)) })) : null))))));
    };
    async function refresh() { const id = r.id; await load(); const nr = rows.find((x) => x.id === id); m.close(); if (nr) open(nr); }
    async function lineAct(l, release) {
      const t = await promptBox({ title: release ? 'Release this item' : 'Hold this item', message: l.item_text, label: 'Remarks', confirmText: release ? 'Release' : 'Hold', tone: release ? 'primary' : 'danger' }); if (!t) return;
      await rpc(release ? 'wh_line_release' : 'wh_line_hold', { p_line: l.id, p_remarks: t }); toast(release ? 'Item released' : 'Item put on hold - the Workshop Manager is notified'); await refresh();
    }
    const foot = () => [
      can && r.wh_state === 'pending' ? btn('Approve', { cls: 'primary', onClick: act(async () => { const t = await promptBox({ title: 'Approve this MRF', label: 'Remarks (optional)', required: false, confirmText: 'Approve' }); if (t === null) return; await rpc('wh_mrf_approve', { p_id: r.id, p_remarks: t || null }); toast('MRF approved'); await refresh(); }) }) : null,
      can ? (r.wh_hold ? btn('Release MRF', { onClick: act(async () => { const t = await promptBox({ title: 'Release this MRF', label: 'Remarks', confirmText: 'Release' }); if (!t) return; await rpc('wh_mrf_release', { p_id: r.id, p_remarks: t }); toast('MRF released'); await refresh(); }) })
        : btn('Hold whole MRF', { cls: 'danger ghost', onClick: act(async () => { const t = await promptBox({ title: 'Hold the whole MRF', message: 'Stores cannot issue anything against it until you release it. The Workshop Manager is asked for a justification.', label: 'Remarks', confirmText: 'Hold MRF', tone: 'danger' }); if (!t) return; await rpc('wh_mrf_hold', { p_id: r.id, p_remarks: t }); toast('MRF put on hold'); await refresh(); }) })) : null,
      btn('Close', { onClick: () => m.close() }),
    ];
    draw();
    const m = modal({ title: `MRF ${r.mrf_no}`, size: 'lg', content: body, foot: foot() });
  }

  root.append(pageHead({ title: 'Workshop Head', sub: can ? 'Approve material requests the stores send for approval. You can also hold a whole MRF or a single item - the store cannot issue held material until you release it.' : 'Material requests waiting for the Workshop Head (view only).' }), h('div', { class: 'card' }, h('div', { style: { padding: '0 12px' } }, tabsHolder), tbl.el));
  await load();
  return { el: root, refresh: load };
}
