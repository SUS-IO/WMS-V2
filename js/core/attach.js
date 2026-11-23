// Attachments for job cards of every type: photos (compressed) and PDFs, kept in Supabase Storage.
// Deleting removes the file for ever. When the card is finalized everything is kept and locked.
import { sb, S, rpc, setting } from './api.js';
import { h, icon, card, btn, iconBtn, act, toast, confirmBox, modal, badge, inp, field, banner } from './ui.js';
import { fmtDateTime, fmtMoney, esc } from './format.js';
import { compressImage, compressPdf, maxPdfBytes, fmtSize } from './compress.js';

const BUCKET = 'job-attachments';


/**
 * kind: 'job_card' | 'consumable' (consumable and facility cards)
 * canAdd: user may add/delete (a workshop user of the card's own workshop - never the administrator) and card is not finalized
 */
export function attachmentsCard({ kind, cardId, workshopId, status, canAdd }) {
  const maxImg = Number(setting('max_images_per_card', 10)); const maxPdf = Number(setting('max_pdfs_per_card', 10));
  const locked = status === 'finalized'; const can = canAdd && !locked;
  const body = h('div'); const count = h('span'); let rows = [];
  const imgIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  const pdfIn = h('input', { type: 'file', accept: 'application/pdf', multiple: true, style: { display: 'none' } });

  async function load() {
    const { data, error } = await sb.from('attachments').select('*').eq('card_kind', kind).eq('card_id', cardId).order('created_at');
    if (error) { body.replaceChildren(h('div', { class: 'small muted', style: { padding: '12px 18px' } }, 'Attachments are not available yet (run patch 13 in Supabase).')); return; }
    rows = data || []; await draw();
  }
  async function draw() {
    const imgs = rows.filter((r) => r.att_type === 'image'); const pdfs = rows.filter((r) => r.att_type === 'pdf');
    count.replaceChildren(badge(`Photos ${imgs.length}/${maxImg}`, 'info', true), ' ', badge(`PDFs ${pdfs.length}/${maxPdf}`, 'teal', true), locked ? ' ' : null, locked ? badge('Locked - finalized', 'success', true) : null);
    let urls = {};
    if (rows.length) { const { data } = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600); (data || []).forEach((u) => { if (u.signedUrl) urls[u.path] = u.signedUrl; }); }
    const del = (r) => (can ? iconBtn('trash', 'Delete for ever', act(() => remove(r))) : null);
    const thumbs = imgs.map((r) => h('div', { style: { position: 'relative', width: '110px' } },
      h('a', { href: urls[r.path] || '#', target: '_blank', rel: 'noopener', title: r.file_name }, h('img', { src: urls[r.path] || '', alt: r.file_name, style: { width: '110px', height: '110px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface-2, #eee)' } })),
      h('div', { style: { position: 'absolute', top: '2px', right: '2px' } }, del(r)), h('div', { class: 'small muted', style: { marginTop: '2px' } }, fmtSize(r.size_bytes))));
    const files = pdfs.map((r) => h('div', { class: 'row between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } },
      h('a', { href: urls[r.path] || '#', target: '_blank', rel: 'noopener', class: 'row', style: { gap: '8px', textDecoration: 'none', color: 'inherit' } }, icon('file'), h('div', null, h('div', { class: 'bold' }, r.file_name), h('div', { class: 'small muted' }, `${fmtSize(r.size_bytes)} · ${fmtDateTime(r.created_at)}`))), del(r)));
    body.replaceChildren(
      !rows.length ? h('div', { class: 'small muted', style: { padding: '4px 0' } }, can ? 'No attachments yet. Photos and PDFs are optional - add them for reference.' : 'No attachments.') : null,
      thumbs.length ? h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', marginBottom: '10px' } }, thumbs) : null, files.length ? h('div', null, files) : null);
  }
  async function remove(r) {
    if (!(await confirmBox({ title: 'Delete this file?', message: `${r.file_name} is deleted for ever. The audit log keeps a note that it was deleted.`, tone: 'danger', confirmText: 'Delete' }))) return;
    const path = await rpc('attach_delete', { p_id: r.id });
    await sb.storage.from(BUCKET).remove([path || r.path]);
    toast('File deleted', 'warn'); await load();
  }
  async function addFiles(files, type) {
    let ok = 0; const errs = []; const notes = [];
    for (const f of files) {
      try {
        const have = rows.filter((r) => r.att_type === type).length; if (have >= (type === 'image' ? maxImg : maxPdf)) throw new Error(`Limit of ${type === 'image' ? maxImg + ' photos' : maxPdf + ' PDFs'} reached`);
        let blob = f;
        if (type === 'image') blob = await compressImage(f);
        else { const r = await compressPdf(f); blob = r.blob; if (r.note) notes.push(`${f.name}: ${r.note}`); if (blob.size > maxPdfBytes()) throw new Error(`${f.name} is ${fmtSize(blob.size)} - larger than the ${fmtSize(maxPdfBytes())} limit. Scan at a lower resolution (150 dpi) or in black & white.`); }
        const name = type === 'image' ? f.name.replace(/\.[^.]+$/, '') + '.jpg' : f.name;
        const path = `${workshopId}/${cardId}/${crypto.randomUUID()}.${type === 'image' ? 'jpg' : 'pdf'}`;
        const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: type === 'image' ? 'image/jpeg' : 'application/pdf', upsert: false });
        if (up.error) throw new Error(up.error.message);
        try { await rpc('attach_register', { p_kind: kind, p_card: cardId, p_type: type, p_name: name, p_path: path, p_size: blob.size }); }
        catch (e) { await sb.storage.from(BUCKET).remove([path]); throw e; }
        ok++; rows.push({ att_type: type }); // keeps the limit check right inside this loop
      } catch (e) { errs.push(e.message || String(e)); }
    }
    if (ok) toast(`${ok} file(s) added${notes.length ? ' (' + notes.join('; ') + ')' : ''}`);
    if (errs.length) toast(errs[0] + (errs.length > 1 ? ` (+${errs.length - 1} more)` : ''), 'error');
    await load();
  }
  imgIn.onchange = act(async () => { const f = [...imgIn.files]; imgIn.value = ''; if (f.length) await addFiles(f, 'image'); });
  pdfIn.onchange = act(async () => { const f = [...pdfIn.files]; imgIn.value = ''; pdfIn.value = ''; if (f.length) await addFiles(f, 'pdf'); });
  load();
  return card({ title: h('div', { class: 'row' }, h('h3', null, 'Attachments'), count), cls: 'mb',
    actions: can ? [btn('Add photos', { cls: 'sm', icon: 'upload', onClick: () => imgIn.click() }), btn('Add PDF', { cls: 'sm', icon: 'upload', onClick: () => pdfIn.click() })] : null,
    body: h('div', null, imgIn, pdfIn, body) });
}

/**
 * Petty cash of a job card (optional). Amount + description; while the card is open the workshop user can add / remove entries.
 * When the card has petty cash it must also carry at least one attachment (bill / receipt) before it can be completed.
 */
export function pettyCashCard({ kind, cardId, status, canAdd }) {
  const can = canAdd && status === 'open'; const body = h('div'); const total = h('span'); let rows = [];
  async function load() {
    const { data, error } = await sb.from('petty_cash').select('*').eq('card_kind', kind).eq('card_id', cardId).order('created_at');
    if (error) { body.replaceChildren(h('div', { class: 'small muted', style: { padding: '8px 18px' } }, 'Petty cash is not available yet (run patch 18 in Supabase).')); return; }
    rows = data || [];
    let needFile = false;
    if (rows.length) { const { count } = await sb.from('attachments').select('id', { count: 'exact', head: true }).eq('card_kind', kind).eq('card_id', cardId); needFile = !count; }
    const sum = rows.reduce((a, r) => a + Number(r.amount), 0);
    total.replaceChildren(rows.length ? badge('Total ' + fmtMoney(sum), 'warn', true) : null);
    body.replaceChildren(
      needFile ? banner('warn', 'This card has petty cash - attach the bill / receipt (a photo or PDF, below) before the card can be completed.') : null,
      !rows.length ? h('div', { class: 'small muted', style: { padding: '4px 0' } }, can ? 'No petty cash. Optional - add an entry if cash was spent on this job (bill / receipt attachment becomes mandatory).' : 'No petty cash.') : null,
      ...rows.map((r) => h('div', { class: 'row between', style: { padding: '8px 0', borderTop: '1px solid var(--border)' } },
        h('div', null, h('div', { class: 'bold' }, r.description), h('div', { class: 'small muted' }, fmtDateTime(r.created_at))),
        h('div', { class: 'row nowrap' }, h('b', null, fmtMoney(r.amount)), can ? iconBtn('trash', 'Remove', act(async () => { await rpc('pc_delete', { p_id: r.id }); toast('Petty cash removed', 'warn'); await load(); })) : null))));
  }
  function addForm() {
    const amt = inp({ type: 'number', min: '0', step: '0.01', placeholder: 'Amount' }); const desc = inp({ placeholder: 'What was it spent on?' });
    const m = modal({ title: 'Add petty cash', size: 'sm', content: h('div', { class: 'col' }, field('Amount', amt, { required: true }), field('Description', desc, { required: true })),
      foot: [btn('Cancel', { onClick: () => m.close() }), btn('Add', { cls: 'primary', onClick: act(async () => {
        await rpc('pc_add', { p_kind: kind, p_card: cardId, p_amount: Number(amt.value), p_desc: desc.value });
        toast('Petty cash added'); m.close(); await load();
      }) })] });
  }
  load();
  return card({ title: h('div', { class: 'row' }, h('h3', null, 'Petty cash'), total), cls: 'mb', actions: can ? [btn('Add petty cash', { cls: 'sm', icon: 'plus', onClick: addForm })] : null, body });
}
