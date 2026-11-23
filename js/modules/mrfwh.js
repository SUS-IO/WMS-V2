// Workshop Head approval / hold and store closure-request blocks, shared by the workshop and store MRF screens.
import { rpc, isManager, isStore, myWorkshopId, myStoreId, userName } from '../core/api.js';
import { h, btn, act, toast, banner, promptBox, card, badge } from '../core/ui.js';
import { fmtDateTime } from '../core/format.js';

/** returns an array of elements (banners / cards) describing the approval, hold and closure-request state of an MRF */
export function whBlocks(m, lines, reload) {
  const out = []; const open = m.status === 'sent';
  const mgr = isManager() && m.workshop_id === myWorkshopId();
  const justify = (line) => btn('Give justification', { cls: 'sm primary', onClick: act(async () => {
    const t = await promptBox({ title: 'Justification for the hold', message: 'Explain to the Workshop Head why these materials are needed. The Workshop Head is notified.', label: 'Justification', confirmText: 'Send' });
    if (!t) return; await rpc('mrf_hold_justify', { p_mrf: m.id, p_line: line ? line.id : null, p_text: t }); toast('Justification sent'); await reload();
  }) });
  if (open && m.wh_state === 'pending') out.push(h('div', { class: 'mb' }, banner('warn', h('span', null, h('b', null, 'Waiting for Workshop Head approval'), ` - requested by ${userName(m.wh_requested_by)} on ${fmtDateTime(m.wh_requested_at)}${m.wh_request_note ? ': ' + m.wh_request_note : ''}. Products cannot be issued until it is approved.`), 'clock')));
  if (m.wh_state === 'approved') out.push(h('div', { class: 'mb' }, banner('ok', h('span', null, h('b', null, 'Approved by Workshop Head'), ` ${fmtDateTime(m.wh_decided_at)}${m.wh_remarks ? ' - ' + m.wh_remarks : ''}`))));
  if (open && m.wh_hold) out.push(h('div', { class: 'mb' }, banner('danger', h('div', null, h('div', null, h('b', null, 'This MRF is on hold by the Workshop Head'), ` (${fmtDateTime(m.wh_held_at)}): ${m.wh_hold_remarks || ''}`), h('div', { class: 'small' }, 'Products cannot be issued against it until it is released.'),
    m.wh_hold_justification ? h('div', { class: 'small', style: { marginTop: '4px' } }, h('b', null, 'Justification: '), m.wh_hold_justification) : null, mgr ? h('div', { style: { marginTop: '8px' } }, justify(null)) : null), 'ban')));
  const held = (lines || []).filter((l) => l.wh_hold);
  if (open && held.length) out.push(card({ title: 'Items on hold by the Workshop Head', cls: 'mb', body: h('div', { class: 'col' }, held.map((l) => h('div', { class: 'row between', style: { gap: '12px', alignItems: 'flex-start' } },
    h('div', null, h('div', { class: 'bold' }, l.item_text), h('div', { class: 'small muted' }, `Held ${fmtDateTime(l.wh_held_at)}: ${l.wh_hold_remarks || ''}`), l.wh_hold_justification ? h('div', { class: 'small' }, h('b', null, 'Justification: '), l.wh_hold_justification) : null),
    mgr ? justify(l) : null))) }));
  if (open && m.close_req_state === 'requested') out.push(h('div', { class: 'mb' }, banner('warn', h('div', null, h('div', null, h('b', null, 'The store asks to close this MRF'), ` (${userName(m.close_req_by)}, ${fmtDateTime(m.close_req_at)}): ${m.close_req_reason || ''}`),
    mgr ? h('div', { class: 'row', style: { marginTop: '8px', gap: '8px' } },
      btn('Accept & close MRF', { cls: 'sm danger', onClick: act(async () => { await rpc('mrf_close_respond', { p_id: m.id, p_accept: true, p_note: null }); toast('MRF closed', 'warn'); await reload(); }) }),
      btn('Keep open', { cls: 'sm', onClick: act(async () => { const r = await promptBox({ title: 'Keep the MRF open', label: 'Reason', confirmText: 'Keep open' }); if (!r) return; await rpc('mrf_close_respond', { p_id: m.id, p_accept: false, p_note: r }); toast('Kept open'); await reload(); }) })) : null), 'inbox')));
  if (open && m.close_req_state === 'kept_open') out.push(h('div', { class: 'mb' }, banner('info', `Closure request declined by the workshop manager: ${m.close_req_response || ''}`)));
  return out;
}

/** extra store-side action buttons */
export function storeButtons(m, reload) {
  if (!(isStore() && m.store_id === myStoreId() && m.status === 'sent')) return [];
  const b = [];
  if (!['pending', 'approved'].includes(m.wh_state)) b.push(btn('Request Workshop Head approval', { cls: 'sm', icon: 'shield', onClick: act(async () => {
    const t = await promptBox({ title: 'Request Workshop Head approval', message: 'Products cannot be issued against this MRF until the Workshop Head approves it.', label: 'Note for the Workshop Head (optional)', confirmText: 'Request approval', required: false });
    if (t === null) return; await rpc('mrf_request_approval', { p_id: m.id, p_note: t || null }); toast('Approval requested'); await reload();
  }) }));
  if (m.close_req_state !== 'requested') b.push(btn('Request closure', { cls: 'sm', icon: 'ban', onClick: act(async () => {
    const t = await promptBox({ title: 'Ask the workshop to close this MRF', message: 'The workshop manager decides whether to close it or keep it open.', label: 'Reason', confirmText: 'Send request' });
    if (!t) return; await rpc('mrf_close_request', { p_id: m.id, p_reason: t }); toast('Closure request sent'); await reload();
  }) }));
  return b;
}

/** small badges for lists: approval pending / approved / on hold / closure requested */
export function whTags(r) {
  if (r.status !== 'sent') return null;
  const t = [];
  if (r.wh_hold) t.push(badge('On hold', 'danger', true));
  if (r.wh_state === 'pending') t.push(badge('WH approval pending', 'warn', true));
  else if (r.wh_state === 'approved') t.push(badge('WH approved', 'success', true));
  if (r.close_req_state === 'requested') t.push(badge('Closure requested', 'warn', true));
  return t.length ? h('div', { style: { marginTop: '3px', display: 'flex', gap: '4px', flexWrap: 'wrap' } }, t) : null;
}
