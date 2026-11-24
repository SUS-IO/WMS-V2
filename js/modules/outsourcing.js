// Outsourcing requests: the workshop describes what it needs, the store accepts / rejects, then sends delivery challans.
// (An outsourcing request is an MRF of type 'outsourcing' that belongs to an Outsourcing Job Card.)
import { sb, run, rpc, isWs, isManager, isStore, myWorkshopId, myStoreId, wsName, storeName, vehicleById, productById, userName, storeOptions, companyOptions, lockDoc, unlockDoc } from '../core/api.js';
import { h, card, btn, field, textarea, act, toast, statusBadge, badge, confirmBox, promptBox, banner, kv } from '../core/ui.js';
import { selectBox } from '../core/select.js';
import { navigate } from '../core/router.js';
import { autosaver } from '../core/autosave.js';
import { printPreview } from '../core/print.js';
import { fmtDateTime } from '../core/format.js';
import { mrfPrintHtml } from './mrf.js';

const dcTone = { draft: 'muted', issued: 'warn', acknowledged: 'ok', reversed: 'danger' };
const dcText = (d, forStore) => (d.status === 'issued' ? (forStore ? 'Sent - waiting for workshop' : 'Awaiting your accept / reject')
  : d.status === 'acknowledged' ? 'Accepted' : d.status === 'draft' ? (d.reject_count ? 'Rejected - correct and re-send' : 'Draft') : 'Reversed');

function jobBlock(jc, cjc) {
  if (cjc) { const p = productById(cjc.sp_product_id); return kv([['Spare job card', h('a', { href: `#/sjc/${cjc.id}` }, cjc.cjc_no)], ['Item being refurbished', p ? `${p.item_code} - ${p.description}` : '—'], ['Quantity', cjc.sp_qty], ['Refurbishing work', cjc.remarks]]); }
  const v = vehicleById(jc?.vehicle_id);
  return jc ? kv([['Outsourcing job card', h('a', { href: `#/ojc/${jc.id}` }, jc.jc_no)], ['Vehicle', v?.reg_no], ['Complaint type', jc.complaint_type], ['Complaint', jc.complaint]]) : null;
}

/* =================================================================== WORKSHOP SIDE */
export async function workshopDetail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root, isForm: false };
  let m, jc, cjc, dcs = []; let canEdit = false; let lockMsg = null; let auto = null; let st = null;

  async function load() {
    m = await run(sb.from('mrfs').select('*').eq('id', id).maybeSingle()); if (!m) throw new Error('Request not found or no access.');
    jc = m.job_card_id ? await run(sb.from('job_cards').select('*').eq('id', m.job_card_id).maybeSingle()) : null;
    cjc = m.cjc_id ? await run(sb.from('consumable_jcs').select('*').eq('id', m.cjc_id).maybeSingle()) : null;
    dcs = (await run(sb.from('delivery_challans').select('*').eq('mrf_id', id).order('created_at'))).filter((d) => d.status !== 'draft');
  }
  const editable = () => isWs() && m.workshop_id === myWorkshopId() && ['draft', 'returned'].includes(m.status);
  async function acquire() { canEdit = false; lockMsg = null; if (!editable()) return; const r = await lockDoc('mrf', id); if (r.ok) canEdit = true; else lockMsg = `${r.holder} is editing this request right now.`; }
  async function reloadAll() { if (auto) await auto.flush().catch(() => {}); const had = canEdit; await load(); await acquire(); if (had && !canEdit) await unlockDoc('mrf', id); draw(); }
  async function save() {
    if (!canEdit || !st) return;
    const patch = { remarks: st.desc.value || null, company_id: st.company.getValue() || null }; if (m.status === 'draft') patch.store_id = st.store.getValue();
    await run(sb.from('mrfs').update(patch).eq('id', id)); Object.assign(m, patch);
  }

  function stateBanner() {
    if (m.status === 'returned') return banner('warn', h('span', null, h('b', null, 'Rejected by the store: '), m.return_reason || '', ' - correct the description and re-send.'));
    if (m.status === 'closed') return banner('info', `Closed ${fmtDateTime(m.closed_at)}${m.close_reason ? ' - ' + m.close_reason : ''}. The store can no longer issue anything against it.`, 'lock');
    if (m.status === 'sent' && m.os_state === 'accepted') return banner('ok', `Accepted by the store on ${fmtDateTime(m.accepted_at)}. Deliveries will appear below - accept or reject each delivery as a whole.`);
    if (m.status === 'sent') return banner('info', 'Waiting for the store to accept or reject this request. The vehicle details of the job card are now locked.', 'lock');
    return null;
  }

  function draw() {
    root.replaceChildren(); view.isForm = canEdit; auto = canEdit ? autosaver({ save }) : null;
    ctx.setTitle(m.mrf_no || 'New outsourcing request', wsName(m.workshop_id));
    const dis = !canEdit; const returned = m.status === 'returned';
    const storeSel = selectBox({ options: storeOptions(true), value: m.store_id, disabled: dis || returned, clearable: false, placeholder: 'Select store', onChange: () => auto?.trigger() });
    const companySel = selectBox({ options: companyOptions(true, m.company_id), value: m.company_id, disabled: dis, clearable: false, placeholder: 'Select company', onChange: () => auto?.trigger() });
    const desc = textarea({ value: m.remarks || '', disabled: dis, rows: 6, placeholder: 'Brief description of the request - what work is outsourced, what is needed from the store...' });
    desc.addEventListener('input', () => auto?.trigger());
    st = { store: storeSel, company: companySel, desc };

    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: act(print) })];
    if (canEdit && m.status === 'draft') acts.push(btn('Delete draft', { cls: 'danger ghost sm', icon: 'trash', onClick: act(delDraft) }));
    if (canEdit) acts.push(btn(returned ? 'Re-send to store' : 'Send to store', { cls: 'primary', icon: 'send', onClick: act(send) }));
    if (isManager() && m.workshop_id === myWorkshopId() && ['sent', 'returned'].includes(m.status)) acts.push(btn('Close request', { cls: 'danger ghost sm', icon: 'ban', onClick: act(closeReq) }));

    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, m.mrf_no || 'New outsourcing request'), badge('Outsourcing', 'purple', true), statusBadge('mrf', m.status)),
        h('p', null, `${wsName(m.workshop_id)}${jc ? ' · ' + (jc.jc_no || '') : cjc ? ' · ' + (cjc.cjc_no || '') : ''}`)), h('div', { class: 'actions' }, auto ? auto.el : null, acts)),
      lockMsg ? h('div', { class: 'mb' }, banner('warn', lockMsg)) : null,
      stateBanner() ? h('div', { class: 'mb' }, stateBanner()) : null,
      card({ title: 'Request', cls: 'mb', body: h('div', { class: 'col' },
        h('div', { class: 'form-grid' }, field('Store', storeSel, { required: true }), field('Company', companySel, { required: true, hint: 'For documentation only - printed on the request and its delivery challans.' })),
        field('Description', desc, { required: true, hint: 'Locked together with the vehicle details once sent. The store can accept it, or reject it with a reason so you can correct and re-send.' }),
        jobBlock(jc, cjc)) }),
      dcs.length ? deliveries() : null);
  }

  function deliveries() {
    return card({ title: 'Deliveries from the store', cls: 'mb', flush: true, body: h('table', { class: 'dt stack' },
      h('thead', null, h('tr', null, ['Challan', 'Reference', 'Status', 'Issued', ''].map((x) => h('th', null, x)))),
      h('tbody', null, dcs.map((d) => h('tr', null, h('td', null, h('a', { class: 'bold mono', href: `#/receipts/${d.id}` }, d.dc_no || 'DC')), h('td', null, [d.ref_number, d.ref_vendor].filter(Boolean).join(' · ') || d.ref_details || '—'),
        h('td', null, badge(dcText(d, false), dcTone[d.status] || 'muted', true)), h('td', null, fmtDateTime(d.issued_at)), h('td', null, h('a', { href: `#/receipts/${d.id}` }, d.status === 'issued' ? 'Review' : 'Open')))))) });
  }

  async function print() { if (auto) await auto.flush().catch(() => {}); printPreview(m.mrf_no || 'Outsourcing request', mrfPrintHtml({ ...m, remarks: canEdit ? st.desc.value : m.remarks }, [], jc || (cjc ? { jc_no: cjc.cjc_no } : null))); }
  async function send() {
    if (!st.store.getValue()) { st.store.markInvalid(); throw new Error('Select the store'); }
    if (!st.desc.value.trim()) { st.desc.classList.add('invalid'); throw new Error('Write a brief description of the request'); }
    await auto.flush(); const no = await rpc('mrf_send', { p_id: id }); toast(`Request ${no} sent to ${storeName(st.store.getValue())}`); await reloadAll();
  }
  async function delDraft() {
    if (!(await confirmBox({ title: 'Delete this draft request?', message: 'This cannot be undone.', tone: 'danger', confirmText: 'Delete' }))) return;
    auto.disable(); canEdit = false; await run(sb.from('mrfs').delete().eq('id', id)); toast('Draft deleted'); navigate(m.cjc_id ? `/sjc/${m.cjc_id}` : `/ojc/${m.job_card_id}`);
  }
  async function closeReq() {
    const r = await promptBox({ title: `Close ${m.mrf_no}`, message: 'The store will no longer be able to issue anything against this request.', label: 'Reason', tone: 'danger', confirmText: 'Close request' });
    if (!r) return; await rpc('mrf_close', { p_id: id, p_reason: r }); toast('Request closed', 'warn'); await reloadAll();
  }

  await load(); await acquire(); draw();
  view.flush = async () => { if (auto) await auto.flush(); };
  view.destroy = async () => {
    if (canEdit) {
      try { if (auto) await auto.flush(); } catch { /* ignore */ }
      try { if (m.status === 'draft' && !st.desc.value.trim() && !st.store.getValue()) await sb.from('mrfs').delete().eq('id', id).eq('status', 'draft'); } catch { /* ignore */ }
      await unlockDoc('mrf', id);
    }
  };
  view.refresh = async () => { if (canEdit || document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}

/* =================================================================== STORE SIDE */
export async function storeDetail(ctx) {
  const id = ctx.params.id; const root = h('div'); const view = { el: root };
  let m, jc, cjc, dcs = [];
  async function load() {
    m = await run(sb.from('mrfs').select('*').eq('id', id).maybeSingle()); if (!m || m.status === 'draft') throw new Error('Request not found.');
    [jc, dcs] = await Promise.all([m.job_card_id ? run(sb.from('job_cards').select('*').eq('id', m.job_card_id).maybeSingle()) : Promise.resolve(null), run(sb.from('delivery_challans').select('*').eq('mrf_id', id).order('created_at'))]);
    cjc = m.cjc_id ? await run(sb.from('consumable_jcs').select('*').eq('id', m.cjc_id).maybeSingle()) : null;
  }
  const mine = () => isStore() && m.store_id === myStoreId();
  function draw() {
    root.replaceChildren(); ctx.setTitle(m.mrf_no, storeName(m.store_id));
    const open = m.status === 'sent'; const pending = open && m.os_state !== 'accepted'; const accepted = open && m.os_state === 'accepted';
    const acts = [btn('Print', { cls: 'sm', icon: 'printer', onClick: () => printPreview(m.mrf_no, mrfPrintHtml(m, [], jc || (cjc ? { jc_no: cjc.cjc_no } : null))) })];
    if (mine() && pending) acts.push(btn('Reject', { cls: 'sm danger ghost', icon: 'undo', onClick: act(reject) }), btn('Accept request', { cls: 'primary', icon: 'check', onClick: act(accept) }));
    if (mine() && accepted) acts.push(btn('Create delivery challan', { cls: 'primary', icon: 'truck', onClick: act(newDc) }));
    root.append(
      h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'row' }, h('h1', null, m.mrf_no), badge('Outsourcing', 'purple', true), statusBadge('mrf', m.status), accepted ? badge('Accepted', 'ok', true) : null, m.revision ? badge(`Revision ${m.revision}`, 'purple', true) : null),
        h('p', null, `${wsName(m.workshop_id)} · received ${fmtDateTime(m.sent_at)} · ${userName(m.created_by)}`)), h('div', { class: 'actions' }, acts)),
      m.status === 'closed' ? h('div', { class: 'mb' }, banner('danger', `Closed: ${m.close_reason || ''}. Nothing can be issued against this request any more.`, 'lock')) : null,
      m.status === 'returned' ? h('div', { class: 'mb' }, banner('warn', `Rejected and returned to the workshop: ${m.return_reason || ''}`)) : null,
      pending ? h('div', { class: 'mb' }, banner('info', 'Accept the request to start sending materials with delivery challans, or reject it with a reason so the workshop can correct and re-send it.')) : null,
      card({ title: 'Request from the workshop', cls: 'mb', body: h('div', { class: 'col' }, h('div', { style: { whiteSpace: 'pre-wrap', fontSize: '15px' } }, m.remarks || '—'), jobBlock(jc, cjc)) }),
      card({ title: 'Delivery challans for this request', cls: 'mb', flush: !!dcs.length, body: dcs.length ? h('table', { class: 'dt stack' },
        h('thead', null, h('tr', null, ['DC no', 'Reference', 'Status', 'Created', ''].map((x) => h('th', null, x)))),
        h('tbody', null, dcs.map((d) => h('tr', null, h('td', null, h('a', { class: 'bold mono', href: `#/dcs/${d.id}` }, d.dc_no || 'Draft')), h('td', null, [d.ref_number, d.ref_vendor].filter(Boolean).join(' · ') || d.ref_details || '—'),
          h('td', null, badge(dcText(d, true), dcTone[d.status] || 'muted', true), d.reject_reason ? h('div', { class: 'small', style: { color: 'var(--danger)' } }, `Workshop: ${d.reject_reason}`) : null),
          h('td', null, fmtDateTime(d.created_at)), h('td', null, h('a', { href: `#/dcs/${d.id}` }, d.status === 'draft' ? 'Open / edit' : 'Open')))))) :
        h('div', { class: 'muted' }, accepted ? 'No delivery challans yet. You can issue several challans against this request.' : 'None yet.') }));
  }
  async function accept() { await rpc('os_accept', { p_id: id }); toast('Request accepted'); await load(); draw(); }
  async function reject() {
    const r = await promptBox({ title: 'Reject this request', message: 'The workshop will see your reason, can correct the description and re-send.', label: 'Reason', confirmText: 'Reject request', tone: 'danger' });
    if (!r) return; await rpc('mrf_return', { p_id: id, p_reason: r }); toast('Request returned to the workshop', 'warn'); await load(); draw();
  }
  async function newDc() { const r = await run(sb.from('delivery_challans').insert({ store_id: m.store_id, mrf_id: id }).select('id').single()); navigate(`/dcs/${r.id}`); }
  await load(); draw();
  view.refresh = async () => { if (document.querySelector('.overlay')) return; await load(); draw(); };
  return view;
}
