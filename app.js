(function () {
'use strict';
/* ================= ระบบ QR ทะเบียนทรัพย์สิน — หน้าเว็บ ================= */
const ORG_NAME = 'Major Property Service Co., Ltd.';
const CREATED_BY = 'ADM-PR';
const S = { cfg: null, units: [], unit: null, places: null, assets: null, tab: 'home', imp: null, add: { recent: [] }, qr: { loc: '', rows: {}, per: 20 }, xl: null, list: { loc: '', q: '' }, uedit: null };

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
/* Apps Script แปลง HTML entity ในสคริปต์ → ห้ามเขียน entity ตรง ๆ ในโค้ด ให้ประกอบจากรหัสอักษรแทน */
const AMP = String.fromCharCode(38);
const ESC_MAP = { '<': AMP + 'lt;', '>': AMP + 'gt;', '"': AMP + 'quot;', "'": AMP + '#39;' };
ESC_MAP[AMP] = AMP + 'amp;';
function esc(s) { return String(s ?? '').replace(new RegExp('[' + AMP + '<>"\']', 'g'), c => ESC_MAP[c]); }
function lsGet(k) { try { return localStorage.getItem('qrreg_' + k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem('qrreg_' + k, v); } catch (e) { /* ignore */ } }
let toastT = 0;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, err ? 7000 : 3500);
}
let busyN = 0;
function busy(on, text) {
  busyN = Math.max(0, busyN + (on ? 1 : -1));
  if (text) $('#busyText').textContent = text;
  $('#busy').style.display = busyN ? 'flex' : 'none';
}
/* ช่องทางเรียกเซิร์ฟเวอร์: เปิดจาก Apps Script → google.script.run · เปิดจาก GitHub Pages → fetch ไปที่ Apps Script (/exec) */
const HAS_GAS = !!(window.google && google.script && google.script.run);
const API_URL = String((window.QR_CONFIG && window.QR_CONFIG.apiUrl) || '').trim();
function rawRun(fn, ...args) {
  if (HAS_GAS) return new Promise((res, rej) => {
    const r = google.script.run.withSuccessHandler(res).withFailureHandler(e => rej(e instanceof Error ? e : new Error((e && e.message) || String(e))));
    r[fn](...args);
  });
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(API_URL)) return Promise.reject(new Error('ยังไม่ได้ใส่ลิงก์ Apps Script (/exec) ในไฟล์ config.js'));
  return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ fn, args }), redirect: 'follow' })
    .then(r => r.text(), () => { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ต หรือการ Deploy Apps Script (ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน)'); })
    .then(t => {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Apps Script ตอบกลับไม่ถูกต้อง — ตรวจว่า Deploy เป็นเวอร์ชันใหม่ และตั้ง “ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน”'); }
      if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
      return j.result;
    });
}
const PUBLIC_FNS = ['getConfig', 'login', 'setupInfo', 'setPassword', 'requestReset'];
function run(fn, ...args) {
  if (PUBLIC_FNS.includes(fn)) return rawRun(fn, ...args);
  return rawRun('rpc', S.session, fn, args).catch(e => {
    const m = String(e && e.message || '');
    if (/SESSION_EXPIRED/.test(m)) { sessionExpired(); throw new Error('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่'); }
    if (/MUST_CHANGE_PASSWORD/.test(m)) { changePasswordDialog(true); throw new Error('กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน'); }
    throw e;
  });
}
const api = (action, payload) => run('api', action, payload || {});
async function guard(fn, text) {
  busy(true, text || 'กำลังทำงาน…');
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || String(e), true); return undefined; }
  finally { busy(false); }
}
function isUnitUser() { return !!(S.user && S.user.role === 'unit'); }
function cardUrl(code, extra) {
  const u = S.unit; const fn = (u && u.card_fn) || 'card';
  return `${S.cfg.supabaseUrl}/functions/v1/${fn}?code=${encodeURIComponent(code)}${extra || ''}`;
}
function thumb(fid, sz) { return fid ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(fid)}&sz=w${sz || 160}` : ''; }
function codeLoc(code) { const p = String(code || '').split('.'); return p.length >= 3 ? p.slice(1, -1).join('.') : ''; }
function codeSeq(code) { const m = /(\d{3})$/.exec(code || ''); return m ? Number(m[1]) : null; }
function placeName(loc) { const p = (S.places || []).find(x => x.loc === loc); return p ? (p.location || loc) : loc; }
function validCode(code) { return !!S.unit && new RegExp('^' + S.unit.prefix + '(\\.[A-Za-z0-9_-]+)+\\.\\d{9}$').test(code || ''); }
function blankish(v) { v = String(v ?? '').trim(); return v === '' || v === '-' ? '' : v; }
function shortName(name) { let s = String(name || '').split(/,|\s\(/)[0].trim(); if (s.length > 24) s = s.slice(0, 23) + '…'; return s; }
function fileNameFor(a, ext) {
  /* รูปแบบมาตรฐาน: รหัส (ชื่อ)(ราคา)(ระยะเวลาประกัน)(เลขใบ PV)(วันที่จัดซื้อ)(หมายเหตุ) */
  const na = v => (/^N\/?A$/i.test(String(v || '').trim()) ? '' : blankish(v));
  const parts = [a.name, a.price, a.warranty, a.pv, a.purchase_date, a.note].map(na);
  while (parts.length > 1 && !parts[parts.length - 1]) parts.pop();
  const br = parts.map((v, i) => `(${v || (i === 1 || i === 2 ? 'N/A' : '-')})`).join('');
  return `${a.code} ${br}${ext || ''}`.replace(/[\u0000-\u001f]/g, ' ');
}
function readFileAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('อ่านไฟล์ไม่ได้')); r.readAsDataURL(file); }); }
function loadImg(src) { return new Promise(res => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }); }
async function resizePhoto(file, maxSide = 1600) {
  const url = await readFileAsDataURL(file);
  const im = await loadImg(url);
  if (!im) return { b64: url.split(',')[1], mime: file.type || 'image/jpeg', ext: (file.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0] };
  const sc = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  const d = c.toDataURL('image/jpeg', 0.86);
  return { b64: d.split(',')[1], mime: 'image/jpeg', ext: '.jpg', preview: d };
}
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/* ---------- data ---------- */
async function loadUnits() {
  const r = await api('units.list', {});
  S.units = r.units || [];
  const sel = $('#unitSel');
  sel.innerHTML = S.units.map(u => `<option value="${esc(u.prefix)}">${esc(u.prefix)} · ${esc(u.name)}${u.active === false ? ' (ปิด)' : ''}</option>`).join('');
  if (S.unit) { S.unit = S.units.find(u => u.prefix === S.unit.prefix) || S.units[0] || null; if (S.unit) sel.value = S.unit.prefix; }
}
function selectUnit(prefix) {
  S.unit = S.units.find(u => u.prefix === prefix) || null;
  S.places = null; S.assets = null; S.imp = null; S.xl = null; S.add = { recent: [] }; S.qr = { loc: '', rows: {}, per: S.qr.per || 20 }; S.list = { loc: '', q: '' };
  if (S.unit) { $('#unitSel').value = S.unit.prefix; lsSet('unit', S.unit.prefix); }
}
async function ensureData(force) {
  if (!S.unit) return;
  const p = S.unit.prefix;
  const jobs = [];
  if (force || !S.places) jobs.push(api('places.list', { prefix: p }).then(r => { S.places = r.places || []; }));
  if (force || !S.assets) jobs.push(api('assets.list', { prefix: p }).then(r => { S.assets = r.assets || []; }));
  await Promise.all(jobs);
}
function placesWithCounts() {
  const m = new Map();
  for (const p of S.places || []) m.set(p.loc, { ...p, count: 0 });
  for (const a of S.assets || []) {
    const loc = codeLoc(a.code); if (!m.has(loc)) m.set(loc, { prefix: S.unit.prefix, loc, location: a.location, drive_folder_id: null, count: 0 });
    m.get(loc).count++;
  }
  return Array.from(m.values()).sort((a, b) => a.loc.localeCompare(b.loc));
}
function placeOptions(selected, withAll, allLabel) {
  const ps = placesWithCounts();
  return (withAll ? `<option value="">${esc(allLabel || 'ทุกสถานที่')}</option>` : '') +
    ps.map(p => `<option value="${esc(p.loc)}"${p.loc === selected ? ' selected' : ''}>${esc(p.location || p.loc)} (${esc(p.loc)}) · ${p.count}</option>`).join('');
}

/* ---------- router ---------- */
const VIEWS = {};
const TITLES = { home: 'ภาพรวม', import: 'นำเข้าจาก Drive', add: 'เพิ่มทรัพย์สิน', list: 'รายการ / แก้ไข', excel: 'Excel นำเข้า / ส่งออก', qr: 'ทำ QR PDF', units: 'ตั้งค่าหน่วยงาน', users: 'ผู้ใช้ระบบ', manual: 'คู่มือการใช้งาน' };
async function go(tab) {
  S.tab = tab; lsSet('tab', tab);
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const pt = $('#pageTitle'); if (pt) pt.textContent = TITLES[tab] || '';
  document.body.classList.remove('nav-open');
  const main = $('#main');
  if (!S.unit && tab !== 'units' && tab !== 'home' && tab !== 'manual' && tab !== 'users') { main.innerHTML = `<div class="card empty">ยังไม่มีหน่วยงาน — ${isUnitUser() ? 'แจ้งผู้ดูแลระบบ (ADM-PR) ให้เพิ่มสิทธิ์หน่วยงานให้บัญชีนี้' : 'ไปที่ “ตั้งค่าหน่วยงาน” เพื่อเพิ่ม'}</div>`; return; }
  if (tab !== 'units' && tab !== 'manual' && tab !== 'users') await guard(() => ensureData(), 'กำลังโหลดข้อมูลหน่วยงาน…');
  main.innerHTML = '';
  try { await VIEWS[tab](main); } catch (e) { console.error(e); main.innerHTML = `<div class="card note">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}

/* =================== ภาพรวม =================== */
function ago(t) {
  if (!t) return '';
  const d = new Date(t); if (isNaN(d)) return '';
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'เมื่อสักครู่'; if (m < 60) return m + ' นาทีที่แล้ว';
  const h = Math.round(m / 60); if (h < 24) return h + ' ชม.ที่แล้ว';
  const dd = Math.round(h / 24); if (dd < 30) return dd + ' วันที่แล้ว';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
const ICONS = {"users": "<circle cx=\"9\" cy=\"8\" r=\"3.2\"/><path d=\"M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5\"/><circle cx=\"17\" cy=\"9\" r=\"2.5\"/><path d=\"M16 13.6c2.8.1 5 2 5 5\"/>", "home": "<path d=\"M3 11.5 12 4l9 7.5\"/><path d=\"M5 10v10h14V10\"/><path d=\"M10 20v-6h4v6\"/>", "import": "<path d=\"M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 8a4.5 4.5 0 0 1 .5 9\"/><path d=\"M12 12v8\"/><path d=\"m8.5 16.5 3.5 3.5 3.5-3.5\"/>", "add": "<path d=\"M4 8h3l2-3h6l2 3h3v11H4z\"/><circle cx=\"12\" cy=\"13\" r=\"3.5\"/>", "list": "<path d=\"M9 6h11M9 12h11M9 18h11\"/><circle cx=\"4.5\" cy=\"6\" r=\"1\"/><circle cx=\"4.5\" cy=\"12\" r=\"1\"/><circle cx=\"4.5\" cy=\"18\" r=\"1\"/>", "excel": "<rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M4 9h16M4 15h16M10 3v18\"/>", "qr": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><path d=\"M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3\"/>", "book": "<path d=\"M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z\"/><path d=\"M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5\"/><path d=\"M8.5 7.5h7M8.5 11h5\"/>", "pin": "<path d=\"M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.5\"/>", "box": "<path d=\"M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z\"/><path d=\"M3 7.5 12 12l9-4.5M12 12v9\"/>", "clock": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7.5V12l3 2\"/>", "check": "<path d=\"M4 12.5 9.5 18 20 6.5\"/>", "units": "<path d=\"M4 21V8l8-5 8 5v13\"/><path d=\"M9 21v-6h6v6\"/><path d=\"M9 10h.01M15 10h.01\"/>"};
function icon(k) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`; }
VIEWS.home = async (main) => {
  const total = S.units.reduce((s, u) => s + (u.asset_count || 0), 0);
  const ps = S.unit ? placesWithCounts() : [];
  const now = new Date();
  const hr = now.getHours();
  const hello = hr < 12 ? 'สวัสดีตอนเช้า' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const dateTh = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const u = S.unit;
  const A = u ? (S.assets || []) : [];
  const filled = v => { v = String(v ?? '').trim(); return !!v && !/^(N\/?A|-|ไม่มี)$/i.test(v); };
  const comp = [['มีรูปถ่าย', a => !!a.drive_file_id], ['ราคา', a => filled(a.price)], ['ระยะเวลาประกัน', a => filled(a.warranty)], ['ใบ PV', a => filled(a.pv)], ['วันที่จัดซื้อ', a => filled(a.purchase_date)]]
    .map(([label, f]) => { const n = A.filter(f).length; return { label, n, pct: A.length ? Math.round(n * 100 / A.length) : 0 }; });
  const broken = A.filter(a => /ซาก|ชำรุด/.test(a.note || '')).length;
  const recent = A.slice().sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))).slice(0, 6);
  main.innerHTML = `
  <section class="hero">
    <div class="eyebrow">${esc(dateTh)}</div>
    <h2>${hello} — ${u ? esc(u.name) : 'ระบบ QR ทะเบียนทรัพย์สิน'}</h2>
    <p>นำเข้าหรือเพิ่มทรัพย์สิน → ตรวจ/แก้ไขข้อมูล → ทำ QR PDF ไปติดหน้างาน · สติกเกอร์ที่ติดแล้วใช้ต่อได้เสมอ แก้ข้อมูลเมื่อไหร่การ์ดเปลี่ยนตาม</p>
  </section>
  <div class="qa">
    <button data-go="import"><span class="ic">${icon('import')}</span><span><b>นำเข้าจาก Drive</b><span>อ่านรูปทั้งโฟลเดอร์ทีเดียว</span></span></button>
    <button data-go="add"><span class="ic">${icon('add')}</span><span><b>เพิ่มทรัพย์สิน</b><span>ถ่ายรูป + กรอกข้อมูล</span></span></button>
    <button data-go="excel"><span class="ic">${icon('excel')}</span><span><b>Excel</b><span>เติมวันที่จัดซื้อ ราคา PV</span></span></button>
    <button data-go="qr"><span class="ic or">${icon('qr')}</span><span><b>ทำ QR PDF</b><span>20 ดวง/หน้า A4</span></span></button>
  </div>
  <div class="stats">
    <div class="stat"><span class="si">${icon('units')}</span><div><b>${S.units.length}</b><span>${isUnitUser() ? 'หน่วยงานของคุณ' : 'หน่วยงานในระบบ'}</span></div></div>
    <div class="stat"><span class="si">${icon('box')}</span><div><b>${total.toLocaleString('th-TH')}</b><span>ทรัพย์สินทั้งหมด</span></div></div>
    <div class="stat"><span class="si or">${icon('pin')}</span><div><b>${u ? ps.length : '-'}</b><span>สถานที่ของ ${esc(u ? u.prefix : '')}</span></div></div>
    <div class="stat"><span class="si sky">${icon('qr')}</span><div><b>${u ? A.length.toLocaleString('th-TH') : '-'}</b><span>ทรัพย์สินของ ${esc(u ? u.prefix : '')}</span></div></div>
  </div>
  ${u ? `<div class="duo">
    <section class="panel">
      <div class="ph"><h3>ความครบถ้วนของข้อมูล</h3><span class="muted small">${esc(u.prefix)} · ${A.length.toLocaleString('th-TH')} รายการ</span></div>
      ${A.length ? `<div class="bars">${comp.map(c => `<div class="bar"><div class="bl"><span>${esc(c.label)}</span><b>${c.n.toLocaleString('th-TH')} <i>/ ${A.length.toLocaleString('th-TH')}</i></b></div>
        <div class="track"><div class="fill ${c.pct >= 80 ? 'hi' : c.pct >= 40 ? 'mid' : 'lo'}" style="width:${c.pct}%"></div></div><div class="pc">${c.pct}%</div></div>`).join('')}</div>
      <div class="ph-foot">${broken ? `<span class="pill err">ชำรุด / ซาก ${broken.toLocaleString('th-TH')} รายการ</span>` : '<span class="pill ok">ไม่มีรายการชำรุด</span>'}<button class="btn sm sec" data-go="excel">เติมข้อมูลด้วย Excel →</button></div>`
      : '<div class="empty">ยังไม่มีทรัพย์สินในหน่วยงานนี้</div>'}
    </section>
    <section class="panel">
      <div class="ph"><h3>แก้ไขล่าสุด</h3><button class="btn sm sec" data-go="list">ดูทั้งหมด</button></div>
      ${recent.length ? `<ul class="recent">${recent.map(a => `<li><span class="rt">${a.drive_file_id ? `<img loading="lazy" src="${thumb(a.drive_file_id)}" alt="">` : icon('box')}</span>
        <span class="rm"><b>${esc(a.name || '-')}</b><span><code>${esc(a.code)}</code> · ${esc(a.location || a.loc || '')}</span></span>
        <span class="rd">${esc(ago(a.updated_at || a.created_at))}</span></li>`).join('')}</ul>` : '<div class="empty">ยังไม่มีข้อมูล</div>'}
    </section>
  </div>` : ''}
  <div class="sect"><h3>หน่วยงาน</h3><span class="muted small">กดการ์ดเพื่อสลับหน่วยงาน</span></div>
  <div class="unitcards">${S.units.map(x => {
    const t = x.theme || {}; const sel = u && x.prefix === u.prefix;
    return `<div class="ucard${sel ? ' sel' : ''}" data-u="${esc(x.prefix)}"><div class="hd" style="background:linear-gradient(110deg,${esc(t.head1 || '#22562A')},${esc(t.head2 || '#173D1C')});border-bottom:4px solid ${esc(t.accent || '#86BD41')}">
      <b>${esc(x.prefix)}</b><span style="font-size:13px;opacity:.92;text-align:right;line-height:1.3">${esc(x.name)}</span></div>
      <div class="bd"><span><strong>${(x.asset_count || 0).toLocaleString('th-TH')}</strong> รายการ</span>${sel ? '<span class="pill ok">กำลังใช้งาน</span>' : '<span>เลือก →</span>'}</div></div>`;
  }).join('')}</div>
  ${u ? `<div class="sect"><h3>สถานที่ของ ${esc(u.name)}</h3><span class="muted small">${ps.length} สถานที่</span></div>
    ${ps.length ? `<div class="tablewrap"><table><thead><tr><th>รหัสสถานที่</th><th>ชื่อสถานที่</th><th style="text-align:right">จำนวน</th><th>โฟลเดอร์ Drive</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr><td><code>${esc(p.loc)}</code></td><td>${esc(p.location || '')}</td><td style="text-align:right;font-variant-numeric:tabular-nums"><b>${p.count}</b></td>
      <td>${p.drive_folder_id ? `<a href="https://drive.google.com/drive/folders/${esc(p.drive_folder_id)}" target="_blank">เปิดโฟลเดอร์ ↗</a>` : '<span class="pill gray">ยังไม่ผูก</span>'}</td>
      <td><div class="row" style="justify-content:flex-end"><button class="btn sm sec" data-act="list" data-loc="${esc(p.loc)}">ดูรายการ</button><button class="btn sm accent" data-act="qr" data-loc="${esc(p.loc)}">ทำ QR</button></div></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty">ยังไม่มีสถานที่ — เริ่มจาก “นำเข้าจาก Drive” หรือ “เพิ่มทรัพย์สิน”</div>'}` : ''}`;
  $$('.ucard', main).forEach(el => el.onclick = () => { selectUnit(el.dataset.u); go('home'); });
  $$('[data-go]', main).forEach(b => b.onclick = () => go(b.dataset.go));
  $$('button[data-act]', main).forEach(b => b.onclick = () => {
    if (b.dataset.act === 'list') { S.list.loc = b.dataset.loc; go('list'); } else { S.qr.loc = b.dataset.loc; go('qr'); }
  });
};

/* =================== นำเข้าจาก Drive =================== */
function parseFileName(fname, prefix) {
  const out = { flags: [] };
  let s = String(fname).replace(/\.(jpe?g|png|heic|heif|webp|gif|bmp)$/i, '').replace(/（/g, '(').replace(/）/g, ')').trim();
  const i = s.indexOf('(');
  const head = (i < 0 ? s : s.slice(0, i)).trim();
  const br = []; (i < 0 ? '' : s.slice(i)).replace(/\(([^()]*)\)/g, (m, x) => { br.push(x.trim()); return m; });
  let code = head.replace(/\s+/g, ''), extraName = '';
  const m0 = head.match(/^([A-Za-z][A-Za-z0-9._\s-]*?\d{6,})\s*(.*)$/);
  if (m0) { code = m0[1].replace(/\s+/g, ''); extraName = m0[2].trim(); }
  if (/\s/.test(head.slice(0, m0 ? m0[1].length : head.length))) out.flags.push('ตัดช่องว่างในรหัส');
  const parts = code.split('.').filter(Boolean);
  let last = parts[parts.length - 1] || '';
  const mm = last.match(/^([A-Za-z][A-Za-z0-9]*?)(\d{6,})$/);
  if (mm && parts.length >= 2) { parts.splice(parts.length - 1, 1, mm[1], mm[2]); last = mm[2]; out.flags.push('เติมจุดก่อนเลขรหัส'); }
  if (/^\d+$/.test(last)) {
    if (last.length > 9) {
      const mid = last.slice(6, last.length - 3);
      if (/^0+$/.test(mid)) { last = last.slice(0, 6) + last.slice(-3); out.flags.push('ตัดเลข 0 เกินในรหัส'); }
      else out.flags.push('เลขรหัสยาวเกิน 9 หลัก');
      parts[parts.length - 1] = last;
    } else if (last.length < 9) out.flags.push('เลขรหัสไม่ครบ 9 หลัก');
  } else out.flags.push('ไม่พบเลขรหัส');
  if (prefix && parts[0] && parts[0].toUpperCase() !== prefix) { out.flags.push(`ต้นรหัส ${parts[0]} → ${prefix}`); parts[0] = prefix; }
  else if (parts[0]) parts[0] = parts[0].toUpperCase();
  out.code = parts.join('.');
  const b = br.map(blankish);
  let name = b[0] || extraName || '';
  let rest = b.slice(1);
  const looksPrice = v => /บาท|฿|^\s*[\d,]+(\.\d+)?\s*$|^N\/?A$/i.test(v);
  if (rest.length && rest[0] && !looksPrice(rest[0]) && /จำนวน|ตัว|ชิ้น|จุด|ชุด|อัน|เครื่อง|ใบ|คัน/.test(rest[0])) {
    name = name ? `${name} (${rest[0]})` : rest[0]; rest = rest.slice(1); out.flags.push('รวมวงเล็บจำนวนเข้าในชื่อ');
  }
  /* วงเล็บตามลำดับ: (ราคา)(ประกัน)(ใบ PV)(วันที่จัดซื้อ)(หมายเหตุ) — รองรับคำนำหน้า เช่น "ประกัน 2 ปี", "ใบPV …", "วันที่จัดซื้อ …" */
  const F = { price: '', warranty: '', pv: '', purchase_date: '', note: '' };
  const ORDER = ['price', 'warranty', 'pv', 'purchase_date', 'note'];
  const LABELS = [
    ['purchase_date', /^วันที่\s*(จัด)?(ซื้อ|ชื้อ|ทำ)\s*:?\s*/], ['purchase_date', /^(จัด)?(ซื้อ|ชื้อ)เมื่อ\s*:?\s*/],
    ['note', /^หมายเหตุ\s*:?\s*/], ['pv', /^ใบ\s*(?=PV)/i], ['warranty', /^(ระยะเวลา)?ประกัน\s*:?\s*/], ['price', /^ราคา\s*:?\s*/],
  ];
  const isDate = v => /^\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{2,4}$/.test(v);
  const put = (k, v) => { F[k] = F[k] ? F[k] + ' ' + v : v; };
  let pos = 0;
  for (const raw of rest) {
    const v = String(raw || '').trim();
    if (!v || /^N\/?A$/i.test(v)) { pos++; continue; }
    const hit = LABELS.find(([, re]) => re.test(v));
    if (hit) { const val = v.replace(hit[1], '').trim(); if (/^วันที่\s*จัดทำ/.test(v)) out.flags.push('วงเล็บ "วันที่จัดทำ" ใส่เป็นวันที่จัดซื้อ'); put(hit[0], val || v); pos = ORDER.indexOf(hit[0]) + 1; continue; }
    if (/^PV/i.test(v)) { put('pv', v); pos = 3; continue; }
    if (isDate(v) && pos <= 3) { put('purchase_date', v); pos = 4; continue; }
    let k = ORDER[Math.min(pos, 4)];
    if (k === 'purchase_date' && !isDate(v)) k = 'note';
    put(k, v); pos++;
  }
  out.name = name; out.price = F.price || 'N/A'; out.warranty = F.warranty || 'N/A'; out.pv = F.pv; out.purchase_date = F.purchase_date; out.note = F.note;
  return out;
}

function impStatus() {
  const st = S.imp; if (!st) return;
  const byCode = new Map((S.assets || []).map(a => [a.code, a]));
  const byFid = new Map((S.assets || []).filter(a => a.drive_file_id).map(a => [a.drive_file_id, a]));
  const cnt = {};
  for (const r of st.rows) { if (r.include) cnt[r.code] = (cnt[r.code] || 0) + 1; }
  for (const r of st.rows) {
    r.errs = [];
    const done = byFid.get(r.fid);
    r.imported = done ? done.code : '';
    if (!validCode(r.code)) r.errs.push('รหัสไม่ถูกต้อง');
    if (r.include && cnt[r.code] > 1) r.errs.push('รหัสซ้ำในโฟลเดอร์');
    if (!done && byCode.has(r.code)) r.errs.push('รหัสนี้มีในระบบแล้ว (เป็นรูปอื่น)');
    if (!String(r.name || '').trim()) r.errs.push('ไม่มีชื่อ');
    r.status = r.imported ? 'done' : r.errs.length ? 'err' : r.flags.length ? 'warn' : 'new';
  }
}
function impStatusCell(r) {
  if (r.status === 'done') return `<span class="pill gray">นำเข้าแล้ว</span><div class="small muted">${esc(r.imported)}</div>`;
  if (r.status === 'err') return r.errs.map(e => `<span class="pill err">${esc(e)}</span>`).join(' ');
  if (r.status === 'warn') return `<span class="pill warn">ตรวจอีกครั้ง</span><div class="small" style="color:var(--warn)">${esc(r.flags.join(' · '))}</div>`;
  return '<span class="pill new">ใหม่</span>';
}

VIEWS.import = async (main) => {
  const u = S.unit;
  main.innerHTML = `
  <h2>นำเข้าจากโฟลเดอร์ Google Drive</h2>
  <p class="sub">ระบบอ่าน<b>ชื่อไฟล์รูป</b>ตามรูปแบบ <code>รหัส (ชื่อ)(ราคา)(ประกัน)(ใบ PV)(วันที่จัดซื้อ)(หมายเหตุ)</code> แล้วแสดงตารางให้ตรวจก่อนบันทึก</p>
  <div class="card">
    <h3>1) เลือกโฟลเดอร์สถานที่</h3>
    <div class="grid g2">
      <label class="f">โฟลเดอร์ย่อยในโฟลเดอร์หลักของหน่วยงาน
        <select id="impSub"><option value="">${u.drive_folder_id ? '— กด “โหลดรายชื่อโฟลเดอร์” —' : '— ยังไม่ได้ผูกโฟลเดอร์หลัก (ตั้งค่าหน่วยงาน) —'}</option></select></label>
      <label class="f">หรือวางลิงก์โฟลเดอร์ Drive<input id="impLink" placeholder="https://drive.google.com/drive/folders/…"></label>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn sec" id="impLoadSubs" ${u.drive_folder_id ? '' : 'disabled'}>โหลดรายชื่อโฟลเดอร์</button>
      <button class="btn" id="impRead">อ่านไฟล์ในโฟลเดอร์</button>
    </div>
  </div>
  <div id="impBody"></div>`;
  $('#impLoadSubs').onclick = () => guard(async () => {
    const subs = await run('driveListSubfolders', u.drive_folder_id);
    const placeByFolder = new Map((S.places || []).filter(p => p.drive_folder_id).map(p => [p.drive_folder_id, p]));
    $('#impSub').innerHTML = '<option value="">— เลือกโฟลเดอร์ —</option>' + subs.map(s => {
      const p = placeByFolder.get(s.id);
      return `<option value="${esc(s.id)}">${esc(s.name)}${p ? ` · (${esc(p.loc)})` : ''}</option>`;
    }).join('');
    toast(`พบ ${subs.length} โฟลเดอร์`);
  }, 'กำลังโหลดโฟลเดอร์…');
  $('#impRead').onclick = () => {
    const src = $('#impLink').value.trim() || $('#impSub').value;
    if (!src) return toast('เลือกโฟลเดอร์หรือวางลิงก์ก่อน', true);
    guard(async () => {
      const [info, list] = await Promise.all([run('driveFolderInfo', src), run('driveListImages', src)]);
      const rows = list.files.map(f => {
        const p = parseFileName(f.name, u.prefix);
        return { fid: f.id, fname: f.name, created: f.created, code: p.code, name: p.name, price: p.price, warranty: p.warranty, pv: p.pv, note: p.note, purchase_date: p.purchase_date || '', made_date: f.created, flags: p.flags, include: true };
      });
      S.imp = { folder: info, rows };
      impStatus();
      for (const r of rows) if (r.status === 'done') r.include = false;
      const locs = {}; rows.forEach(r => { const l = codeLoc(r.code); if (l) locs[l] = (locs[l] || 0) + 1; });
      const mainLoc = Object.keys(locs).sort((a, b) => locs[b] - locs[a])[0] || '';
      const known = (S.places || []).find(p => p.loc === mainLoc);
      S.imp.location = (known && known.location) || info.name;
      S.imp.locs = locs;
      renderImpBody();
    }, 'กำลังอ่านไฟล์ในโฟลเดอร์…');
  };
  if (S.imp) renderImpBody();
};

function renderImpBody() {
  const st = S.imp, box = $('#impBody'); if (!box || !st) return;
  impStatus();
  const n = st.rows.length;
  const c = { new: 0, warn: 0, err: 0, done: 0 }; st.rows.forEach(r => c[r.status]++);
  const shareOk = /ANYONE/.test(st.folder.sharing || '');
  box.innerHTML = `
  <div class="card">
    <h3>2) ตรวจข้อมูล — โฟลเดอร์ “${esc(st.folder.name)}” (${n} รูป)</h3>
    <div class="row small" style="margin-bottom:10px">
      <span class="pill new">ใหม่ ${c.new}</span><span class="pill warn">ตรวจอีกครั้ง ${c.warn}</span><span class="pill err">มีปัญหา ${c.err}</span><span class="pill gray">นำเข้าแล้ว ${c.done}</span>
      <span class="muted">· สิทธิ์ของบัญชีนี้: ${esc({ owner: 'เจ้าของ', edit: 'แก้ไขได้', view: 'ดูได้อย่างเดียว' }[st.folder.access] || st.folder.access)}</span>
      <span class="muted">· การแชร์: ${shareOk ? '<span class="pill ok">ทุกคนที่มีลิงก์</span>' : '<span class="pill warn">ยังไม่เปิดลิงก์</span>'}</span>
    </div>
    ${shareOk ? '' : '<div class="note" style="margin-bottom:10px">โฟลเดอร์นี้ยังไม่แชร์แบบ “ทุกคนที่มีลิงก์ – ผู้อ่าน” → รูปจะไม่ขึ้นบนการ์ด ติ๊กช่อง “ตั้งแชร์ให้อัตโนมัติ” ด้านล่าง (ได้เฉพาะเจ้าของโฟลเดอร์) หรือให้เจ้าของไดรฟ์ตั้งเอง</div>'}
    <div class="grid g3" style="margin-bottom:10px">
      <label class="f">ชื่อสถานที่ (แสดงบนการ์ด)<input id="impLocation" value="${esc(st.location)}"></label>
      <label class="f">รหัสสถานที่ที่พบ<input value="${esc(Object.entries(st.locs).map(([k, v]) => `${k} (${v})`).join(', '))}" disabled></label>
      <label class="f">วันที่จัดทำ<select id="impDateMode"><option value="file">ตามวันที่อัปโหลดไฟล์ใน Drive</option><option value="today">วันนี้ (${esc(S.cfg.today)})</option></select></label>
    </div>
    <div class="tablewrap"><table><thead><tr>
      <th><input type="checkbox" id="impAll" checked title="เลือกทั้งหมด"></th><th>รูป</th><th>สถานะ</th><th>รหัส</th><th>ชื่อ</th><th>ราคา</th><th>ประกัน</th><th>ใบ PV</th><th>วันที่จัดซื้อ</th><th>หมายเหตุ</th><th>ชื่อไฟล์เดิม</th>
    </tr></thead><tbody>
    ${st.rows.map((r, i) => `<tr data-i="${i}" class="${r.include ? '' : 'skip'}">
      <td><input type="checkbox" data-k="include" ${r.include ? 'checked' : ''}></td>
      <td class="thumb"><a href="https://drive.google.com/file/d/${esc(r.fid)}/view" target="_blank"><img loading="lazy" src="${thumb(r.fid)}" alt=""></a></td>
      <td class="stc">${impStatusCell(r)}</td>
      <td><input data-k="code" value="${esc(r.code)}" style="min-width:190px"></td>
      <td><input data-k="name" class="wide" value="${esc(r.name)}"></td>
      <td><input data-k="price" value="${esc(r.price)}"></td>
      <td><input data-k="warranty" value="${esc(r.warranty)}"></td>
      <td><input data-k="pv" value="${esc(r.pv)}"></td>
      <td><input data-k="purchase_date" value="${esc(r.purchase_date)}" placeholder="N/A"></td>
      <td><input data-k="note" value="${esc(r.note)}"></td>
      <td class="small muted" style="min-width:200px">${esc(r.fname)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:12px;justify-content:space-between">
      <label class="chk"><input type="checkbox" id="impShare" ${shareOk ? '' : 'checked'}> ตั้งแชร์โฟลเดอร์เป็น “ทุกคนที่มีลิงก์ – ผู้อ่าน” ให้อัตโนมัติ</label>
      <button class="btn" id="impSave">บันทึกรายการที่เลือก</button>
    </div>
  </div>`;
  $('#impLocation').oninput = e => { st.location = e.target.value; };
  $('#impAll').onchange = e => { st.rows.forEach(r => { if (r.status !== 'done') r.include = e.target.checked; }); renderImpBody(); };
  $$('tbody tr', box).forEach(tr => {
    const r = st.rows[Number(tr.dataset.i)];
    $$('input[data-k]', tr).forEach(inp => {
      const k = inp.dataset.k;
      inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        r[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (k === 'include') tr.classList.toggle('skip', !r.include);
        impStatus();
        $$('tbody tr', box).forEach(t2 => { $('.stc', t2).innerHTML = impStatusCell(st.rows[Number(t2.dataset.i)]); });
      });
    });
  });
  $('#impSave').onclick = saveImport;
}

async function saveImport() {
  const st = S.imp; impStatus();
  const sel = st.rows.filter(r => r.include && r.status !== 'done');
  const bad = sel.filter(r => r.status === 'err');
  if (!sel.length) return toast('ยังไม่ได้เลือกรายการ', true);
  if (bad.length) return toast(`มี ${bad.length} รายการที่มีปัญหา — แก้ หรือเอาเครื่องหมายถูกออกก่อน`, true);
  const location = String(st.location || '').trim();
  if (!location) return toast('ใส่ชื่อสถานที่ก่อน', true);
  const dateMode = $('#impDateMode').value;
  const u = S.unit;
  const rows = sel.map(r => ({
    code: r.code.trim(), seq: codeSeq(r.code), name: r.name.trim(), location,
    made_date: dateMode === 'today' ? S.cfg.today : r.made_date,
    price: blankish(r.price) || 'N/A', warranty: blankish(r.warranty) || 'N/A', pv: blankish(r.pv), purchase_date: blankish(r.purchase_date), note: blankish(r.note),
    drive_file_id: r.fid, header_title: u.header_title || `ทะเบียนทรัพย์สิน | ${u.name}`, org_name: ORG_NAME, created_by: CREATED_BY,
  }));
  const share = $('#impShare').checked;
  const res = await guard(async () => {
    const out = await api('assets.upsert', { mode: 'insert', rows });
    const locs = Array.from(new Set(rows.map(r => codeLoc(r.code))));
    for (const loc of locs) await api('places.save', { place: { prefix: u.prefix, loc, location, drive_folder_id: st.folder.id } });
    let shareMsg = '';
    if (share) { const s = await run('driveEnsureShare', st.folder.id); shareMsg = s.ok ? 'ตั้งแชร์โฟลเดอร์แล้ว' : s.message; }
    await ensureData(true);
    return { out, locs, shareMsg };
  }, `กำลังบันทึก ${rows.length} รายการ…`);
  if (!res) return;
  toast(`บันทึกแล้ว ${res.out.inserted} รายการ${res.out.skipped.length ? ` · ข้าม ${res.out.skipped.length} (มีอยู่แล้ว)` : ''}`);
  renderImpBody();
  $('#impBody').insertAdjacentHTML('afterbegin', `<div class="note ok" style="margin-bottom:12px">✓ บันทึกเข้า${esc(u.name)}แล้ว ${res.out.inserted} รายการ ${res.shareMsg ? '· ' + esc(res.shareMsg) : ''}
    <div class="row" style="margin-top:8px">${res.locs.map(l => `<button class="btn sm" data-qr="${esc(l)}">ทำ QR PDF: ${esc(l)}</button>`).join('')}</div></div>`);
  $$('button[data-qr]').forEach(b => b.onclick = () => { S.qr.loc = b.dataset.qr; S.qr.rows = {}; go('qr'); });
}

/* =================== เพิ่มทรัพย์สิน (แนบรูป) =================== */
VIEWS.add = async (main) => {
  const u = S.unit;
  const ps = placesWithCounts();
  const last = S.add.loc && ps.find(p => p.loc === S.add.loc) ? S.add.loc : (ps[0] && ps[0].loc) || '';
  main.innerHTML = `
  <h2>เพิ่มทรัพย์สิน (แนบรูป)</h2>
  <p class="sub">ถ่ายรูปหรือเลือกรูป กรอกข้อมูล แล้วกดบันทึก — ระบบออกรหัสต่อจากเลขล่าสุดของสถานที่ เก็บรูปลงโฟลเดอร์ Drive ของสถานที่ (ตั้งชื่อไฟล์ตามมาตรฐาน) และบันทึกฐานข้อมูลให้</p>
  <div class="card">
    <div class="grid g2">
      <label class="f">สถานที่<select id="addPlace">${placeOptions(last)}<option value="__new">+ เพิ่มสถานที่ใหม่…</option></select></label>
      <div id="addFolderBox"></div>
    </div>
    <div id="addNewPlace" class="hide" style="margin-top:12px">
      <div class="grid g3">
        <label class="f">รหัสสถานที่ (อังกฤษ เช่น LOBY, FITN, OFFI)<input id="npLoc" placeholder="LOBY"></label>
        <label class="f">ชื่อสถานที่ (ไทย)<input id="npName" placeholder="ล็อบบี้"></label>
        <label class="f">โฟลเดอร์ Drive<select id="npFolder"><option value="__create">สร้างโฟลเดอร์ใหม่ชื่อเดียวกับสถานที่</option></select></label>
      </div>
      <div class="row" style="margin-top:10px"><button class="btn sec" id="npLoad" ${u.drive_folder_id ? '' : 'disabled'}>โหลดโฟลเดอร์ที่มีอยู่</button><button class="btn" id="npSave">บันทึกสถานที่</button></div>
      ${u.drive_folder_id ? '' : `<div class="note" style="margin-top:8px">หน่วยงานนี้ยังไม่ได้ผูกโฟลเดอร์หลักใน Drive — ${isUnitUser() ? 'แจ้งผู้ดูแลระบบ (ADM-PR)' : 'ไปที่ “ตั้งค่าหน่วยงาน”'} ก่อน</div>`}
    </div>
  </div>
  <div class="card">
    <div class="grid g2">
      <div>
        <label class="f">รูปทรัพย์สิน<input type="file" id="addPhoto" accept="image/*"></label>
        <img id="addPrev" class="preview-photo hide" alt="">
      </div>
      <div class="grid" style="align-content:start">
        <label class="f">รหัสที่จะได้ (ออกให้อัตโนมัติ)<input id="addCode" readonly></label>
        <label class="f">ชื่อทรัพย์สิน *<input id="addName" placeholder="เช่น โซฟา 2 ตัว"></label>
      </div>
    </div>
    <div class="grid g3" style="margin-top:12px">
      <label class="f">ราคา<input id="addPrice" placeholder="N/A หรือ 2,500 บาท"></label>
      <label class="f">ระยะเวลาประกัน<input id="addWarranty" placeholder="N/A หรือ 1 ปี"></label>
      <label class="f">เลขใบ PV<input id="addPv" placeholder="-"></label>
      <label class="f">วันที่จัดซื้อ<input id="addPurchase" placeholder="N/A หรือ 15/08/2569"></label>
      <label class="f">วันที่จัดทำ<input id="addMade" value="${esc(S.cfg.today)}"></label>
      <label class="f">หมายเหตุ<input id="addNote" placeholder="-"></label>
    </div>
    <div class="row end" style="margin-top:14px"><button class="btn" id="addSave">บันทึกทรัพย์สิน</button></div>
  </div>
  <div class="card"><h3>เพิ่มล่าสุด</h3><div id="addRecent"></div></div>`;
  let photo = null;
  const refreshCode = async () => {
    const loc = $('#addPlace').value; $('#addCode').value = '';
    if (!loc || loc === '__new') return;
    const r = await api('assets.nextCode', { prefix: u.prefix, loc }).catch(e => { toast(e.message, true); return null; });
    if (r && $('#addPlace').value === loc) $('#addCode').value = r.codes[0];
  };
  const folderBox = () => {
    const loc = $('#addPlace').value; const p = (S.places || []).find(x => x.loc === loc);
    $('#addNewPlace').classList.toggle('hide', loc !== '__new');
    $('#addFolderBox').innerHTML = loc === '__new' || !loc ? '' : (p && p.drive_folder_id
      ? `<label class="f">โฟลเดอร์เก็บรูป<div class="row"><a class="btn sm sec" target="_blank" href="https://drive.google.com/drive/folders/${esc(p.drive_folder_id)}">เปิดโฟลเดอร์ Drive</a></div></label>`
      : `<div class="note">สถานที่นี้ยังไม่ผูกโฟลเดอร์ Drive <button class="btn sm" id="bindFolder" style="margin-left:6px">ผูกโฟลเดอร์</button></div>`);
    const bf = $('#bindFolder'); if (bf) bf.onclick = () => bindFolderDialog(loc, () => folderBox());
  };
  $('#addPlace').onchange = () => { S.add.loc = $('#addPlace').value; folderBox(); refreshCode(); };
  folderBox(); refreshCode();
  $('#npLoad').onclick = () => guard(async () => {
    const subs = await run('driveListSubfolders', u.drive_folder_id);
    $('#npFolder').innerHTML = '<option value="__create">สร้างโฟลเดอร์ใหม่ชื่อเดียวกับสถานที่</option>' + subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  }, 'กำลังโหลดโฟลเดอร์…');
  $('#npSave').onclick = () => {
    const loc = $('#npLoc').value.trim(), name = $('#npName').value.trim();
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(loc)) return toast('รหัสสถานที่ต้องเป็นภาษาอังกฤษ/ตัวเลข', true);
    if (!name) return toast('ใส่ชื่อสถานที่', true);
    if (!u.drive_folder_id) return toast('ยังไม่ได้ผูกโฟลเดอร์หลักของหน่วยงาน', true);
    guard(async () => {
      let fid = $('#npFolder').value;
      if (fid === '__create') fid = (await run('driveCreateFolder', u.drive_folder_id, name)).id;
      await api('places.save', { place: { prefix: u.prefix, loc, location: name, drive_folder_id: fid } });
      S.add.loc = loc; await ensureData(true); go('add'); toast('เพิ่มสถานที่แล้ว');
    }, 'กำลังบันทึกสถานที่…');
  };
  $('#addPhoto').onchange = async e => {
    const f = e.target.files[0]; photo = null; $('#addPrev').classList.add('hide');
    if (!f) return;
    photo = await guard(() => resizePhoto(f), 'กำลังเตรียมรูป…');
    if (photo && photo.preview) { $('#addPrev').src = photo.preview; $('#addPrev').classList.remove('hide'); }
  };
  const renderRecent = () => {
    $('#addRecent').innerHTML = S.add.recent.length ? `<div class="tablewrap"><table><thead><tr><th>รูป</th><th>รหัส</th><th>ชื่อ</th><th></th></tr></thead><tbody>${S.add.recent.map(a => `<tr><td class="thumb"><img src="${thumb(a.drive_file_id)}" alt=""></td><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td><a href="${esc(cardUrl(a.code))}" target="_blank">เปิดการ์ด</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted small">ยังไม่มี</div>';
  };
  renderRecent();
  $('#addSave').onclick = async () => {
    const loc = $('#addPlace').value; const p = (S.places || []).find(x => x.loc === loc);
    if (!loc || loc === '__new') return toast('เลือกสถานที่ก่อน', true);
    if (!p || !p.drive_folder_id) return toast('สถานที่นี้ยังไม่ผูกโฟลเดอร์ Drive', true);
    if (!photo) return toast('แนบรูปก่อน', true);
    const name = $('#addName').value.trim(); if (!name) return toast('ใส่ชื่อทรัพย์สิน', true);
    const res = await guard(async () => {
      const code = (await api('assets.nextCode', { prefix: u.prefix, loc })).codes[0];
      const a = {
        code, seq: codeSeq(code), name, location: p.location || loc, made_date: $('#addMade').value.trim() || S.cfg.today,
        price: blankish($('#addPrice').value) || 'N/A', warranty: blankish($('#addWarranty').value) || 'N/A', pv: blankish($('#addPv').value),
        purchase_date: blankish($('#addPurchase').value), note: blankish($('#addNote').value),
        header_title: u.header_title || `ทะเบียนทรัพย์สิน | ${u.name}`, org_name: ORG_NAME, created_by: CREATED_BY,
      };
      const up = await run('driveUpload', { folderId: p.drive_folder_id, name: fileNameFor(a, photo.ext), mime: photo.mime, b64: photo.b64 });
      a.drive_file_id = up.id;
      const r = await api('assets.upsert', { mode: 'insert', rows: [a] });
      if (!r.inserted) throw new Error('รหัส ' + code + ' ถูกใช้ไปแล้ว ลองกดบันทึกใหม่');
      return a;
    }, 'กำลังอัปโหลดรูปและบันทึก…');
    if (!res) return;
    S.add.recent.unshift(res); (S.assets = S.assets || []).push(res);
    toast('บันทึกแล้ว: ' + res.code);
    ['addName', 'addPrice', 'addWarranty', 'addPv', 'addPurchase', 'addNote'].forEach(id => { $('#' + id).value = ''; });
    $('#addPhoto').value = ''; photo = null; $('#addPrev').classList.add('hide');
    renderRecent(); refreshCode();
  };
};

function bindFolderDialog(loc, done) {
  const u = S.unit; const dlg = $('#dlg');
  dlg.innerHTML = `<div class="dh"><h3>ผูกโฟลเดอร์ Drive: ${esc(placeName(loc))} (${esc(loc)})</h3><button class="x" data-close>×</button></div>
  <div class="db"><div class="grid">
    <label class="f">เลือกโฟลเดอร์ย่อยของหน่วยงาน<select id="bfSel"><option value="">— กำลังโหลด —</option></select></label>
    <label class="f">หรือวางลิงก์โฟลเดอร์<input id="bfLink" placeholder="https://drive.google.com/drive/folders/…"></label>
  </div></div><div class="df"><button class="btn sec" data-close>ยกเลิก</button><button class="btn" id="bfOk">บันทึก</button></div>`;
  dlg.showModal();
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  if (u.drive_folder_id) run('driveListSubfolders', u.drive_folder_id).then(subs => {
    $('#bfSel').innerHTML = '<option value="">— เลือก —</option>' + subs.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  }).catch(e => toast(e.message, true));
  $('#bfOk').onclick = () => guard(async () => {
    const src = $('#bfLink').value.trim() || $('#bfSel').value; if (!src) throw new Error('เลือกโฟลเดอร์ก่อน');
    const info = await run('driveFolderInfo', src);
    await api('places.save', { place: { prefix: u.prefix, loc, location: placeName(loc), drive_folder_id: info.id } });
    await ensureData(true); dlg.close(); toast('ผูกโฟลเดอร์แล้ว'); done && done();
  }, 'กำลังบันทึก…');
}

/* =================== รายการ / แก้ไข =================== */
VIEWS.list = async (main) => {
  main.innerHTML = `
  <h2>รายการทรัพย์สิน — ${esc(S.unit.name)}</h2>
  <p class="sub">กดที่แถวเพื่อแก้ไขข้อมูล เปลี่ยนรูป หรือเปิดการ์ด — แก้แล้วการ์ดเปลี่ยนตามทันที (สติกเกอร์ QR เดิมใช้ต่อได้)</p>
  <div class="card"><div class="row">
    <label class="f" style="flex:1;min-width:220px">สถานที่<select id="lsLoc">${placeOptions(S.list.loc, true)}</select></label>
    <label class="f" style="flex:2;min-width:220px">ค้นหา (รหัส/ชื่อ/หมายเหตุ)<input id="lsQ" value="${esc(S.list.q)}" placeholder="พิมพ์เพื่อค้นหา"></label>
    <button class="btn sec" id="lsRefresh" style="align-self:flex-end">โหลดใหม่</button>
  </div></div>
  <div id="lsCount" class="muted small" style="margin:0 0 6px"></div>
  <div class="tablewrap"><table><thead><tr><th>รูป</th><th>รหัส</th><th>ชื่อ</th><th>สถานที่</th><th>ราคา</th><th>ประกัน</th><th>ใบ PV</th><th>วันที่จัดซื้อ</th><th>หมายเหตุ</th></tr></thead><tbody id="lsBody"></tbody></table></div>`;
  const draw = () => {
    const q = S.list.q.trim().toLowerCase();
    const rows = (S.assets || []).filter(a => (!S.list.loc || codeLoc(a.code) === S.list.loc) &&
      (!q || [a.code, a.name, a.note, a.location].some(v => String(v || '').toLowerCase().includes(q)))).sort((a, b) => a.code.localeCompare(b.code));
    $('#lsCount').textContent = `${rows.length} รายการ`;
    $('#lsBody').innerHTML = rows.length ? rows.map(a => `<tr class="click" data-code="${esc(a.code)}">
      <td class="thumb"><img loading="lazy" src="${thumb(a.drive_file_id)}" alt=""></td><td><b>${esc(a.code)}</b>${a.qty ? `<div class="small muted">${esc(a.qty)}</div>` : ''}</td>
      <td>${esc(a.name)}</td><td>${esc(a.location || '')}</td><td>${esc(a.price || 'N/A')}</td><td>${esc(a.warranty || 'N/A')}</td><td>${esc(a.pv || '-')}</td>
      <td>${esc(a.purchase_date || 'N/A')}</td><td>${/ซาก|ชำรุด/.test(a.note || '') ? `<span style="color:var(--red);font-weight:700">${esc(a.note)}</span>` : esc(a.note || '-')}</td></tr>`).join('')
      : '<tr><td colspan="9" class="empty">ไม่พบรายการ</td></tr>';
    $$('#lsBody tr[data-code]').forEach(tr => tr.onclick = () => editDialog(tr.dataset.code, draw));
  };
  $('#lsLoc').onchange = e => { S.list.loc = e.target.value; draw(); };
  $('#lsQ').oninput = e => { S.list.q = e.target.value; draw(); };
  $('#lsRefresh').onclick = async () => { await guard(() => ensureData(true), 'กำลังโหลด…'); draw(); };
  draw();
};

function editDialog(code, after) {
  const a = (S.assets || []).find(x => x.code === code); if (!a) return;
  const dlg = $('#dlg');
  const F = [['name', 'ชื่อ *'], ['location', 'สถานที่'], ['qty', 'ลำดับ/จำนวน (เว้นว่างถ้าไม่ใช่ชุด)'], ['made_date', 'วันที่จัดทำ'], ['price', 'ราคา'], ['warranty', 'ระยะเวลาประกัน'], ['pv', 'ใบ PV'], ['purchase_date', 'วันที่จัดซื้อ'], ['note', 'หมายเหตุ']];
  dlg.innerHTML = `<div class="dh"><h3>${esc(a.code)}</h3><button class="x" data-close>×</button></div>
  <div class="db"><div class="grid g2">
    <div><img class="preview-photo" id="edPrev" src="${thumb(a.drive_file_id, 800)}" alt="">
      <label class="f" style="margin-top:8px">เปลี่ยนรูป (อัปโหลดเข้าโฟลเดอร์ของสถานที่)<input type="file" id="edPhoto" accept="image/*"></label>
      <div class="row" style="margin-top:8px"><a class="btn sm sec" target="_blank" href="${esc(cardUrl(a.code))}">เปิดการ์ด</a>${a.drive_file_id ? `<a class="btn sm sec" target="_blank" href="https://drive.google.com/file/d/${esc(a.drive_file_id)}/view">เปิดรูปใน Drive</a>` : ''}</div>
    </div>
    <div class="grid" style="align-content:start">${F.map(([k, l]) => `<label class="f">${l}<input data-f="${k}" value="${esc(a[k] ?? '')}"></label>`).join('')}</div>
  </div>
  <label class="chk" style="margin-top:10px"><input type="checkbox" id="edRename"> เปลี่ยนชื่อไฟล์รูปใน Drive ให้ตรงกับข้อมูลใหม่ด้วย (ตามรูปแบบมาตรฐาน)</label>
  </div>
  <div class="df"><button class="btn danger" id="edDel" style="margin-right:auto">ลบรายการ</button><button class="btn sec" data-close>ยกเลิก</button><button class="btn" id="edSave">บันทึก</button></div>`;
  dlg.showModal();
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  let photo = null;
  $('#edPhoto').onchange = async e => { const f = e.target.files[0]; if (!f) return; photo = await guard(() => resizePhoto(f), 'กำลังเตรียมรูป…'); if (photo && photo.preview) $('#edPrev').src = photo.preview; };
  $('#edSave').onclick = async () => {
    const fields = {}; $$('input[data-f]', dlg).forEach(i => { fields[i.dataset.f] = i.value.trim(); });
    if (!fields.name) return toast('ชื่อห้ามว่าง', true);
    const ok = await guard(async () => {
      const merged = { ...a, ...fields };
      if (photo) {
        const p = (S.places || []).find(x => x.loc === codeLoc(a.code));
        if (!p || !p.drive_folder_id) throw new Error('สถานที่นี้ยังไม่ผูกโฟลเดอร์ Drive (ผูกได้ที่หน้า “เพิ่มทรัพย์สิน”)');
        const up = await run('driveUpload', { folderId: p.drive_folder_id, name: fileNameFor(merged, photo.ext), mime: photo.mime, b64: photo.b64 });
        fields.drive_file_id = up.id;
      } else if ($('#edRename').checked && a.drive_file_id) {
        const r = await run('driveRenameFile', a.drive_file_id, fileNameFor(merged, ''));
        if (!r.ok) toast(r.message, true);
      }
      const r = await api('assets.update', { code: a.code, fields });
      Object.assign(a, r.asset); return true;
    }, 'กำลังบันทึก…');
    if (ok) { dlg.close(); toast('บันทึกแล้ว (การ์ดอาจใช้เวลา ~5 นาทีจึงเปลี่ยนในเครื่องที่เคยเปิด)'); after && after(); }
  };
  $('#edDel').onclick = async () => {
    const t = prompt(`ลบ ${a.code} ออกจากระบบ?\nQR ที่พิมพ์ไปแล้วจะสแกนไม่เจอ\nพิมพ์รหัส ${a.code} เพื่อยืนยัน`);
    if (t === null) return;
    if (t.trim() !== a.code) return toast('รหัสไม่ตรง — ยกเลิกการลบ', true);
    const ok = await guard(() => api('assets.delete', { code: a.code, confirm: a.code }), 'กำลังลบ…');
    if (ok) { S.assets = S.assets.filter(x => x.code !== a.code); dlg.close(); toast('ลบแล้ว'); after && after(); }
  };
}

/* =================== Excel =================== */
const XL_COLS = [['code', 'รหัสทรัพย์สิน'], ['name', 'ชื่อ'], ['qty', 'ลำดับ/จำนวน'], ['location', 'สถานที่'], ['made_date', 'วันที่จัดทำ'], ['price', 'ราคา'], ['warranty', 'ระยะเวลาประกัน'], ['pv', 'ใบ PV'], ['purchase_date', 'วันที่จัดซื้อ'], ['note', 'หมายเหตุ']];
const XL_ALIAS = { 'รหัส': 'code', 'รหัสทรัพย์สิน': 'code', 'code': 'code', 'ชื่อ': 'name', 'ชื่อทรัพย์สิน': 'name', 'name': 'name', 'ลำดับ/จำนวน': 'qty', 'qty': 'qty', 'สถานที่': 'location', 'location': 'location', 'วันที่จัดทำ': 'made_date', 'made_date': 'made_date', 'ราคา': 'price', 'price': 'price', 'ระยะเวลาประกัน': 'warranty', 'ประกัน': 'warranty', 'warranty': 'warranty', 'ใบ pv': 'pv', 'pv': 'pv', 'เลขใบ pv': 'pv', 'วันที่จัดซื้อ': 'purchase_date', 'purchase_date': 'purchase_date', 'หมายเหตุ': 'note', 'note': 'note' };
function normVal(k, v) { v = String(v ?? '').trim(); if (v === '-' ) v = ''; if ((k === 'purchase_date' || k === 'price' || k === 'warranty') && /^N\/?A$/i.test(v)) v = ''; return v; }

VIEWS.excel = async (main) => {
  const u = S.unit;
  main.innerHTML = `
  <h2>Excel — ${esc(u.name)}</h2>
  <p class="sub">รายงานพร้อมรูปสำหรับส่งหัวหน้า/ส่งมอบ หรือดาวน์โหลดไฟล์ไปแก้ (เช่น เติมวันที่จัดซื้อ ราคา ใบ PV) แล้วนำกลับเข้ามา</p>
  <div class="card" id="rpCard"><h3>รายงานทะเบียนทรัพย์สิน (Excel / PDF พร้อมรูป + โลโก้)</h3>
    <div class="row" style="align-items:flex-end">
      <label class="f" style="flex:1;min-width:220px">สถานที่<select id="rpLoc">${placeOptions('', true, 'ทั้งหน่วยงาน')}</select></label>
      <label class="chk"><input type="checkbox" id="rpPhoto" checked> ใส่รูปทรัพย์สิน</label>
      <label class="chk"><input type="checkbox" id="rpQr" checked> ใส่ QR</label>
      <label class="chk"><input type="checkbox" id="rpGroup" checked> แยกกลุ่มตามสถานที่</label>
      <label class="chk"><input type="checkbox" id="rpSum" checked> แผ่นสรุป</label>
      <div class="row" style="gap:8px"><button class="btn accent" id="rpMake">สร้างรายงาน Excel</button><button class="btn" id="rpPdf">สร้างรายงาน PDF</button></div>
    </div>
    <p class="small muted" style="margin:10px 0 0">หัวรายงานมีโลโก้หน่วยงานคู่กับโลโก้ MJ · ตั้งหน้ากระดาษ A4 แนวนอน พิมพ์ได้ทันที · รหัสทรัพย์สินกดเปิดการ์ดได้</p>
    <div id="rpOut"></div>
  </div>
  <div class="card"><h3>ดาวน์โหลดไปแก้ไข แล้วนำกลับเข้า</h3>
    <div class="row"><label class="f">สถานที่<select id="xlLoc">${placeOptions('', true, 'ทั้งหน่วยงาน')}</select></label>
      <button class="btn" id="xlDown" style="align-self:flex-end">ดาวน์โหลด Excel (.xlsx)</button>
      <a class="btn sec" style="align-self:flex-end" target="_blank" href="${esc(S.cfg.supabaseUrl)}/functions/v1/export?unit=${esc(u.prefix)}&format=csv">ลิงก์ CSV (สำหรับส่งมอบ)</a></div>
    <p class="small muted" style="margin:8px 0 0">ช่องว่างในไฟล์ = “ไม่เปลี่ยน” · วันที่ให้พิมพ์แบบ 28/10/2569 · ห้ามแก้คอลัมน์รหัสทรัพย์สิน (ถ้าเป็นรหัสใหม่ ระบบจะเพิ่มเป็นรายการใหม่แบบไม่มีรูป)</p>
  </div>
  <div class="card"><h3>นำเข้าไฟล์ที่แก้แล้ว</h3>
    <label class="f">เลือกไฟล์ .xlsx / .csv<input type="file" id="xlFile" accept=".xlsx,.xls,.csv"></label>
    <div id="xlBody" style="margin-top:12px"></div>
  </div>`;
  $('#xlDown').onclick = () => {
    const loc = $('#xlLoc').value;
    const rows = (S.assets || []).filter(a => !loc || codeLoc(a.code) === loc).sort((a, b) => a.code.localeCompare(b.code));
    const aoa = [XL_COLS.map(c => c[1]).concat(['ลิงก์การ์ด'])].concat(rows.map(a => XL_COLS.map(([k]) => (k === 'purchase_date' ? (a[k] || 'N/A') : (a[k] ?? ''))).concat([cardUrl(a.code)])));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [22, 36, 10, 24, 12, 12, 14, 16, 14, 24, 40].map(w => ({ wch: w }));
    for (const k of Object.keys(ws)) if (k[0] !== '!' && ws[k].t === 'n') { ws[k].t = 's'; ws[k].v = String(ws[k].v); }
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, u.prefix);
    const name = `Asset_Register_${u.prefix}${loc ? '_' + loc : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    downloadBlob(blob, name);
    saveCopyOffer(blob, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', $('#xlDown').closest('.card'));
  };
  $('#rpMake').onclick = makeReport;
  $('#rpPdf').onclick = makeReportPdf;
  $('#xlFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const data = await f.arrayBuffer();
    let wb; try { wb = XLSX.read(data, { type: 'array' }); } catch (err) { return toast('อ่านไฟล์ไม่ได้: ' + err.message, true); }
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
    S.xl = buildXlDiff(raw); renderXl();
  };
  if (S.xl) renderXl();
};
function buildXlDiff(raw) {
  const byCode = new Map((S.assets || []).map(a => [a.code, a]));
  const out = [];
  for (const r of raw) {
    const row = {};
    for (const [h, v] of Object.entries(r)) { const k = XL_ALIAS[String(h).trim().toLowerCase()] || XL_ALIAS[String(h).trim()]; if (k) row[k] = String(v ?? '').trim(); }
    if (!row.code) continue;
    const ex = byCode.get(row.code);
    const item = { code: row.code, row, changes: {}, status: '', msg: '' };
    if (!row.code.startsWith(S.unit.prefix + '.')) { item.status = 'err'; item.msg = 'ไม่ใช่รหัสของหน่วยงานนี้'; }
    else if (ex) {
      for (const [k] of XL_COLS) {
        if (k === 'code' || !(k in row) || row[k] === '') continue;
        if (normVal(k, row[k]) !== normVal(k, ex[k])) item.changes[k] = { from: ex[k] ?? '', to: row[k] };
      }
      item.status = Object.keys(item.changes).length ? 'upd' : 'same';
    } else if (!validCode(row.code)) { item.status = 'err'; item.msg = 'รหัสใหม่ไม่ถูกรูปแบบ'; }
    else if (!row.name) { item.status = 'err'; item.msg = 'รายการใหม่ต้องมีชื่อ'; }
    else item.status = 'new';
    out.push(item);
  }
  return out;
}
function renderXl() {
  const box = $('#xlBody'); if (!box || !S.xl) return;
  const c = { upd: 0, new: 0, same: 0, err: 0 }; S.xl.forEach(i => c[i.status]++);
  const show = S.xl.filter(i => i.status !== 'same');
  box.innerHTML = `<div class="row small" style="margin-bottom:8px"><span class="pill warn">แก้ไข ${c.upd}</span><span class="pill new">เพิ่มใหม่ ${c.new}</span><span class="pill gray">ไม่เปลี่ยน ${c.same}</span><span class="pill err">ผิดพลาด ${c.err}</span></div>
  ${show.length ? `<div class="tablewrap"><table><thead><tr><th>สถานะ</th><th>รหัส</th><th>รายละเอียด</th></tr></thead><tbody>
  ${show.map(i => `<tr><td>${i.status === 'upd' ? '<span class="pill warn">แก้ไข</span>' : i.status === 'new' ? '<span class="pill new">เพิ่มใหม่</span>' : '<span class="pill err">ผิดพลาด</span>'}</td><td><b>${esc(i.code)}</b></td>
    <td>${i.status === 'upd' ? Object.entries(i.changes).map(([k, v]) => `<div><span class="muted">${esc(XL_COLS.find(x => x[0] === k)[1])}:</span> <s class="muted">${esc(v.from || '—')}</s> → <b>${esc(v.to)}</b></div>`).join('') : i.status === 'new' ? esc(i.row.name) + ' <span class="muted small">(ไม่มีรูป)</span>' : esc(i.msg)}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="note ok">ไม่มีอะไรเปลี่ยน</div>'}
  <div class="row end" style="margin-top:10px"><button class="btn" id="xlApply" ${c.upd + c.new ? '' : 'disabled'}>บันทึก ${c.upd + c.new} รายการ</button></div>`;
  const ap = $('#xlApply'); if (ap) ap.onclick = applyXl;
}
async function applyXl() {
  const u = S.unit;
  const rows = [];
  for (const i of S.xl) {
    if (i.status === 'upd') { const r = { code: i.code }; for (const [k, v] of Object.entries(i.changes)) r[k] = normVal(k, v.to) || (k === 'price' || k === 'warranty' ? 'N/A' : ''); rows.push(r); }
    if (i.status === 'new') {
      const r = { code: i.code, seq: codeSeq(i.code), header_title: u.header_title || `ทะเบียนทรัพย์สิน | ${u.name}`, org_name: ORG_NAME, created_by: CREATED_BY };
      for (const [k] of XL_COLS) if (k !== 'code' && normVal(k, i.row[k])) r[k] = normVal(k, i.row[k]);
      r.location = r.location || placeName(codeLoc(i.code)); r.made_date = r.made_date || S.cfg.today;
      rows.push(r);
    }
  }
  const res = await guard(async () => { const out = { inserted: 0, updated: 0 }; for (let i = 0; i < rows.length; i += 200) { const r = await api('assets.upsert', { mode: 'upsert', rows: rows.slice(i, i + 200) }); out.inserted += r.inserted; out.updated += r.updated; } await ensureData(true); return out; }, `กำลังบันทึก ${rows.length} รายการ…`);
  if (!res) return;
  toast(`บันทึกแล้ว: แก้ไข ${res.updated} · เพิ่มใหม่ ${res.inserted}`);
  S.xl = null; $('#xlBody').innerHTML = `<div class="note ok">✓ บันทึกแล้ว: แก้ไข ${res.updated} รายการ · เพิ่มใหม่ ${res.inserted} รายการ</div>`; $('#xlFile').value = '';
}
/* ----- รายงาน Excel พร้อมรูป (ExcelJS) ----- */
function blobToB64(blob) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); }); }
async function shrinkImage(dataUrl, maxW, maxH, q) {
  const im = await loadImg(dataUrl); if (!im) return null;
  const sc = Math.min(1, maxW / im.naturalWidth, maxH / im.naturalHeight);
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * sc)); c.height = Math.max(1, Math.round(im.naturalHeight * sc));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/jpeg', q || 0.82), w: c.width, h: c.height, ext: 'jpeg' };
}
async function imgInfo(dataUrl) {
  if (!dataUrl) return null; const im = await loadImg(dataUrl); if (!im) return null;
  const m = /^data:image\/(png|jpe?g|gif)/i.exec(dataUrl);
  if (!m) { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0); return { data: c.toDataURL('image/png'), w: c.width, h: c.height, ext: 'png' }; }
  return { data: dataUrl, w: im.naturalWidth, h: im.naturalHeight, ext: m[1].toLowerCase().replace('jpg', 'jpeg') };
}
function qrPng(text, px) {
  const q = qrcode(0, 'M'); q.addData(text, 'Byte'); q.make();
  const n = q.getModuleCount(), b = 2, cell = Math.max(2, Math.floor(px / (n + 2 * b))), size = cell * (n + 2 * b);
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) x.fillRect((k + b) * cell, (r + b) * cell, cell, cell);
  return { data: c.toDataURL('image/png'), w: size, h: size, ext: 'png' };
}
const ARGB = h => 'FF' + String(h || '#000000').replace('#', '').slice(0, 6).toUpperCase();
async function makeReport() {
  if (!window.ExcelJS) return toast('โหลดไลบรารี Excel ไม่สำเร็จ ลองรีเฟรชหน้า', true);
  const u = S.unit, t = u.theme || {};
  const loc = $('#rpLoc').value, withPhoto = $('#rpPhoto').checked, withQr = $('#rpQr').checked, group = $('#rpGroup').checked && !loc, withSum = $('#rpSum').checked;
  const rows = (S.assets || []).filter(a => !loc || codeLoc(a.code) === loc).sort((a, b) => a.code.localeCompare(b.code));
  if (!rows.length) return toast('ไม่มีรายการ', true);
  const out = await guard(async () => {
    /* รูปจาก Drive ทีละชุด */
    const photos = withPhoto ? await fetchPhotos(rows) : {};
    $('#busyText').textContent = 'กำลังจัดหน้ารายงาน…';
    const FOREST = '#173D1C', LEAF = '#86BD41', ROOF = '#F38720';
    const head = t.head2 || t.head1 || FOREST, accent = t.accent || LEAF;
    const font = 'Tahoma';
    const wb = new ExcelJS.Workbook(); wb.creator = 'ADM-PR · Major Property Service'; wb.created = new Date();
    const ws = wb.addWorksheet('รายการทรัพย์สิน', { views: [{ showGridLines: false }] });
    const cols = [{ k: 'no', h: 'ลำดับ', w: 6 }];
    if (withPhoto) cols.push({ k: 'photo', h: 'รูป', w: 18 });
    if (withQr) cols.push({ k: 'qr', h: 'QR', w: 11 });
    cols.push({ k: 'code', h: 'รหัสทรัพย์สิน', w: 23 }, { k: 'name', h: 'ชื่อทรัพย์สิน', w: 34 }, { k: 'location', h: 'สถานที่', w: 16 },
      { k: 'made_date', h: 'วันที่จัดทำ', w: 12 }, { k: 'price', h: 'ราคา', w: 13 }, { k: 'warranty', h: 'ระยะเวลาประกัน', w: 13 },
      { k: 'pv', h: 'ใบ PV', w: 15 }, { k: 'purchase_date', h: 'วันที่จัดซื้อ', w: 13 }, { k: 'note', h: 'หมายเหตุ', w: 22 });
    const N = cols.length, ci = k => cols.findIndex(c => c.k === k) + 1;
    ws.columns = cols.map(c => ({ key: c.k, width: c.w }));
    const pxW = w => Math.round(w * 7 + 5);
    const addImg = (info, col1, row1, boxW, boxH, pad) => {
      if (!info) return;
      const sc = Math.min((boxW - 2 * pad) / info.w, (boxH - 2 * pad) / info.h);
      const w = info.w * sc, h = info.h * sc;
      const id = wb.addImage({ base64: info.data, extension: info.ext });
      const cw = pxW(ws.getColumn(col1).width);
      ws.addImage(id, { tl: { col: col1 - 1 + (boxW - w) / 2 / cw, row: row1 - 1 + ((boxH - h) / 2) / boxH }, ext: { width: w, height: h }, editAs: 'oneCell' });
    };
    /* หัวรายงาน */
    const today = S.cfg.today, last = N;
    ws.getRow(1).height = 34; ws.getRow(2).height = 22; ws.getRow(3).height = 20; ws.getRow(4).height = 5; ws.getRow(5).height = 8;
    const L = Math.min(3, N), R0 = Math.max(L + 1, N - 2);
    ws.mergeCells(1, L + 1, 1, R0); ws.mergeCells(2, L + 1, 2, R0); ws.mergeCells(3, L + 1, 3, R0);
    const c1 = ws.getCell(1, L + 1); c1.value = 'ทะเบียนทรัพย์สิน'; c1.font = { name: font, size: 18, bold: true, color: { argb: ARGB(FOREST) } }; c1.alignment = { horizontal: 'center', vertical: 'middle' };
    const c2 = ws.getCell(2, L + 1); c2.value = u.name + (loc ? ' · ' + placeName(loc) : ''); c2.font = { name: font, size: 12, bold: true, color: { argb: ARGB(head) } }; c2.alignment = { horizontal: 'center', vertical: 'middle' };
    const c3 = ws.getCell(3, L + 1); c3.value = `จำนวน ${rows.length.toLocaleString('th-TH')} รายการ  ·  ข้อมูล ณ ${today}  ·  จัดทำโดย ${CREATED_BY}`; c3.font = { name: font, size: 9.5, color: { argb: 'FF5F6E63' } }; c3.alignment = { horizontal: 'center', vertical: 'middle' };
    const band = [FOREST, LEAF, ROOF];
    for (let c = 1; c <= N; c++) ws.getCell(4, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(band[Math.min(2, Math.floor((c - 1) * 3 / N))]) } };
    const hdrH = 34 + 22 + 20; const hdrPx = Math.round(hdrH * 96 / 72);
    const leftW = cols.slice(0, L).reduce((s2, c) => s2 + pxW(c.w), 0), rightW = cols.slice(R0).reduce((s2, c) => s2 + pxW(c.w), 0);
    const unitLogo = await imgInfo(u.logo_house), mjLogo = await imgInfo(($('#brandLogo') || {}).src || u.logo_mj);
    if (unitLogo) { const id = wb.addImage({ base64: unitLogo.data, extension: unitLogo.ext }); const sc = Math.min((leftW - 10) / unitLogo.w, (hdrPx - 10) / unitLogo.h); ws.addImage(id, { tl: { col: 0.05, row: 0.15 }, ext: { width: unitLogo.w * sc, height: unitLogo.h * sc }, editAs: 'absolute' }); }
    if (mjLogo) { const sc = Math.min((rightW - 10) / mjLogo.w, (hdrPx - 10) / mjLogo.h); const w = mjLogo.w * sc; const id = wb.addImage({ base64: mjLogo.data, extension: mjLogo.ext }); const colStart = R0 + (rightW - w - 6) / pxW(cols[R0].w); ws.addImage(id, { tl: { col: Math.max(R0, colStart), row: 0.15 }, ext: { width: w, height: mjLogo.h * sc }, editAs: 'absolute' }); }
    /* หัวตาราง */
    const HR = 6; const hr = ws.getRow(HR); hr.height = 26;
    cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c.h; cell.font = { name: font, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(head) } }; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; cell.border = { bottom: { style: 'medium', color: { argb: ARGB(accent) } } }; });
    const thin = { style: 'thin', color: { argb: 'FFE0E8DA' } };
    let r = HR + 1, no = 0, curLoc = null;
    const ROWH = withPhoto ? 66 : withQr ? 54 : 30; const rowPx = Math.round(ROWH * 96 / 72);
    for (const a of rows) {
      const l = codeLoc(a.code);
      if (group && l !== curLoc) {
        curLoc = l; const cnt = rows.filter(x => codeLoc(x.code) === l).length;
        ws.mergeCells(r, 1, r, N); const g = ws.getCell(r, 1);
        g.value = `สถานที่: ${placeName(l)}  (${l})  ·  ${cnt} รายการ`; g.font = { name: font, size: 10.5, bold: true, color: { argb: ARGB(FOREST) } };
        g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF5E4' } }; g.alignment = { vertical: 'middle', indent: 1 };
        g.border = { left: { style: 'thick', color: { argb: ARGB(LEAF) } } }; ws.getRow(r).height = 22; r++;
      }
      no++;
      const row = ws.getRow(r); row.height = ROWH;
      const vals = { no, code: a.code, name: a.name, location: a.location || '', made_date: a.made_date || '-', price: a.price || 'N/A', warranty: a.warranty || 'N/A', pv: a.pv || '-', purchase_date: a.purchase_date || 'N/A', note: a.note || '-' };
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        if (c.k in vals) cell.value = vals[c.k];
        cell.font = { name: font, size: 10, color: { argb: 'FF16241A' } };
        cell.alignment = { vertical: 'middle', horizontal: ['no', 'made_date', 'purchase_date', 'warranty', 'photo', 'qr', 'price'].includes(c.k) ? 'center' : 'left', wrapText: true };
        cell.border = { top: thin, bottom: thin, left: thin, right: thin };
        if (no % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAF6' } };
      });
      const cc = row.getCell(ci('code')); cc.value = { text: a.code, hyperlink: cardUrl(a.code) }; cc.font = { name: font, size: 10, bold: true, color: { argb: ARGB(FOREST) }, underline: true };
      if (/ซาก|ชำรุด/.test(a.note || '')) row.getCell(ci('note')).font = { name: font, size: 10, bold: true, color: { argb: 'FFC0392B' } };
      if (withPhoto) { const ph = photos[a.drive_file_id]; if (ph) addImg(ph, ci('photo'), r, pxW(ws.getColumn(ci('photo')).width), rowPx, 4); else row.getCell(ci('photo')).value = 'ไม่มีรูป'; }
      if (withQr) addImg(qrPng(cardUrl(a.code), 180), ci('qr'), r, pxW(ws.getColumn(ci('qr')).width), rowPx, 4);
      r++;
    }
    ws.views = [{ state: 'frozen', ySplit: HR, showGridLines: false }];
    ws.autoFilter = { from: { row: HR, column: 1 }, to: { row: HR, column: N } };
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, printTitlesRow: `${HR}:${HR}`, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 } };
    ws.headerFooter = { oddFooter: `&L&8Major Property Service Co., Ltd.&C&8ทะเบียนทรัพย์สิน ${u.prefix}${loc ? ' · ' + loc : ''}&R&8หน้า &P / &N` };
    /* แผ่นสรุป */
    if (withSum) {
      const sm = wb.addWorksheet('สรุป', { views: [{ showGridLines: false }] });
      sm.columns = [{ width: 30 }, { width: 14 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 13 }, { width: 12 }];
      sm.mergeCells('A1:G1'); sm.getCell('A1').value = `สรุปทะเบียนทรัพย์สิน — ${u.name}`; sm.getCell('A1').font = { name: font, size: 15, bold: true, color: { argb: ARGB(FOREST) } }; sm.getRow(1).height = 30;
      sm.mergeCells('A2:G2'); sm.getCell('A2').value = `ข้อมูล ณ ${today}`; sm.getCell('A2').font = { name: font, size: 9.5, color: { argb: 'FF5F6E63' } };
      for (let c = 1; c <= 7; c++) sm.getCell(3, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(band[Math.min(2, Math.floor((c - 1) * 3 / 7))]) } }; sm.getRow(3).height = 4;
      const H = ['สถานที่', 'รหัสสถานที่', 'จำนวน', 'มีราคา', 'มีใบ PV', 'มีวันที่จัดซื้อ', 'ชำรุด/ซาก'];
      const h5 = sm.getRow(5); h5.height = 24;
      H.forEach((v, i) => { const c = h5.getCell(i + 1); c.value = v; c.font = { name: font, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ARGB(head) } }; c.alignment = { horizontal: 'center', vertical: 'middle' }; });
      const has = v => !!blankish(v) && !/^N\/?A$/i.test(String(v).trim());
      const locs = Array.from(new Set(rows.map(a => codeLoc(a.code))));
      let rr = 6; const tot = [0, 0, 0, 0, 0];
      for (const l of locs) {
        const xs = rows.filter(a => codeLoc(a.code) === l);
        const v = [xs.length, xs.filter(a => has(a.price)).length, xs.filter(a => has(a.pv)).length, xs.filter(a => has(a.purchase_date)).length, xs.filter(a => /ซาก|ชำรุด/.test(a.note || '')).length];
        v.forEach((x, i) => { tot[i] += x; });
        const row = sm.getRow(rr); row.values = [placeName(l), l, ...v]; row.height = 20;
        row.eachCell({ includeEmpty: true }, (c, i) => { c.font = { name: font, size: 10, color: { argb: i === 7 && v[4] ? 'FFC0392B' : 'FF16241A' } }; c.alignment = { horizontal: i <= 2 ? 'left' : 'center', vertical: 'middle' }; c.border = { bottom: thin }; if (rr % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAF6' } }; });
        rr++;
      }
      const tr = sm.getRow(rr); tr.values = ['รวมทั้งหมด', '', ...tot]; tr.height = 22;
      tr.eachCell({ includeEmpty: true }, (c, i) => { c.font = { name: font, size: 10.5, bold: true, color: { argb: ARGB(FOREST) } }; c.alignment = { horizontal: i <= 2 ? 'left' : 'center', vertical: 'middle' }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDF5E4' } }; c.border = { top: { style: 'medium', color: { argb: ARGB(LEAF) } } }; });
      sm.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    }
    const buf = await wb.xlsx.writeBuffer();
    const name = `Asset_Report_${u.prefix}${loc ? '_' + loc : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { kind: 'xlsx', blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name, n: rows.length, ph: Object.keys(photos).length };
  }, 'กำลังสร้างรายงาน…');
  if (!out) return;
  S.lastReport = out;
  showReportOut(out, withPhoto);
}
/** รูปทรัพย์สินจาก Drive (ดึงทีละ 30 รูป · เก็บไว้ใช้ซ้ำทั้ง Excel และ PDF) */
async function fetchPhotos(rows) {
  S.photoCache = S.photoCache || {};
  const photos = {};
  const all = Array.from(new Set(rows.map(a => a.drive_file_id).filter(Boolean)));
  const ids = all.filter(id => !S.photoCache[id]);
  for (let i = 0; i < ids.length; i += 30) {
    $('#busyText').textContent = `กำลังดึงรูป ${Math.min(i + 30, ids.length)}/${ids.length}…`;
    const got = await run('drivePhotoThumbs', ids.slice(i, i + 30), 360);
    for (const [id, d] of (Array.isArray(got) ? got : Object.entries(got || {}))) { const sm = await shrinkImage(d, 240, 180, 0.8); if (sm) S.photoCache[id] = sm; }
  }
  for (const id of all) if (S.photoCache[id]) photos[id] = S.photoCache[id];
  return photos;
}
function showReportOut(out, withPhoto) {
  const pdf = out.kind === 'pdf', label = pdf ? 'PDF' : 'Excel';
  $('#rpOut').innerHTML = `<div class="note ok" style="margin-top:12px">✓ รายงาน ${label} พร้อมแล้ว — ${out.n} รายการ${withPhoto ? ` · รูป ${out.ph} รูป` : ''}${out.pages ? ` · ${out.pages} หน้า` : ''} · ${(out.blob.size / 1048576).toFixed(1)} MB
    <div class="row" style="margin-top:8px"><button class="btn sm" id="rpDl">ดาวน์โหลด ${label}</button>${pdf ? '<button class="btn sm sec" id="rpOpen">เปิดดู</button>' : ''}<button class="btn sm sec" id="rpDrive">บันทึกลง Drive</button><span id="rpMsg" class="small"></span></div></div>`;
  $('#rpDl').onclick = () => downloadBlob(out.blob, out.name);
  if ($('#rpOpen')) $('#rpOpen').onclick = () => { const w = window.open(URL.createObjectURL(out.blob), '_blank'); if (!w) downloadBlob(out.blob, out.name); };
  $('#rpDrive').onclick = async () => {
    const b64 = await blobToB64(out.blob);
    const r = await guard(() => run('driveSaveFile', { prefix: S.unit && S.unit.prefix, name: out.name, mime: out.blob.type, b64, folderName: 'รายงานทะเบียนทรัพย์สิน' }), 'กำลังบันทึกลง Drive…');
    if (r) $('#rpMsg').innerHTML = `✓ บันทึกในโฟลเดอร์ “${esc(r.folder)}” — <a href="${esc(r.url)}" target="_blank">เปิดไฟล์</a>`;
  };
  downloadBlob(out.blob, out.name);
}
/* =================== รายงาน PDF (A4 แนวนอน · วาดบน canvas เพื่อให้สระ/วรรณยุกต์ไทยถูกต้อง) =================== */
function thWrap(ctx, text, maxW, maxLines) {
  text = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  let segs;
  try { segs = Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text), x => x.segment); } catch (e) { segs = text.split(/(\s+)/); }
  const graph = t => { try { return Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(t), x => x.segment); } catch (e) { return Array.from(t); } };
  const lines = []; let cur = '';
  const push = () => { lines.push(cur.trim()); cur = ''; };
  for (const sg of segs) {
    if (ctx.measureText(cur + sg).width <= maxW) { cur += sg; continue; }
    if (cur.trim()) push();
    if (ctx.measureText(sg).width <= maxW) { cur = sg.trimStart(); continue; }
    for (const g of graph(sg)) { if (ctx.measureText(cur + g).width > maxW && cur) push(); cur += g; }
  }
  if (cur.trim()) push();
  if (maxLines && lines.length > maxLines) {
    const out = lines.slice(0, maxLines); let last = out[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    out[maxLines - 1] = last + '…'; return out;
  }
  return lines;
}
async function makeReportPdf() {
  if (!window.jspdf || !window.qrcode) return toast('โหลดไลบรารีไม่สำเร็จ ลองรีเฟรชหน้า', true);
  const u = S.unit, t = u.theme || {};
  const loc = $('#rpLoc').value, withPhoto = $('#rpPhoto').checked, withQr = $('#rpQr').checked, group = $('#rpGroup').checked && !loc, withSum = $('#rpSum').checked;
  const rows = (S.assets || []).filter(a => !loc || codeLoc(a.code) === loc).sort((a, b) => a.code.localeCompare(b.code));
  if (!rows.length) return toast('ไม่มีรายการ', true);
  const out = await guard(async () => {
    const photos = withPhoto ? await fetchPhotos(rows) : {};
    $('#busyText').textContent = 'กำลังจัดหน้า PDF…';
    try { await Promise.all(['400', '600', '700'].map(w => document.fonts.load(`${w} 20px Sarabun`))); } catch (e) { /* ใช้ฟอนต์สำรอง */ }
    const FOREST = '#173D1C', LEAF = '#86BD41', ROOF = '#F38720', INK = '#16241A', MUTED = '#5F6E63', LINE = '#DDE6D6', RED = '#C0392B';
    const head = t.head2 || t.head1 || FOREST, accent = t.accent || LEAF;
    const PW = 297, PH = 210, M = 10, K = 5, FONT = 'Sarabun, Tahoma, sans-serif';
    const TOP = 31, BOTTOM = 197, HDR_H = 9;
    /* คอลัมน์ (มม.) */
    let cols = [{ k: 'no', h: 'ลำดับ', w: 9, al: 'center' }];
    if (withPhoto) cols.push({ k: 'photo', h: 'รูป', w: 26 });
    if (withQr) cols.push({ k: 'qr', h: 'QR', w: 18 });
    cols.push({ k: 'code', h: 'รหัสทรัพย์สิน', w: 34 }, { k: 'name', h: 'ชื่อทรัพย์สิน', w: 54 }, { k: 'location', h: 'สถานที่', w: 22 },
      { k: 'made_date', h: 'วันที่จัดทำ', w: 17, al: 'center' }, { k: 'price', h: 'ราคา', w: 19, al: 'center' }, { k: 'warranty', h: 'ระยะเวลาประกัน', w: 17, al: 'center' },
      { k: 'pv', h: 'ใบ PV', w: 20 }, { k: 'purchase_date', h: 'วันที่จัดซื้อ', w: 17, al: 'center' }, { k: 'note', h: 'หมายเหตุ', w: 24 });
    let spare = (PW - 2 * M) - cols.reduce((s2, c) => s2 + c.w, 0);
    if (spare >= 12) { cols.find(c => c.k === 'code').w += 6; cols.find(c => c.k === 'made_date').w += 2; cols.find(c => c.k === 'purchase_date').w += 2; spare -= 10; }
    cols.find(c => c.k === 'name').w += spare * 0.6; cols.find(c => c.k === 'note').w += spare * 0.4;
    let xx = M; cols.forEach(c => { c.x = xx; xx += c.w; });
    const colOf = k => cols.find(c => c.k === k);
    /* รูปที่ต้องใช้ */
    const imgs = {};
    for (const id of Object.keys(photos)) imgs[id] = await loadImg(photos[id].data);
    const unitLogo = await loadImg(u.logo_house), mjLogo = await loadImg(($('#brandLogo') || {}).src || u.logo_mj);
    const today = S.cfg.today;
    /* วาด */
    const mk = () => { const c = document.createElement('canvas'); c.width = PW * K; c.height = PH * K; const x = c.getContext('2d'); x.scale(K, K); x.fillStyle = '#fff'; x.fillRect(0, 0, PW, PH); x.textBaseline = 'middle'; return { c, x }; };
    const font = (x, size, w) => { x.font = `${w || 400} ${size}px ${FONT}`; };
    const contain = (x, im, bx, by, bw, bh) => { if (!im) return; const sc = Math.min(bw / im.naturalWidth, bh / im.naturalHeight); const w = im.naturalWidth * sc, h = im.naturalHeight * sc; x.drawImage(im, bx + (bw - w) / 2, by + (bh - h) / 2, w, h); };
    const drawQr = (x, text, bx, by, size) => {
      const q = qrcode(0, 'M'); q.addData(text, 'Byte'); q.make(); const n = q.getModuleCount(), cell = size / (n + 2);
      x.fillStyle = '#fff'; x.fillRect(bx, by, size, size); x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k2 = 0; k2 < n; k2++) if (q.isDark(r, k2)) x.fillRect(bx + (k2 + 1) * cell, by + (r + 1) * cell, cell + 0.02, cell + 0.02);
    };
    const subtitle = u.name + (loc ? ' · ' + placeName(loc) : '');
    const pageHeader = (x, title) => {
      contain(x, unitLogo, M, 6, 40, 18);
      contain(x, mjLogo, PW - M - 40, 6, 40, 18);
      x.textAlign = 'center';
      font(x, 6.2, 700); x.fillStyle = FOREST; x.fillText(title, PW / 2, 11.5);
      font(x, 3.9, 700); x.fillStyle = head; x.fillText(subtitle, PW / 2, 18);
      font(x, 2.9); x.fillStyle = MUTED; x.fillText(`จำนวน ${rows.length.toLocaleString('th-TH')} รายการ  ·  ข้อมูล ณ ${today}  ·  จัดทำโดย ${CREATED_BY}`, PW / 2, 23.2);
      const bw = (PW - 2 * M) / 3; [FOREST, LEAF, ROOF].forEach((c, i) => { x.fillStyle = c; x.fillRect(M + i * bw, 26.6, bw, 1.3); });
    };
    const pageFooter = (x, pg, total) => {
      font(x, 2.5); x.fillStyle = '#8A978D';
      x.textAlign = 'left'; x.fillText('Major Property Service Co., Ltd. · ฝ่ายธุรการและประชาสัมพันธ์ (ADM-PR)', M, 204);
      x.textAlign = 'center'; x.fillText(`ทะเบียนทรัพย์สิน ${u.prefix}${loc ? ' · ' + loc : ''}`, PW / 2, 204);
      x.textAlign = 'right'; x.fillText(`หน้า ${pg} / ${total}`, PW - M, 204);
      x.strokeStyle = LINE; x.lineWidth = 0.2; x.beginPath(); x.moveTo(M, 200.5); x.lineTo(PW - M, 200.5); x.stroke();
    };
    const tableHeader = (x, y) => {
      x.fillStyle = head; x.fillRect(M, y, PW - 2 * M, HDR_H);
      x.fillStyle = accent; x.fillRect(M, y + HDR_H - 0.7, PW - 2 * M, 0.7);
      font(x, 2.7, 700); x.fillStyle = '#fff'; x.textAlign = 'center';
      for (const c of cols) { const ls = thWrap(x, c.h, c.w - 2, 2); ls.forEach((l, i) => x.fillText(l, c.x + c.w / 2, y + HDR_H / 2 - 0.35 + (i - (ls.length - 1) / 2) * 3.1)); }
      return y + HDR_H;
    };
    /* วัดความสูงแต่ละแถว */
    const meas = mk().x; font(meas, 2.9);
    const LH = 3.75, PAD = 1.6, TEXT_KEYS = ['code', 'name', 'location', 'made_date', 'price', 'warranty', 'pv', 'purchase_date', 'note'];
    const ONE_LINE = ['made_date', 'price', 'warranty', 'purchase_date'];   // บรรทัดเดียว ย่อขนาดตัวอักษรให้พอดีช่อง
    const baseH = withPhoto ? 21 : withQr ? 17 : 0;
    const valOf = a => ({ no: '', code: a.code, name: a.name, location: a.location || '', made_date: a.made_date || '-', price: a.price || 'N/A', warranty: a.warranty || 'N/A', pv: a.pv || '-', purchase_date: a.purchase_date || 'N/A', note: a.note || '-' });
    const layout = rows.map((a, i) => {
      const v = valOf(a), maxL = baseH ? Math.max(1, Math.floor((baseH - 2 * PAD) / LH)) : 6;
      const lines = {}; let most = 1;
      for (const k of TEXT_KEYS) {
        const c = colOf(k); font(meas, 2.9, k === 'code' ? 700 : 400);
        lines[k] = ONE_LINE.includes(k) && meas.measureText(String(v[k])).width <= (c.w - 1.6) / 0.78 ? [String(v[k])] : thWrap(meas, v[k], c.w - 2.4, maxL);
        most = Math.max(most, lines[k].length);
      }
      return { a, no: i + 1, lines, h: Math.max(baseH, most * LH + 2 * PAD, 8.5) };
    });
    /* แบ่งหน้า */
    const items = []; let curLoc = null;
    for (const L of layout) { const l = codeLoc(L.a.code); if (group && l !== curLoc) { curLoc = l; items.push({ g: l, h: 7.5 }); } items.push(L); }
    const pages = []; let pg = [], y = TOP + HDR_H;
    for (let i = 0; i < items.length; i++) {
      const it = items[i], need = it.g ? it.h + (items[i + 1] ? items[i + 1].h : 0) : it.h;
      if (y + need > BOTTOM && pg.length) { pages.push(pg); pg = []; y = TOP + HDR_H; }
      pg.push(it); y += it.h;
    }
    if (pg.length) pages.push(pg);
    const total = pages.length + (withSum ? 1 : 0);
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
    doc.setProperties({ title: `ทะเบียนทรัพย์สิน ${u.prefix}`, author: 'Major Property Service · ADM-PR', creator: 'ระบบ QR ทะเบียนทรัพย์สิน' });
    let pageNo = 0;
    const addPage = (c) => { if (pageNo > 0) doc.addPage('a4', 'landscape'); pageNo++; doc.addImage(c.toDataURL('image/jpeg', 0.82), 'JPEG', 0, 0, PW, PH, undefined, 'FAST'); };
    /* หน้าสรุป */
    if (withSum) {
      const { c, x } = mk(); pageHeader(x, 'สรุปทะเบียนทรัพย์สิน');
      const has = v => !!blankish(v) && !/^N\/?A$/i.test(String(v).trim());
      const H = ['สถานที่', 'รหัสสถานที่', 'จำนวน', 'มีรูป', 'มีราคา', 'มีใบ PV', 'มีวันที่จัดซื้อ', 'ชำรุด/ซาก'], W = [78, 38, 22, 22, 22, 22, 30, 24];
      const tw = W.reduce((s2, w) => s2 + w, 0), x0 = (PW - tw) / 2; let yy = 36;
      x.fillStyle = head; x.fillRect(x0, yy, tw, 9); font(x, 3, 700); x.fillStyle = '#fff';
      let cx = x0; H.forEach((h, i) => { x.textAlign = i < 2 ? 'left' : 'center'; x.fillText(h, i < 2 ? cx + 2.5 : cx + W[i] / 2, yy + 4.6); cx += W[i]; }); yy += 9;
      const locs = Array.from(new Set(rows.map(a => codeLoc(a.code)))); const tot = [0, 0, 0, 0, 0, 0];
      const line = (vals, bold, fill, red) => {
        if (fill) { x.fillStyle = fill; x.fillRect(x0, yy, tw, 7.5); }
        font(x, 3, bold ? 700 : 400); let cx2 = x0;
        vals.forEach((v, i) => { x.fillStyle = i === 7 && red ? RED : bold ? FOREST : INK; x.textAlign = i < 2 ? 'left' : 'center'; const tx = i < 2 ? thWrap(x, String(v), W[i] - 4, 1)[0] || '' : String(v); x.fillText(tx, i < 2 ? cx2 + 2.5 : cx2 + W[i] / 2, yy + 3.9); cx2 += W[i]; });
        x.strokeStyle = LINE; x.lineWidth = 0.2; x.beginPath(); x.moveTo(x0, yy + 7.5); x.lineTo(x0 + tw, yy + 7.5); x.stroke(); yy += 7.5;
      };
      locs.forEach((l, i) => {
        const xs = rows.filter(a => codeLoc(a.code) === l);
        const v = [xs.length, xs.filter(a => a.drive_file_id).length, xs.filter(a => has(a.price)).length, xs.filter(a => has(a.pv)).length, xs.filter(a => has(a.purchase_date)).length, xs.filter(a => /ซาก|ชำรุด/.test(a.note || '')).length];
        v.forEach((n, k) => { tot[k] += n; });
        if (yy < 190) line([placeName(l), l, ...v], false, i % 2 ? '#F8FAF6' : null, v[5] > 0);
      });
      x.fillStyle = LEAF; x.fillRect(x0, yy, tw, 0.6); yy += 0.6;
      line(['รวมทั้งหมด', '', ...tot], true, '#EDF5E4', tot[5] > 0);
      pageFooter(x, 1, total); addPage(c);
    }
    /* หน้ารายการ */
    for (let p = 0; p < pages.length; p++) {
      $('#busyText').textContent = `กำลังสร้าง PDF หน้า ${p + 1}/${pages.length}…`;
      await new Promise(r => setTimeout(r, 0));
      const { c, x } = mk(); pageHeader(x, 'ทะเบียนทรัพย์สิน');
      let yy = tableHeader(x, TOP); const links = [];
      for (const it of pages[p]) {
        if (it.g) {
          x.fillStyle = '#EDF5E4'; x.fillRect(M, yy, PW - 2 * M, it.h); x.fillStyle = LEAF; x.fillRect(M, yy, 1.2, it.h);
          const cnt = rows.filter(a => codeLoc(a.code) === it.g).length;
          font(x, 3.1, 700); x.fillStyle = FOREST; x.textAlign = 'left'; x.fillText(`สถานที่: ${placeName(it.g)}  (${it.g})  ·  ${cnt} รายการ`, M + 3.5, yy + it.h / 2);
          yy += it.h; continue;
        }
        const a = it.a;
        if (it.no % 2 === 0) { x.fillStyle = '#F8FAF6'; x.fillRect(M, yy, PW - 2 * M, it.h); }
        x.strokeStyle = LINE; x.lineWidth = 0.2; x.beginPath(); x.moveTo(M, yy + it.h); x.lineTo(PW - M, yy + it.h); x.stroke();
        for (const cl of cols) { x.beginPath(); x.moveTo(cl.x, yy); x.lineTo(cl.x, yy + it.h); x.stroke(); }
        x.beginPath(); x.moveTo(PW - M, yy); x.lineTo(PW - M, yy + it.h); x.stroke();
        font(x, 2.9); x.fillStyle = MUTED; x.textAlign = 'center'; const cn = colOf('no'); x.fillText(String(it.no), cn.x + cn.w / 2, yy + it.h / 2);
        if (withPhoto) { const cp = colOf('photo'), im = imgs[a.drive_file_id]; if (im) contain(x, im, cp.x + 1.2, yy + 1.2, cp.w - 2.4, it.h - 2.4); else { font(x, 2.5); x.fillStyle = '#A3AEA5'; x.fillText('ไม่มีรูป', cp.x + cp.w / 2, yy + it.h / 2); } }
        if (withQr) { const cq = colOf('qr'), sz = Math.min(cq.w - 3, it.h - 2.6); drawQr(x, cardUrl(a.code), cq.x + (cq.w - sz) / 2, yy + (it.h - sz) / 2, sz); }
        for (const k of TEXT_KEYS) {
          const cl = colOf(k), ls = it.lines[k];
          const red = k === 'note' && /ซาก|ชำรุด/.test(a.note || '');
          let fs = 2.9; font(x, fs, k === 'code' || red ? 700 : 400);
          if (ONE_LINE.includes(k) && ls.length === 1) { const wd = x.measureText(ls[0]).width; if (wd > cl.w - 1.6) { fs = Math.max(2.25, fs * (cl.w - 1.6) / wd); font(x, fs); } }
          x.fillStyle = k === 'code' ? FOREST : red ? RED : INK;
          x.textAlign = cl.al === 'center' ? 'center' : 'left';
          const tx = cl.al === 'center' ? cl.x + cl.w / 2 : cl.x + 1.2, y0 = yy + it.h / 2 - (ls.length - 1) * LH / 2;
          ls.forEach((l, i) => x.fillText(l, tx, y0 + i * LH));
          if (k === 'code') { links.push({ x: cl.x, y: yy, w: cl.w, h: it.h, url: cardUrl(a.code) }); x.fillRect(cl.x + 1.2, y0 + 1.6, Math.min(cl.w - 2.4, x.measureText(ls[0] || '').width), 0.18); }
        }
        yy += it.h;
      }
      pageFooter(x, p + 1 + (withSum ? 1 : 0), total); addPage(c);
      for (const L of links) doc.link(L.x, L.y, L.w, L.h, { url: L.url });
    }
    const blob = doc.output('blob');
    const name = `Asset_Report_${u.prefix}${loc ? '_' + loc : ''}_${new Date().toISOString().slice(0, 10)}.pdf`;
    return { kind: 'pdf', blob, name, n: rows.length, ph: Object.keys(photos).length, pages: total };
  }, 'กำลังสร้างรายงาน PDF…');
  if (!out) return;
  S.lastReport = out;
  showReportOut(out, withPhoto);
}
function saveCopyOffer(blob, name, mime, target) {
  toast('กำลังดาวน์โหลด… ถ้าไม่ขึ้น กด “บันทึกลง Drive” แทน');
  const bar = document.createElement('div'); bar.className = 'note info'; bar.style.marginTop = '10px';
  bar.innerHTML = `ถ้าไฟล์ไม่ดาวน์โหลด: <button class="btn sm">บันทึกลง Drive</button>`;
  (target || $('#main .card')).appendChild(bar);
  $('button', bar).onclick = async () => {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
    const out = await guard(() => run('driveSaveFile', { prefix: S.unit && S.unit.prefix, name, mime, b64 }), 'กำลังบันทึกลง Drive…');
    if (out) bar.innerHTML = `✓ บันทึกแล้วในโฟลเดอร์ “${esc(out.folder)}” — <a href="${esc(out.url)}" target="_blank">เปิดไฟล์</a>`;
  };
}

/* =================== ทำ QR PDF =================== */
function qrRowState(code) { return S.qr.rows[code] || (S.qr.rows[code] = { on: true, n: 1, names: '' }); }
function qtyHint(name) { const m = String(name || '').match(/จำนวน\s*(\d+)/); return m && Number(m[1]) > 1 ? Number(m[1]) : 0; }
VIEWS.qr = async (main) => {
  const u = S.unit;
  if (!S.qr.loc) { const ps = placesWithCounts(); S.qr.loc = ps.length ? ps[0].loc : ''; }
  main.innerHTML = `
  <h2>ทำ QR PDF</h2>
  <p class="sub">มาตรฐาน 20 ดวง/หน้า A4 (4×5 ป้ายกว้าง ~44 มม.) · ของเป็นชุดใส่ “จำนวน QR” เช่น 4 → ได้ 1/4…4/4 · รูปเดียวหลายชนิดใส่ “แยกชื่อ” ทีละบรรทัด (เช่น <code>รถเข็นหน้าแบน x2</code>)</p>
  ${u.supports_split ? '' : `<div class="note" style="margin-bottom:12px">การ์ดของ ${esc(u.prefix)} (${esc(u.card_fn)}) ยังไม่รองรับการแยก QR — ถ้าใส่จำนวน/แยกชื่อ ป้ายจะพิมพ์แยกได้ แต่การ์ดที่สแกนจะแสดงข้อมูลปกติ</div>`}
  <div class="card"><div class="row">
    <label class="f" style="flex:1;min-width:220px">สถานที่<select id="qrLoc">${placeOptions(S.qr.loc, true, 'ทุกสถานที่')}</select></label>
    <label class="f">ขนาด<select id="qrPer"><option value="20">20 ดวง/หน้า (4×5) — มาตรฐาน</option><option value="30">30 ดวง/หน้า (5×6) — เล็ก</option><option value="12">12 ดวง/หน้า (3×4) — ใหญ่</option></select></label>
    <label class="f" style="flex:1;min-width:220px">หัวกระดาษ<input id="qrTitle"></label>
  </div></div>
  <div class="row" style="margin-bottom:6px;justify-content:space-between"><div class="row"><button class="btn sm sec" id="qrAll">เลือกทั้งหมด</button><button class="btn sm sec" id="qrNone">ไม่เลือก</button><span id="qrCount" class="muted small"></span></div>
    <button class="btn accent" id="qrMake">สร้าง PDF</button></div>
  <div class="tablewrap"><table><thead><tr><th></th><th>รหัส</th><th>ชื่อ</th><th>จำนวน QR</th><th>แยกชื่อ (บรรทัดละ 1 ชนิด, ใส่ x2 ท้ายชื่อถ้ามีหลายชิ้น)</th></tr></thead><tbody id="qrBody"></tbody></table></div>
  <div id="qrOut" style="margin-top:14px"></div>`;
  $('#qrPer').value = String(S.qr.per || 20);
  const items = () => (S.assets || []).filter(a => !S.qr.loc || codeLoc(a.code) === S.qr.loc).sort((a, b) => a.code.localeCompare(b.code));
  const setTitle = () => { $('#qrTitle').value = `${u.prefix} · ${S.qr.loc ? placeName(S.qr.loc) : u.name} · QR ทะเบียนทรัพย์สิน`; };
  const count = () => { const specs = buildSpecs(items()); $('#qrCount').textContent = `· รวม ${specs.length} ป้าย (${Math.ceil(specs.length / Number($('#qrPer').value)) || 0} หน้า)`; };
  const draw = () => {
    const list = items();
    $('#qrBody').innerHTML = list.length ? list.map(a => {
      const s = qrRowState(a.code); const h = qtyHint(a.name);
      return `<tr data-code="${esc(a.code)}"><td><input type="checkbox" data-k="on" ${s.on ? 'checked' : ''}></td><td><b>${esc(a.code)}</b></td><td>${esc(a.name)}${h && s.n === 1 && !s.names ? `<div class="hint">ชื่อมี “จำนวน ${h}” <button class="btn sm sec" data-use="${h}">แยก ${h} ใบ</button></div>` : ''}</td>
      <td><input class="num" type="number" min="1" max="200" data-k="n" value="${s.n}"></td>
      <td><textarea data-k="names" rows="${s.names ? Math.min(4, s.names.split('\n').length) : 1}" style="width:100%;min-width:200px;border:1px solid #d5ded0;border-radius:6px;padding:4px 6px" placeholder="(ไม่แยก)">${esc(s.names)}</textarea></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">ไม่มีรายการ</td></tr>';
    $$('#qrBody tr[data-code]').forEach(tr => {
      const s = qrRowState(tr.dataset.code);
      $$('[data-k]', tr).forEach(inp => inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', () => {
        const k = inp.dataset.k; s[k] = k === 'on' ? inp.checked : k === 'n' ? Math.max(1, Math.min(200, Number(inp.value) || 1)) : inp.value; count();
      }));
      const ub = $('[data-use]', tr); if (ub) ub.onclick = () => { s.n = Number(ub.dataset.use); draw(); };
    });
    count();
  };
  $('#qrLoc').onchange = e => { S.qr.loc = e.target.value; setTitle(); draw(); };
  $('#qrPer').onchange = e => { S.qr.per = Number(e.target.value); count(); };
  $('#qrAll').onclick = () => { items().forEach(a => { qrRowState(a.code).on = true; }); draw(); };
  $('#qrNone').onclick = () => { items().forEach(a => { qrRowState(a.code).on = false; }); draw(); };
  $('#qrMake').onclick = () => makePdf(items());
  setTitle(); draw();
};
function buildSpecs(list) {
  const specs = [];
  for (const a of list) {
    const s = qrRowState(a.code); if (!s.on) continue;
    const lines = String(s.names || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (lines.length) {
      for (const ln of lines) {
        const m = ln.match(/^(.*?)\s*[x×*]\s*(\d+)\s*$/i); const nm = (m ? m[1] : ln).trim(); const k = m ? Math.max(1, Math.min(200, Number(m[2]))) : 1;
        if (k > 1) for (let i = 1; i <= k; i++) specs.push({ url: cardUrl(a.code, `&nm=${encodeURIComponent(nm)}&n=${i}&of=${k}`), l1: a.code, l2: `${shortName(nm)}  (${i}/${k})` });
        else specs.push({ url: cardUrl(a.code, `&nm=${encodeURIComponent(nm)}`), l1: a.code, l2: shortName(nm) });
      }
    } else if (s.n > 1) {
      for (let i = 1; i <= s.n; i++) specs.push({ url: cardUrl(a.code, `&n=${i}&of=${s.n}`), l1: a.code, l2: `${shortName(a.name)}  (${i}/${s.n})` });
    } else specs.push({ url: cardUrl(a.code), l1: a.code, l2: '' });
  }
  return specs;
}

/* ----- วาดป้าย (แบบเดียวกับ make_unit_pdf.py) ----- */
function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function fitFont(x, text, maxw, weight, start, lo) {
  for (let s = start; s >= lo; s -= 2) { x.font = `${weight} ${s}px Sarabun`; if (x.measureText(text).width <= maxw) return s; }
  return lo;
}
function clip(x, text, maxw) { if (x.measureText(text).width <= maxw) return text; let t = text; while (t.length > 1 && x.measureText(t + '…').width > maxw) t = t.slice(0, -1); return t + '…'; }
function drawLabel(spec, logos, col, scale) {
  const W = 900, H = 1060, frame = 20;
  const c = document.createElement('canvas'); c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const x = c.getContext('2d'); x.scale(scale, scale);
  x.fillStyle = col.frame; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff'; rr(x, frame, frame, W - 2 * frame, H - 2 * frame, 30); x.fill();
  x.fillStyle = col.acc; rr(x, frame, frame, W - 2 * frame, 8, 4); x.fill();
  // QR (โมดูลขนาดเต็มพิกเซล คมชัด)
  const q = qrcode(0, 'Q'); q.addData(spec.url, 'Byte'); q.make();
  const n = q.getModuleCount(), border = 2, box = 560, qy = 64;
  x.setTransform(1, 0, 0, 1, 0, 0);
  const boxD = box * scale, cell = Math.floor(boxD / (n + 2 * border)), sizeD = cell * (n + 2 * border);
  const ox = Math.round((W * scale - sizeD) / 2), oy = Math.round(qy * scale + (boxD - sizeD) / 2);
  x.fillStyle = '#fff'; x.fillRect(ox, oy, sizeD, sizeD); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let cc = 0; cc < n; cc++) if (q.isDark(r, cc)) x.fillRect(ox + (cc + border) * cell, oy + (r + border) * cell, cell, cell);
  x.setTransform(scale, 0, 0, scale, 0, 0);
  // แถบรหัส
  const bt = qy + box + 22, bh = spec.l2 ? 142 : 90, bx = frame + 26, bw = W - 2 * frame - 52, inner = bw - 30;
  x.fillStyle = col.band; rr(x, bx, bt, bw, bh, 16); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'top';
  if (spec.l2) {
    const s1 = fitFont(x, spec.l1, inner, 400, 34, 22); x.fillText(clip(x, spec.l1, inner), W / 2, bt + 16);
    const s2 = fitFont(x, spec.l2, inner, 700, 42, 26); x.fillText(clip(x, spec.l2, inner), W / 2, bt + 16 + s1 + 10); void s2;
  } else {
    const s1 = fitFont(x, spec.l1, inner, 700, 44, 26); x.fillText(clip(x, spec.l1, inner), W / 2, bt + (bh - s1) / 2 - 2);
  }
  // โลโก้ 2 ข้าง
  const ft = bt + bh + 18, fh = H - frame - ft - 16, ph = Math.min(96, fh), pw = 260, gap = 40, x0 = (W - (pw * 2 + gap)) / 2, py = ft + (fh - ph) / 2;
  [logos.house, logos.mj].forEach((lg, i) => {
    const px = x0 + i * (pw + gap);
    x.fillStyle = '#fff'; rr(x, px, py, pw, ph, 12); x.fill(); x.strokeStyle = '#e1e4ea'; x.lineWidth = 2; x.stroke();
    if (lg) { const bw2 = pw - 26, bh2 = ph - 26, sc = Math.min(bw2 / lg.naturalWidth, bh2 / lg.naturalHeight); const w = lg.naturalWidth * sc, h = lg.naturalHeight * sc; x.drawImage(lg, px + 13 + (bw2 - w) / 2, py + 13 + (bh2 - h) / 2, w, h); }
  });
  return c;
}
function textImage(text, wmm, hmm, color, align) {
  const k = 12, c = document.createElement('canvas'); c.width = Math.round(wmm * k); c.height = Math.round(hmm * k);
  const x = c.getContext('2d'); x.fillStyle = color; x.textBaseline = 'middle'; x.textAlign = align || 'left';
  x.font = `700 ${Math.round(hmm * k * 0.62)}px Sarabun`;
  x.fillText(clip(x, text, c.width), align === 'right' ? c.width : 0, c.height / 2);
  return c.toDataURL('image/png');
}
async function makePdf(list) {
  const u = S.unit, specs = buildSpecs(list);
  if (!specs.length) return toast('ยังไม่ได้เลือกรายการ', true);
  if (!window.jspdf || !window.qrcode) return toast('โหลดไลบรารีไม่สำเร็จ ลองรีเฟรชหน้า', true);
  const per = Number($('#qrPer').value); const [COLS, ROWS] = per === 30 ? [5, 6] : per === 12 ? [3, 4] : [4, 5];
  const title = $('#qrTitle').value.trim();
  const t = u.theme || {};
  const col = { frame: t.pdf_frame || '#262a30', band: t.pdf_band || '#2F7A2B', acc: t.pdf_acc || t.pdf_band || '#86BC45' };
  const out = await guard(async () => {
    await Promise.all(['400 30px Sarabun', '700 40px Sarabun'].map(f => document.fonts.load(f, 'กขคงจ ABC 123')));
    const logos = { house: await loadImg(u.logo_house), mj: await loadImg(u.logo_mj) };
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const PW = 210, PH = 297, mx = 8, mt = 13, mb = 8, gx = 5, gy = 5, aspect = 1060 / 900, PP = COLS * ROWS;
    const cw = Math.min((PW - 2 * mx - (COLS - 1) * gx) / COLS, (PH - mt - mb - (ROWS - 1) * gy) / ROWS / aspect), ch = cw * aspect;
    const gw = COLS * cw + (COLS - 1) * gx, left = (PW - gw) / 2;
    const npg = Math.ceil(specs.length / PP);
    const scale = Math.min(1, (cw / 25.4 * 330) / 900); // ~330 dpi
    const prev = document.createElement('canvas'); const K = 3; prev.width = PW * K; prev.height = PH * K; const px = prev.getContext('2d'); px.fillStyle = '#fff'; px.fillRect(0, 0, prev.width, prev.height);
    for (let pg = 0; pg < npg; pg++) {
      $('#busyText').textContent = `กำลังสร้างหน้า ${pg + 1}/${npg}…`;
      await new Promise(r => setTimeout(r, 0));
      if (pg) doc.addPage();
      if (title) doc.addImage(textImage(title, 150, 5, col.frame), 'PNG', mx, 5.5, 150, 5);
      doc.addImage(textImage(`หน้า ${pg + 1}/${npg}`, 30, 4.4, '#808080', 'right'), 'PNG', PW - mx - 30, 6, 30, 4.4);
      const chunk = specs.slice(pg * PP, (pg + 1) * PP);
      chunk.forEach((sp, i) => {
        const r = Math.floor(i / COLS), c = i % COLS, X = left + c * (cw + gx), Y = mt + r * (ch + gy);
        const lab = drawLabel(sp, logos, col, scale);
        doc.addImage(lab.toDataURL('image/jpeg', 0.85), 'JPEG', X, Y, cw, ch, undefined, 'FAST');
        if (pg === 0) px.drawImage(lab, X * K, Y * K, cw * K, ch * K);
      });
      const ur = Math.ceil(chunk.length / COLS);
      doc.setLineDashPattern([0.7, 1.05], 0); doc.setDrawColor(166, 166, 166); doc.setLineWidth(0.18);
      const top = mt - gy / 2, bot = mt + ur * ch + (ur - 1) * gy + gy / 2;
      for (let c = 0; c <= COLS; c++) { const xx = left + c * (cw + gx) - gx / 2; doc.line(xx, top, xx, bot); }
      for (let r = 0; r <= ur; r++) { const yy = mt + r * (ch + gy) - gy / 2; doc.line(left - gx / 2, yy, left + gw + gx / 2, yy); }
      doc.setLineDashPattern([], 0);
    }
    if (title) { const im = await loadImg(textImage(title, 150, 5, col.frame)); px.drawImage(im, mx * K, 5.5 * K, 150 * K, 5 * K); }
    const fname = `QR_${u.prefix}_${S.qr.loc || 'ALL'}_${new Date().toISOString().slice(0, 10)}.pdf`;
    return { doc, fname, npg, n: specs.length, preview: prev.toDataURL('image/jpeg', 0.85), labelMm: cw };
  }, 'กำลังสร้าง PDF…');
  if (!out) return;
  S.qr.last = out;
  $('#qrOut').innerHTML = `<div class="card"><h3>PDF พร้อมแล้ว — ${out.n} ป้าย · ${out.npg} หน้า · ป้ายกว้าง ${out.labelMm.toFixed(1)} มม.</h3>
    <div class="row" style="margin-bottom:10px"><button class="btn" id="qrDl">ดาวน์โหลด PDF</button><button class="btn sec" id="qrDrive">บันทึกลง Drive</button><span id="qrDriveMsg" class="small"></span></div>
    <img id="qrPreview" src="${out.preview}" alt="ตัวอย่างหน้าแรก"><div class="small muted">ตัวอย่างหน้าแรก — ลองสแกนจากจอเพื่อตรวจก่อนพิมพ์ได้</div></div>`;
  $('#qrDl').onclick = () => { try { out.doc.save(out.fname); } catch (e) { toast('ดาวน์โหลดไม่ได้ ให้ใช้ “บันทึกลง Drive”', true); } };
  $('#qrDrive').onclick = async () => {
    const b64 = out.doc.output('datauristring').split(',')[1];
    const r = await guard(() => run('driveSaveFile', { prefix: S.unit && S.unit.prefix, folderId: null, name: out.fname, mime: 'application/pdf', b64 }), 'กำลังบันทึกลง Drive…');
    if (r) $('#qrDriveMsg').innerHTML = `✓ บันทึกในโฟลเดอร์ “${esc(r.folder)}” — <a href="${esc(r.url)}" target="_blank">เปิดไฟล์</a>`;
  };
  $('#qrOut').scrollIntoView({ behavior: 'smooth' });
}

/* =================== ตั้งค่าหน่วยงาน =================== */
const THEME_KEYS = [['head1', 'หัวการ์ด (ซ้าย)'], ['head2', 'หัวการ์ด (ขวา)'], ['accent', 'เส้นใต้หัว'], ['label', 'ช่องหัวข้อ'], ['alt1', 'แถวสลับ 1'], ['alt2', 'แถวสลับ 2'], ['value', 'ตัวอักษรข้อมูล'], ['pdf_frame', 'PDF: กรอบป้าย'], ['pdf_band', 'PDF: แถบรหัส'], ['pdf_acc', 'PDF: เส้นบน']];
const THEME_DEF = { head1: '#2F7A2B', head2: '#173F22', accent: '#86BC45', label: '#24452c', alt1: '#f3f7f1', alt2: '#e8f1e2', value: '#1d2a22', pdf_frame: '#173F22', pdf_band: '#2F7A2B', pdf_acc: '#86BC45' };
VIEWS.units = async (main) => {
  if (isUnitUser()) { main.innerHTML = '<div class="card note">เมนูนี้สำหรับผู้ดูแลระบบเท่านั้น</div>'; return; }
  main.innerHTML = `
  <h2>ตั้งค่าหน่วยงาน</h2>
  <p class="sub">เพิ่มหน่วยงานใหม่ได้เอง: ตั้งรหัส ชื่อ โลโก้ สีการ์ด และผูกโฟลเดอร์หลักใน Google Drive</p>
  <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">หน่วยงานทั้งหมด</h3><button class="btn" id="uNew">+ เพิ่มหน่วยงานใหม่</button></div>
  <div class="tablewrap"><table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>การ์ด</th><th>รายการ</th><th>โฟลเดอร์ Drive</th><th></th></tr></thead><tbody>
  ${S.units.map(u => `<tr><td><b>${esc(u.prefix)}</b></td><td>${esc(u.name)}</td><td><code>${esc(u.card_fn)}</code></td><td>${u.asset_count || 0}</td>
    <td>${u.drive_folder_id ? `<a target="_blank" href="https://drive.google.com/drive/folders/${esc(u.drive_folder_id)}">เปิด</a>` : '<span class="pill warn">ยังไม่ผูก</span>'}</td>
    <td><button class="btn sm sec" data-edit="${esc(u.prefix)}">แก้ไข</button></td></tr>`).join('')}
  </tbody></table></div></div>
  <div id="uForm"></div>`;
  $('#uNew').onclick = () => { S.uedit = { isNew: true, prefix: '', name: '', subtitle: '', header_title: '', drive_folder_id: '', theme: { ...THEME_DEF }, logo_house: null, logo_mj: (S.units.find(u => u.logo_mj) || {}).logo_mj || null, sort: 100, active: true }; renderUnitForm(); };
  $$('button[data-edit]').forEach(b => b.onclick = () => { const u = S.units.find(x => x.prefix === b.dataset.edit); S.uedit = JSON.parse(JSON.stringify({ ...u, isNew: false })); S.uedit.theme = { ...THEME_DEF, ...(u.theme || {}) }; renderUnitForm(); });
  if (S.uedit) renderUnitForm();
};
function mockCard(e) {
  const t = e.theme;
  return `<div class="mock"><div class="mh" style="background:linear-gradient(90deg,${t.head1},${t.head2});border-bottom-color:${t.accent}">
    <div class="lg">${e.logo_house ? `<img src="${e.logo_house}">` : ''}</div><div class="tt"><b>ทะเบียนทรัพย์สิน</b><br><span style="opacity:.9">${esc(e.subtitle || e.name || '')}</span></div><div class="lg">${e.logo_mj ? `<img src="${e.logo_mj}">` : ''}</div></div>
    <div style="height:70px;background:#eceff1;display:grid;place-items:center;color:#99a;font-size:12px">รูปทรัพย์สิน</div>
    ${[['รหัส', (e.prefix || 'XXX') + '.LOBY.202610001'], ['ชื่อ', 'โซฟา 2 ตัว'], ['สถานที่', 'ล็อบบี้'], ['หมายเหตุ', '-']].map(([k, v], i) => `<div class="mr"><div class="k" style="background:${t.label}">${k}</div><div style="background:${i % 2 ? t.alt2 : t.alt1};color:${t.value}">${esc(v)}</div></div>`).join('')}
    <div style="background:linear-gradient(90deg,${t.head1},${t.head2});color:#fff;font-size:10px;padding:4px 8px">Major Property Service Co., Ltd.</div></div>`;
}
function renderUnitForm() {
  const e = S.uedit, box = $('#uForm'); if (!box || !e) return;
  const dedicated = !e.isNew && e.card_fn && e.card_fn !== 'card';
  box.innerHTML = `<div class="card"><h3>${e.isNew ? 'เพิ่มหน่วยงานใหม่' : 'แก้ไข ' + esc(e.prefix)}</h3>
  <div class="grid g2">
    <div class="grid" style="align-content:start">
      <div class="grid g2">
        <label class="f">รหัสหน่วยงาน (อังกฤษพิมพ์ใหญ่ 2–10 ตัว)<input id="ufPrefix" value="${esc(e.prefix)}" ${e.isNew ? '' : 'disabled'} placeholder="เช่น ABC"></label>
        <label class="f">ชื่อหน่วยงาน<input id="ufName" value="${esc(e.name)}"></label>
      </div>
      <label class="f">บรรทัดรองบนหัวการ์ด<input id="ufSub" value="${esc(e.subtitle || '')}" placeholder="(ถ้าว่างใช้ชื่อหน่วยงาน)"></label>
      <label class="f">หัวเรื่องทะเบียน (header_title)<input id="ufHead" value="${esc(e.header_title || '')}" placeholder="ทะเบียนทรัพย์สิน | ชื่อหน่วยงาน"></label>
      <label class="f">โฟลเดอร์หลักใน Google Drive (โฟลเดอร์ที่มีโฟลเดอร์ย่อยแต่ละสถานที่)
        <div class="row"><input id="ufFolder" style="flex:1;min-width:200px;border:1px solid #c9d6c0;border-radius:8px;padding:8px 10px" value="${esc(e.drive_folder_id ? 'https://drive.google.com/drive/folders/' + e.drive_folder_id : '')}" placeholder="วางลิงก์โฟลเดอร์"><button class="btn sm sec" id="ufCheck">ตรวจ</button></div></label>
      <div id="ufFolderMsg" class="small"></div>
      <div class="grid g2">
        <div><div class="small muted" style="font-weight:600;margin-bottom:4px">โลโก้หน่วยงาน (ซ้าย)</div><div class="logobox"><div class="lg">${e.logo_house ? `<img src="${e.logo_house}">` : '<span class="muted small">ไม่มี</span>'}</div><input type="file" id="ufLogoH" accept="image/*" style="max-width:180px"></div></div>
        <div><div class="small muted" style="font-weight:600;margin-bottom:4px">โลโก้ MJ (ขวา)</div><div class="logobox"><div class="lg">${e.logo_mj ? `<img src="${e.logo_mj}">` : '<span class="muted small">ไม่มี</span>'}</div><input type="file" id="ufLogoM" accept="image/*" style="max-width:180px"></div></div>
      </div>
      <label class="chk"><input type="checkbox" id="ufBlack"> โลโก้พื้นหลังสีดำ → เปลี่ยนเป็นพื้นขาวอัตโนมัติ (เลือกก่อนแนบไฟล์)</label>
    </div>
    <div>
      <div class="small muted" style="font-weight:600;margin-bottom:6px">สีการ์ดและป้าย QR</div>
      <div class="colors">${THEME_KEYS.map(([k, l]) => `<label><input type="color" data-c="${k}" value="${esc(e.theme[k] || THEME_DEF[k])}">${l}</label>`).join('')}</div>
      <div style="margin-top:12px" id="ufMock">${mockCard(e)}</div>
      ${dedicated ? `<div class="note info small" style="margin-top:10px">${esc(e.prefix)} ใช้การ์ดเฉพาะ <code>${esc(e.card_fn)}</code> — สีที่ตั้งตรงนี้ใช้กับป้าย QR PDF; สีบนการ์ดเดิมไม่เปลี่ยน</div>` : '<div class="note info small" style="margin-top:10px">หน่วยงานใหม่ใช้การ์ดกลาง <code>card</code> — สีและโลโก้ที่ตั้งตรงนี้ขึ้นบนการ์ดทันที</div>'}
    </div>
  </div>
  <div class="row end" style="margin-top:14px"><button class="btn sec" id="ufCancel">ปิด</button><button class="btn" id="ufSave">บันทึกหน่วยงาน</button></div></div>`;
  const sync = () => { e.prefix = e.isNew ? $('#ufPrefix').value.trim().toUpperCase() : e.prefix; e.name = $('#ufName').value; e.subtitle = $('#ufSub').value; e.header_title = $('#ufHead').value; $('#ufMock').innerHTML = mockCard(e); };
  ['ufPrefix', 'ufName', 'ufSub', 'ufHead'].forEach(id => { $('#' + id).oninput = sync; });
  $$('input[data-c]', box).forEach(i => i.oninput = () => { e.theme[i.dataset.c] = i.value; $('#ufMock').innerHTML = mockCard(e); });
  const logo = (inp, key) => { inp.onchange = async ev => { const f = ev.target.files[0]; if (!f) return; const d = await guard(() => prepLogo(f, $('#ufBlack').checked), 'กำลังเตรียมโลโก้…'); if (d) { e[key] = d; renderUnitForm(); } }; };
  logo($('#ufLogoH'), 'logo_house'); logo($('#ufLogoM'), 'logo_mj');
  $('#ufCheck').onclick = () => guard(async () => {
    const info = await run('driveFolderInfo', $('#ufFolder').value);
    e.drive_folder_id = info.id;
    const subs = await run('driveListSubfolders', info.id);
    $('#ufFolderMsg').innerHTML = `<span class="pill ok">พบโฟลเดอร์ “${esc(info.name)}”</span> สิทธิ์: ${esc({ owner: 'เจ้าของ', edit: 'แก้ไขได้', view: 'ดูอย่างเดียว (อัปโหลดรูปไม่ได้)' }[info.access] || info.access)} · โฟลเดอร์ย่อย ${subs.length} โฟลเดอร์${info.owner ? ' · เจ้าของ ' + esc(info.owner) : ''}`;
  }, 'กำลังตรวจโฟลเดอร์…');
  $('#ufCancel').onclick = () => { S.uedit = null; box.innerHTML = ''; };
  $('#ufSave').onclick = async () => {
    sync();
    const fv = $('#ufFolder').value.trim();
    if (fv && !e.drive_folder_id) { const m = fv.match(/folders\/([A-Za-z0-9_-]{10,})/); e.drive_folder_id = m ? m[1] : fv; }
    if (!fv) e.drive_folder_id = null;
    const unit = { prefix: e.prefix, name: e.name.trim(), subtitle: e.subtitle, header_title: e.header_title || `ทะเบียนทรัพย์สิน | ${e.name.trim()}`, drive_folder_id: e.drive_folder_id, theme: e.theme, logo_house: e.logo_house, logo_mj: e.logo_mj, sort: e.sort || 100, active: e.active !== false };
    if (e.isNew && S.units.some(u => u.prefix === unit.prefix)) return toast('รหัสหน่วยงานนี้มีอยู่แล้ว', true);
    const r = await guard(async () => { const out = await api('units.save', { unit }); await loadUnits(); return out; }, 'กำลังบันทึกหน่วยงาน…');
    if (!r) return;
    toast(r.created ? 'เพิ่มหน่วยงานแล้ว' : 'บันทึกแล้ว');
    S.uedit = null; selectUnit(unit.prefix); go('units');
  };
}
async function prepLogo(file, blackToWhite) {
  const im = await loadImg(await readFileAsDataURL(file)); if (!im) throw new Error('เปิดรูปโลโก้ไม่ได้');
  let c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  let x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  if (blackToWhite) for (let i = 0; i < p.length; i += 4) if (p[i] < 40 && p[i + 1] < 40 && p[i + 2] < 40) { p[i] = p[i + 1] = p[i + 2] = 255; }
  x.putImageData(d, 0, 0);
  // ตัดขอบขาว
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) { const i = (y * c.width + xx) * 4; if (p[i] < 235 || p[i + 1] < 235 || p[i + 2] < 235) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = c.width - 1; y1 = c.height - 1; }
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1, sc = Math.min(1, 420 / w, 140 / h);
  const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(w * sc)); o.height = Math.max(1, Math.round(h * sc));
  const ox = o.getContext('2d'); ox.fillStyle = '#fff'; ox.fillRect(0, 0, o.width, o.height); ox.imageSmoothingQuality = 'high'; ox.drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
  let url = o.toDataURL('image/png');
  if (url.length > 45000) url = o.toDataURL('image/jpeg', 0.9);
  if (url.length > 58000) url = o.toDataURL('image/jpeg', 0.75);
  return url;
}

/* =================== start =================== */
/* =================== เข้าสู่ระบบ =================== */
function saveSession(token, user, remember) {
  S.session = token; S.user = user;
  try { (remember ? localStorage : sessionStorage).setItem('qrreg_session', JSON.stringify({ token, user })); (remember ? sessionStorage : localStorage).removeItem('qrreg_session'); } catch (e) { /* ignore */ }
}
function loadSession() {
  try { const v = sessionStorage.getItem('qrreg_session') || localStorage.getItem('qrreg_session'); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function clearSession() {
  S.session = null; S.user = null;
  try { sessionStorage.removeItem('qrreg_session'); localStorage.removeItem('qrreg_session'); } catch (e) { /* ignore */ }
}
let expiredShown = false;
function sessionExpired() {
  if (expiredShown) return; expiredShown = true;
  clearSession(); busyN = 0; busy(false);
  showLogin('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
}
const IC = {
  eyeOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17.5 19 7"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.01"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
};
/** โครงหน้าจอเข้าสู่ระบบ (ฝั่งแบรนด์ซ้าย + แผงฟอร์มขวา) */
function authShell(inner) {
  document.body.classList.add('locked');
  let el = $('#login');
  if (!el) { el = document.createElement('div'); el.id = 'login'; document.body.appendChild(el); }
  const logo = ($('#brandLogo') || {}).src || '';
  el.innerHTML = `<div class="lg-wrap">
    <aside class="lg-brand">
      <div class="lg-stripes"><i></i><i></i><i></i><i></i><i class="or"></i></div>
      ${logo ? `<div class="lg-logo-card"><img src="${logo}" alt="Major Property Service"></div>` : ''}
      <div class="lg-hl">
        <span class="lg-eyebrow">Asset Registry</span>
        <h2>ระบบ QR<br> ทะเบียนทรัพย์สิน</h2>
        <p>ทะเบียนทรัพย์สินประจำหน่วยงาน สแกน QR แล้วเห็นรูปและรายละเอียดทันที</p>
        <ul class="lg-feat">
          <li><span>${IC.ok}</span>เข้าสู่ระบบด้วย Gmail ของหน่วยงาน</li>
          <li><span>${IC.ok}</span>นำเข้ารูปจาก Google Drive ทั้งโฟลเดอร์</li>
          <li><span>${IC.ok}</span>ทำ QR PDF 20 ดวง/หน้า และรายงาน Excel</li>
        </ul>
      </div>
      <div class="lg-foot">Major Property Service Co., Ltd.</div>
    </aside>
    <section class="lg-panel"><div class="lg-form">${inner}</div></section>
  </div>`;
  el.style.display = 'flex';
  bindEyes(el);
  return el;
}
/** ปุ่มรูปตา เปิด/ปิดการมองเห็นรหัสผ่าน (ใช้ทั้งหน้าเข้าสู่ระบบและหน้าต่างเปลี่ยนรหัส) */
function bindEyes(root) {
  $$('[data-eye]', root).forEach(btn => btn.onclick = () => {
    const i = $('#' + btn.dataset.eye); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; btn.innerHTML = show ? IC.eyeOff : IC.eyeOn;
    btn.classList.toggle('on', show);
    btn.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'); btn.title = btn.getAttribute('aria-label'); i.focus();
  });
}
function lgField(id, label, opt) {
  opt = opt || {};
  const pw = opt.type === 'password';
  return `<label class="lg-f"><span>${label}</span><div class="lg-in">${pw ? IC.lock : IC.mail}
    <input id="${id}" type="${pw ? 'password' : 'text'}" ${pw ? '' : 'inputmode="email" autocapitalize="none" spellcheck="false"'} autocomplete="${opt.ac || 'off'}" placeholder="${esc(opt.ph || '')}" value="${esc(opt.value || '')}" ${opt.ro ? 'readonly' : ''} required>
    ${pw ? `<button type="button" class="lg-eye" data-eye="${id}" ${id === 'lgPass' ? 'id="lgEye"' : ''} aria-label="แสดงรหัสผ่าน" title="แสดงรหัสผ่าน">${IC.eyeOn}</button>` : ''}</div></label>`;
}
function lgMsg(text, kind) { const m = $('#lgMsg'); if (!m) return; m.textContent = text || ''; m.className = 'lg-msg' + (kind ? ' ' + kind : ''); m.style.display = text ? 'block' : 'none'; }
function finishLogin(r, remember) {
  saveSession(r.token, r.user, remember); expiredShown = false;
  $('#login').style.display = 'none'; document.body.classList.remove('locked');
}
function showLogin(msg, prefill) {
  const el = authShell(`
    <h1>เข้าสู่ระบบ</h1>
    <p class="lg-sub">ใช้ Gmail ของหน่วยงาน และรหัสผ่านที่คุณตั้งไว้</p>
    <form id="lgForm" autocomplete="on">
      ${lgField('lgUser', 'Gmail ของหน่วยงาน', { ac: 'username', ph: 'เช่น project.name@gmail.com', value: prefill })}
      ${lgField('lgPass', 'รหัสผ่าน', { type: 'password', ac: 'current-password', ph: '••••••••' })}
      <div class="lg-row"><label class="chk lg-rem"><input type="checkbox" id="lgRemember"> จดจำ 7 วันบนเครื่องนี้</label><button type="button" class="lg-link" id="lgForgot">ลืมรหัสผ่าน?</button></div>
      <div id="lgMsg" class="lg-msg"></div>
      <button class="lg-btn" id="lgBtn" type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="lg-help">ยังไม่มีบัญชี? ให้ผู้ดูแลระบบ (ADM-PR) ส่งคำเชิญไปที่ Gmail ของหน่วยงาน แล้วเปิดลิงก์ในอีเมลเพื่อตั้งรหัสผ่าน</p>`);
  lgMsg(msg);
  setTimeout(() => { try { (prefill ? $('#lgPass') : $('#lgUser')).focus(); } catch (e) { /* ignore */ } }, 50);
  $('#lgForgot').onclick = () => showForgot($('#lgUser').value.trim());
  $('#lgForm').onsubmit = async ev => {
    ev.preventDefault();
    const u = $('#lgUser').value.trim(), p = $('#lgPass').value, rem = $('#lgRemember').checked;
    if (!u || !p) return;
    $('#lgBtn').disabled = true; $('#lgBtn').textContent = 'กำลังตรวจสอบ…'; lgMsg('');
    try {
      const r = await rawRun('login', u, p, rem);
      finishLogin(r, rem);
      if (r.user.must_change) { await changePasswordDialog(true); }
      await startAfterLogin();
    } catch (e) {
      lgMsg(e.message || String(e));
      $('#lgBtn').disabled = false; $('#lgBtn').textContent = 'เข้าสู่ระบบ'; $('#lgPass').select();
    }
  };
  return el;
}
function showForgot(email) {
  authShell(`
    <button type="button" class="lg-back" id="lgBack">${IC.back}กลับไปหน้าเข้าสู่ระบบ</button>
    <h1>ลืมรหัสผ่าน</h1>
    <p class="lg-sub">กรอก Gmail ของหน่วยงาน ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปที่อีเมลนั้น</p>
    <form id="lgForm">
      ${lgField('lgFEmail', 'Gmail ของหน่วยงาน', { ac: 'username', ph: 'เช่น project.name@gmail.com', value: /@/.test(email || '') ? email : '' })}
      <div id="lgMsg" class="lg-msg"></div>
      <button class="lg-btn" id="lgBtn" type="submit">ส่งลิงก์ตั้งรหัสผ่าน</button>
    </form>
    <p class="lg-help">ลิงก์ใช้ได้ 2 ชั่วโมง · ถ้าไม่เห็นอีเมล ให้ดูในโฟลเดอร์สแปม/โปรโมชัน</p>`);
  $('#lgBack').onclick = () => showLogin('', $('#lgFEmail').value.trim());
  setTimeout(() => { try { $('#lgFEmail').focus(); } catch (e) { /* ignore */ } }, 50);
  $('#lgForm').onsubmit = async ev => {
    ev.preventDefault();
    const em = $('#lgFEmail').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(em)) return lgMsg('รูปแบบอีเมลไม่ถูกต้อง');
    $('#lgBtn').disabled = true; $('#lgBtn').textContent = 'กำลังส่ง…'; lgMsg('');
    try {
      const r = await rawRun('requestReset', em);
      authShell(`
        <div class="lg-done">${IC.mail}</div>
        <h1>ตรวจสอบอีเมลของคุณ</h1>
        <p class="lg-sub">${esc(r.message || 'ส่งลิงก์แล้ว')}</p>
        <div class="lg-acct"><span class="av">${esc(em.charAt(0).toUpperCase())}</span><div><b>${esc(em)}</b><span>เปิดอีเมลจาก “ระบบ QR ทะเบียนทรัพย์สิน · MJ” แล้วกดปุ่มตั้งรหัสผ่าน</span></div></div>
        <button class="lg-btn" id="lgBtn" type="button">กลับไปหน้าเข้าสู่ระบบ</button>`);
      $('#lgBtn').onclick = () => showLogin('', em);
    } catch (e) {
      lgMsg(e.message || String(e)); $('#lgBtn').disabled = false; $('#lgBtn').textContent = 'ส่งลิงก์ตั้งรหัสผ่าน';
    }
  };
}
function pwRulesHtml() {
  return `<ul class="pwrules" id="pwRules"><li data-r="len">อย่างน้อย 8 ตัวอักษร</li><li data-r="abc">มีตัวอักษรภาษาอังกฤษ</li><li data-r="num">มีตัวเลข</li><li data-r="same">พิมพ์ยืนยันตรงกัน</li></ul>`;
}
function bindPwRules(a, b) {
  const upd = () => {
    const p = $(a).value, q = $(b).value;
    const ok = { len: p.length >= 8, abc: /[A-Za-z]/.test(p), num: /\d/.test(p), same: !!p && p === q };
    $$('#pwRules li').forEach(li => li.classList.toggle('ok', !!ok[li.dataset.r]));
  };
  $(a).addEventListener('input', upd); $(b).addEventListener('input', upd); upd();
}
async function showSetup(token) {
  authShell('<div class="lg-loading"><div class="spin"></div><p class="lg-sub">กำลังตรวจสอบลิงก์…</p></div>');
  let info;
  try { info = await rawRun('setupInfo', token); }
  catch (e) {
    authShell(`
      <div class="lg-done warn">${IC.warn}</div>
      <h1>ลิงก์ใช้ไม่ได้</h1>
      <p class="lg-sub">${esc(e.message || String(e))}</p>
      <button class="lg-btn" id="lgBtn" type="button">ขอลิงก์ใหม่ทางอีเมล</button>
      <p class="lg-help"><button type="button" class="lg-link" id="lgToLogin">ไปหน้าเข้าสู่ระบบ</button></p>`);
    clearUrlParams();
    $('#lgBtn').onclick = () => showForgot('');
    $('#lgToLogin').onclick = () => showLogin('');
    return;
  }
  const invite = info.kind === 'invite';
  const units = (info.units || []).map(u => `<span class="uchip">${esc(u.prefix)} · ${esc(u.name)}</span>`).join('');
  authShell(`
    <span class="lg-tag">${invite ? 'คำเชิญเข้าใช้ระบบ' : 'ตั้งรหัสผ่านใหม่'}</span>
    <h1>${invite ? 'ตั้งรหัสผ่านของคุณ' : 'ตั้งรหัสผ่านใหม่'}</h1>
    <p class="lg-sub">${invite ? 'ตั้งรหัสผ่านครั้งเดียว แล้วใช้ Gmail นี้เข้าสู่ระบบได้ทุกครั้ง' : 'รหัสผ่านเดิมจะใช้ไม่ได้หลังตั้งรหัสใหม่'}</p>
    <div class="lg-acct"><span class="av">${esc((info.display_name || info.email || '?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(info.display_name || info.email)}</b><span>${esc(info.email)}</span>${units ? `<div class="uchips">${units}</div>` : ''}</div></div>
    <form id="lgForm" autocomplete="on">
      <input type="email" name="username" autocomplete="username" value="${esc(info.email)}" style="display:none">
      ${lgField('spNew', 'รหัสผ่านใหม่', { type: 'password', ac: 'new-password', ph: 'อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข' })}
      ${lgField('spNew2', 'พิมพ์รหัสผ่านอีกครั้ง', { type: 'password', ac: 'new-password', ph: 'พิมพ์ให้ตรงกัน' })}
      ${pwRulesHtml()}
      <div id="lgMsg" class="lg-msg"></div>
      <button class="lg-btn" id="lgBtn" type="submit">${invite ? 'ตั้งรหัสผ่านและเริ่มใช้งาน' : 'บันทึกรหัสผ่านใหม่'}</button>
    </form>`);
  bindPwRules('#spNew', '#spNew2');
  setTimeout(() => { try { $('#spNew').focus(); } catch (e) { /* ignore */ } }, 50);
  $('#lgForm').onsubmit = async ev => {
    ev.preventDefault();
    const n = $('#spNew').value, n2 = $('#spNew2').value;
    const w = pwStrengthMsg(n); if (w) return lgMsg('รหัสผ่าน: ' + w);
    if (n !== n2) return lgMsg('พิมพ์รหัสผ่านยืนยันไม่ตรงกัน');
    $('#lgBtn').disabled = true; $('#lgBtn').textContent = 'กำลังบันทึก…'; lgMsg('');
    try {
      const r = await rawRun('setPassword', token, n);
      clearUrlParams();
      finishLogin(r, false);
      toast(invite ? 'ตั้งรหัสผ่านแล้ว ยินดีต้อนรับ' : 'ตั้งรหัสผ่านใหม่แล้ว');
      await startAfterLogin();
    } catch (e) {
      lgMsg(e.message || String(e)); $('#lgBtn').disabled = false; $('#lgBtn').textContent = invite ? 'ตั้งรหัสผ่านและเริ่มใช้งาน' : 'บันทึกรหัสผ่านใหม่';
    }
  };
}
function urlParams() {
  if (!HAS_GAS) { const o = {}; new URLSearchParams(location.search).forEach((v, k) => { o[k] = v; }); return Promise.resolve(o); }
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v || {}); } };
    try { google.script.url.getLocation(l => fin(l && l.parameter)); } catch (e) { fin({}); }
    setTimeout(() => fin({}), 2000);
  });
}
function clearUrlParams() { try { if (HAS_GAS) google.script.history.replace(null, {}, ''); else history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } }
function pwStrengthMsg(p) {
  if (p.length < 8) return 'อย่างน้อย 8 ตัวอักษร';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'ต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข';
  return '';
}
function changePasswordDialog(forced) {
  return new Promise(resolve => {
    const dlg = $('#dlg');
    dlg.innerHTML = `<div class="dh"><h3>${forced ? 'ตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน' : 'เปลี่ยนรหัสผ่าน'}</h3>${forced ? '' : '<button class="x" data-close>×</button>'}</div>
    <div class="db"><form id="cpForm" class="grid">
      ${forced ? '<div class="note info">บัญชีนี้ใช้รหัสผ่านชั่วคราว กรุณาตั้งรหัสผ่านของตัวเองก่อน</div>' : ''}
      <input type="text" name="username" autocomplete="username" value="${esc(S.user ? S.user.username : '')}" style="display:none">
      ${lgField('cpOld', 'รหัสผ่านเดิม' + (forced ? ' (รหัสชั่วคราวที่ได้รับ)' : ''), { type: 'password', ac: 'current-password', ph: 'รหัสผ่านที่ใช้อยู่ตอนนี้' })}
      ${lgField('cpNew', 'รหัสผ่านใหม่', { type: 'password', ac: 'new-password', ph: 'อย่างน้อย 8 ตัว มีตัวอักษรและตัวเลข' })}
      ${lgField('cpNew2', 'พิมพ์รหัสผ่านใหม่อีกครั้ง', { type: 'password', ac: 'new-password', ph: 'พิมพ์ให้ตรงกัน' })}
      ${pwRulesHtml()}
      <label class="chk"><input type="checkbox" id="cpShowAll"> แสดงรหัสผ่านทั้งหมด</label>
      <div id="cpMsg" class="lg-msg" style="display:none"></div>
    </form></div>
    <div class="df">${forced ? '' : '<button class="btn sec" data-close>ยกเลิก</button>'}<button class="btn" id="cpOk">บันทึกรหัสผ่านใหม่</button></div>`;
    dlg.showModal();
    bindEyes(dlg); bindPwRules('#cpNew', '#cpNew2');
    $('#cpShowAll').onchange = e => {
      ['cpOld', 'cpNew', 'cpNew2'].forEach(id => {
        $('#' + id).type = e.target.checked ? 'text' : 'password';
        const b = $(`[data-eye="${id}"]`, dlg); if (b) { b.innerHTML = e.target.checked ? IC.eyeOff : IC.eyeOn; b.classList.toggle('on', e.target.checked); }
      });
    };
    setTimeout(() => { try { $('#cpOld').focus(); } catch (e) { /* ignore */ } }, 50);
    dlg.oncancel = ev => { if (forced) ev.preventDefault(); };
    $$('[data-close]', dlg).forEach(b => b.onclick = () => { dlg.close(); resolve(false); });
    const err = m => { $('#cpMsg').textContent = m; $('#cpMsg').style.display = 'block'; };
    $('#cpOk').onclick = async () => {
      const o = $('#cpOld').value, n = $('#cpNew').value, n2 = $('#cpNew2').value;
      const w = pwStrengthMsg(n); if (w) return err('รหัสผ่านใหม่: ' + w);
      if (n !== n2) return err('ยืนยันรหัสผ่านไม่ตรงกัน');
      $('#cpOk').disabled = true;
      try {
        await rawRun('rpc', S.session, 'api', ['auth.changePassword', { old: o, password: n }]);
        if (S.user) S.user.must_change = false;
        const st = loadSession(); if (st) saveSession(st.token, S.user, !!localStorage.getItem('qrreg_session'));
        dlg.close(); toast('เปลี่ยนรหัสผ่านแล้ว'); resolve(true);
      } catch (e) { err(String(e.message || e).replace('SESSION_EXPIRED', 'หมดเวลา กรุณาเข้าสู่ระบบใหม่')); $('#cpOk').disabled = false; if (/SESSION_EXPIRED/.test(e.message)) { dlg.close(); sessionExpired(); } }
    };
  });
}
const ROLE_TXT = { owner: 'ผู้ดูแลสูงสุด', admin: 'แอดมิน', unit: 'ผู้ใช้หน่วยงาน' };
function rolePill(r) { return `<span class="pill ${r === 'owner' ? 'ok' : r === 'admin' ? 'new' : 'gray'}">${ROLE_TXT[r] || r}</span>`; }
function userMenu() {
  const dlg = $('#dlg'), u = S.user || {};
  const units = (u.units || []).map(p => { const x = S.units.find(y => y.prefix === p); return `<span class="uchip">${esc(p)}${x ? ' · ' + esc(x.name) : ''}</span>`; }).join('');
  dlg.innerHTML = `<div class="dh"><h3>บัญชีของฉัน</h3><button class="x" data-close>×</button></div>
  <div class="db">
    <div class="acct"><span class="av">${esc((u.display_name || u.username || '?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(u.display_name || u.username)}</b><span>${esc(u.email || u.username)}</span></div>${rolePill(u.role)}</div>
    ${u.role === 'unit' ? `<p class="small muted" style="margin:12px 0 6px">หน่วยงานที่ใช้งานได้</p><div class="uchips">${units || '-'}</div>` : '<p class="small muted" style="margin:12px 0 0">เห็นและจัดการได้ทุกหน่วยงาน</p>'}
    <div class="grid" style="margin-top:16px"><button class="btn sec" id="umPw">เปลี่ยนรหัสผ่าน</button>${u.role === 'owner' ? '<button class="btn sec" id="umUsers">จัดการผู้ใช้ระบบ</button>' : ''}<button class="btn sec" id="umMan">คู่มือการใช้งาน</button><button class="btn danger" id="umOut">ออกจากระบบ</button></div></div>`;
  dlg.showModal();
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  $('#umPw').onclick = () => { dlg.close(); changePasswordDialog(false); };
  $('#umMan').onclick = () => { dlg.close(); go('manual'); };
  if ($('#umUsers')) $('#umUsers').onclick = () => { dlg.close(); go('users'); };
  $('#umOut').onclick = async () => { dlg.close(); await rawRun('rpc', S.session, 'api', ['auth.logout', {}]).catch(() => null); clearSession(); location.reload(); };
}
function tabAllowed(t) {
  if (!VIEWS[t]) return false;
  const r = S.user && S.user.role;
  if (t === 'users') return r === 'owner';
  if (t === 'units') return r !== 'unit';
  return true;
}
function applyUserUi() {
  const u = S.user || {};
  document.body.dataset.role = u.role || '';
  $('#me').textContent = u.display_name || u.username || '';
  $('#meAv').textContent = (u.display_name || u.username || 'A').trim().charAt(0).toUpperCase();
  $('#meBox').onclick = userMenu;
  const sub = $('.sb-tt span'); if (sub) sub.textContent = u.role === 'unit' ? 'ผู้ใช้หน่วยงาน' : 'Asset Registry · Admin';
  const ub = $('#tabs button[data-tab="units"]'); if (ub) ub.style.display = u.role === 'unit' ? 'none' : '';
  const has = $('#tabs button[data-tab="users"]');
  if (u.role === 'owner' && !has) {
    const b = document.createElement('button'); b.dataset.tab = 'users';
    b.innerHTML = `${icon('users')}<span>ผู้ใช้ระบบ</span>`; b.onclick = () => go('users'); $('#tabs').appendChild(b);
  } else if (u.role !== 'owner' && has) has.remove();
}
async function startAfterLogin() {
  busy(true, 'กำลังโหลดข้อมูล…');
  try {
    applyUserUi();
    await loadUnits();
    const last = lsGet('unit');
    selectUnit(S.units.some(u => u.prefix === last) ? last : (S.units[0] || {}).prefix);
  } catch (e) {
    busy(false);
    if (/เข้าสู่ระบบใหม่|ตั้งรหัสผ่านใหม่/.test(e.message)) return;
    $('#main').innerHTML = `<div class="card note">เชื่อมต่อไม่สำเร็จ: ${esc(e.message)}</div>`;
    return;
  }
  busy(false);
  const t = lsGet('tab');
  go(tabAllowed(t) ? t : 'home');
}

/* =================== คู่มือการใช้งาน =================== */
VIEWS.manual = async (main) => {
  const unitUser = isUnitUser();
  const adminUser = S.user && S.user.role !== 'unit';
  const u = S.unit;
  const pre = u ? u.prefix : 'PCM';
  const sec = (id, num, title, body, open) => `<details class="mn" id="mn-${id}"${open ? ' open' : ''}><summary><span class="mn-n">${num}</span><span class="mn-t">${title}</span><span class="mn-c"></span></summary><div class="mn-b">${body}</div></details>`;
  const steps = (arr) => `<ol class="mn-steps">${arr.map(x => `<li>${x}</li>`).join('')}</ol>`;
  const S1 = sec('login', '1', 'เข้าสู่ระบบด้วย Gmail ของหน่วยงาน', `
    <p>บัญชีของหน่วยงานผูกกับ <b>Gmail ประจำหน่วยงาน</b> ผู้ดูแลระบบ (ADM-PR) เป็นผู้ส่งคำเชิญ แล้วเจ้าของอีเมลตั้งรหัสผ่านเอง</p>
    ${steps([
      'เปิดอีเมลหัวข้อ <b>“เชิญใช้งานระบบ QR ทะเบียนทรัพย์สิน”</b> ใน Gmail ของหน่วยงาน (ถ้าไม่เห็น ให้ดูในสแปม/โปรโมชัน)',
      'กดปุ่ม <b>ตั้งรหัสผ่านและเริ่มใช้งาน</b> — ลิงก์ใช้ได้ครั้งเดียว ภายใน 7 วัน',
      'ตั้งรหัสผ่าน อย่างน้อย 8 ตัว มีตัวอักษรภาษาอังกฤษและตัวเลข แล้วกดบันทึก ระบบจะพาเข้าใช้งานทันที',
      'ครั้งต่อไป เปิดลิงก์เว็บ → ใส่ <b>Gmail ของหน่วยงาน + รหัสผ่าน</b> → ติ๊ก “จดจำ 7 วัน” ถ้าเป็นเครื่องประจำ'])}
    <div class="mn-tip"><b>ลืมรหัสผ่าน</b> กด “ลืมรหัสผ่าน?” ที่หน้าเข้าสู่ระบบ → ใส่ Gmail → เปิดลิงก์ในอีเมล (ใช้ได้ 2 ชั่วโมง) แล้วตั้งรหัสใหม่</div>
    <div class="mn-warn">ใส่รหัสผิด 5 ครั้ง บัญชีจะถูกล็อก 15 นาที · อย่าบอกรหัสผ่านให้คนนอกหน่วยงาน · เปลี่ยนรหัสได้ที่ปุ่มชื่อมุมขวาบน</div>
    <p class="small muted">หมายเหตุ: เว็บนี้อยู่บน Google จึงต้องล็อกอินบัญชี Google (บัญชีใดก็ได้) ในเบราว์เซอร์ก่อนเปิดลิงก์</p>`, true);
  const S2 = sec('flow', '2', 'ขั้นตอนการทำงานโดยรวม', `
    <div class="mn-flow">
      <div><b>1</b><span>สร้างโฟลเดอร์สถานที่ใน Drive หน่วยงาน</span></div>
      <div><b>2</b><span>ถ่ายรูป 1 รูป = 1 รหัสทรัพย์สิน</span></div>
      <div><b>3</b><span>ตั้งชื่อไฟล์ หรือเพิ่มผ่านเว็บ</span></div>
      <div><b>4</b><span>นำเข้า / ตรวจข้อมูลในเว็บ</span></div>
      <div><b>5</b><span>ทำ QR PDF แล้วพิมพ์</span></div>
      <div><b>6</b><span>สแกนตรวจ แล้วติดสติกเกอร์</span></div>
    </div>
    <p><b>หลักสำคัญ</b></p>
    <ul class="mn-list">
      <li><b>QR ผูกกับรหัส ไม่ใช่ข้อมูล</b> — แก้ชื่อ ราคา หมายเหตุ หรือเปลี่ยนรูปได้ตลอด สติกเกอร์เดิมใช้ต่อได้</li>
      <li><b>ห้ามลบหรือย้ายไฟล์รูป</b>ที่ทำ QR แล้ว การ์ดดึงรูปจากไฟล์นั้นโดยตรง</li>
      <li>โฟลเดอร์หลักต้องแชร์แบบ <b>“ทุกคนที่มีลิงก์ – ผู้มีสิทธิ์อ่าน”</b> รูปจึงจะขึ้นบนการ์ดเมื่อสแกน</li>
    </ul>`);
  const S3 = sec('name', '3', 'รูปแบบรหัสและชื่อไฟล์รูป', `
    <div class="mn-code"><span class="c1">${esc(pre)}</span>.<span class="c2">OFFI</span>.<span class="c3">202611</span><span class="c4">001</span> <span class="c5">(ชื่อ)(ราคา)(ประกัน)(ใบ PV)(วันที่จัดซื้อ)(หมายเหตุ)</span>.jpg</div>
    <div class="mn-legend"><span><i class="c1"></i>ตัวย่อหน่วยงาน</span><span><i class="c2"></i>ตัวย่อสถานที่ (อังกฤษ ไม่มีช่องว่าง)</span><span><i class="c3"></i>ปี ค.ศ. + เดือน</span><span><i class="c4"></i>ลำดับ 3 หลัก</span><span><i class="c5"></i>ข้อมูลในวงเล็บ</span></div>
    <div class="tablewrap" style="max-height:none"><table><thead><tr><th>ลำดับ</th><th>ข้อมูลในวงเล็บ</th><th>ตัวอย่าง</th><th>ถ้ายังไม่มี</th></tr></thead><tbody>
      <tr><td>1</td><td><b>ชื่ออุปกรณ์ (จำเป็น)</b></td><td>(เก้าอี้สำนักงาน จำนวน 4 ตัว)</td><td>ต้องมีเสมอ</td></tr>
      <tr><td>2</td><td>ราคา</td><td>(23,000 บาท)</td><td>(N/A)</td></tr>
      <tr><td>3</td><td>ระยะเวลาประกัน</td><td>(ประกัน 2 ปี)</td><td>(N/A)</td></tr>
      <tr><td>4</td><td>เลขใบ PV</td><td>(ใบPV 685454801)</td><td>(-)</td></tr>
      <tr><td>5</td><td>วันที่จัดซื้อ</td><td>(วันที่จัดซื้อ 16/9/2569)</td><td>(-)</td></tr>
      <tr><td>6</td><td>หมายเหตุ</td><td>(ชำรุด อยู่ระหว่างซ่อม)</td><td>ไม่ต้องใส่</td></tr>
    </tbody></table></div>
    <div class="mn-tip">ช่องที่อยู่ <b>ตรงกลาง</b> ถ้าไม่มีข้อมูลให้ใส่ (N/A) หรือ (-) แทน · ช่องท้าย ๆ ที่ไม่มีข้อมูล ไม่ต้องใส่วงเล็บ · เขียนคำว่า <b>“ชำรุด”</b> หรือ <b>“ซาก”</b> ในหมายเหตุ การ์ดจะแสดงเป็นสีแดง</div>
    <p><b>ข้อผิดพลาดที่พบบ่อย</b> (เมนูนำเข้าจะแก้ให้อัตโนมัติและแจ้งเตือน)</p>
    <div class="tablewrap" style="max-height:none"><table><thead><tr><th>ชื่อไฟล์ที่ผิด</th><th>ปัญหา</th><th>ที่ถูกต้อง</th></tr></thead><tbody>
      <tr><td><code>IMG_0012.jpg</code></td><td>ไม่มีรหัส</td><td><code>${esc(pre)}.OFFI.202611001 (ชื่อ).jpg</code></td></tr>
      <tr><td><code>${esc(pre)}.COOK.2026110010</code></td><td>เลขเกิน 9 หลัก</td><td><code>${esc(pre)}.COOK.202611010</code></td></tr>
      <tr><td><code>${esc(pre)}.GARD202611001</code></td><td>ไม่มีจุดก่อนเลข</td><td><code>${esc(pre)}.GARD.202611001</code></td></tr>
      <tr><td><code>${esc(pre)}.Lobby E.202611001</code></td><td>มีช่องว่างในตัวย่อ</td><td><code>${esc(pre)}.LobbyE.202611001</code></td></tr>
      <tr><td>รหัส 005 สองไฟล์</td><td>รหัสซ้ำ</td><td>ใช้เลขถัดไป ไม่ข้าม ไม่ซ้ำ</td></tr>
    </tbody></table></div>`);
  const S4 = sec('import', '4', 'นำเข้าจาก Drive (ทั้งโฟลเดอร์ทีเดียว)', `
    ${steps([
      'อัปโหลดรูปที่ตั้งชื่อตามรูปแบบแล้ว ลงโฟลเดอร์สถานที่ใน Drive ของหน่วยงาน',
      'เมนู <b>นำเข้าจาก Drive</b> → เลือกโฟลเดอร์สถานที่จากรายการ (หรือวางลิงก์โฟลเดอร์) → กดอ่านรูป',
      'ตรวจตาราง: แถว <span class="pill ok">ใหม่</span> พร้อมบันทึก · <span class="pill warn">แก้ให้แล้ว</span> ระบบแก้รหัสพิมพ์ผิดให้ · <span class="pill err">มีปัญหา</span> แก้ในช่อง หรือเอาเครื่องหมายถูกออก',
      'ใส่ชื่อสถานที่ (ภาษาไทย) แล้วกด <b>บันทึก</b> — รูปที่เคยนำเข้าแล้วจะถูกข้ามอัตโนมัติ นำเข้าซ้ำได้ไม่ซ้ำซ้อน'])}
    ${unitUser ? '<div class="mn-tip">บัญชีหน่วยงานเปิดได้เฉพาะโฟลเดอร์ที่อยู่ในโฟลเดอร์หลักของหน่วยงานตัวเอง</div>' : ''}`);
  const S5 = sec('add', '5', 'เพิ่มทรัพย์สินทีละรายการ (ถ่ายรูปจากมือถือ)', `
    ${steps([
      'เมนู <b>เพิ่มทรัพย์สิน</b> → เลือกสถานที่ (หรือเพิ่มสถานที่ใหม่ ระบบสร้างโฟลเดอร์ใน Drive ให้)',
      'กดถ่ายรูป/เลือกรูป → กรอกชื่อ (จำเป็น) ราคา ประกัน ใบ PV วันที่จัดซื้อ หมายเหตุ',
      'กดบันทึก → ระบบออกรหัสถัดไปให้ อัปโหลดรูปเข้าโฟลเดอร์สถานที่ และตั้งชื่อไฟล์ตามมาตรฐานให้เอง'])}
    <div class="mn-tip">ถ่ายแนวนอน ในที่แสงพอ ให้เห็นทรัพย์สินทั้งชิ้น · ของเป็นชุดถ่ายรวม 1 รูป แล้วระบุจำนวนในชื่อ</div>`);
  const S6 = sec('edit', '6', 'แก้ไข เปลี่ยนรูป และลบ', `
    <ul class="mn-list">
      <li>เมนู <b>รายการ / แก้ไข</b> → ค้นหาด้วยรหัส ชื่อ หรือหมายเหตุ → กดแถวเพื่อแก้</li>
      <li>แก้แล้ว <b>การ์ดเปลี่ยนตามทันที</b> (เครื่องที่เคยเปิดการ์ดอาจเห็นของเก่าได้ประมาณ 5 นาที)</li>
      <li>เปลี่ยนรูป: เลือกรูปใหม่ในหน้าต่างแก้ไข ระบบอัปโหลดเข้าโฟลเดอร์สถานที่ให้</li>
      <li>ลบ: ต้องพิมพ์รหัสยืนยัน · สติกเกอร์ของรหัสที่ลบจะสแกนแล้วขึ้น “ไม่พบข้อมูล”</li>
    </ul>`);
  const S7 = sec('excel', '7', 'Excel และรายงาน', `
    <ul class="mn-list">
      <li><b>ดาวน์โหลด Excel</b> → เติมข้อมูลหลายรายการพร้อมกัน (เช่น วันที่จัดซื้อ ราคา ใบ PV) → <b>นำกลับเข้า</b> → ดูสิ่งที่เปลี่ยนก่อนกดบันทึก · ช่องว่าง = ไม่เปลี่ยน</li>
      <li><b>รายงานทะเบียนทรัพย์สิน</b> มีรูป โลโก้ และลิงก์การ์ด ใช้ส่งมอบหรือตรวจนับ ดาวน์โหลด หรือบันทึกลง Drive ของหน่วยงาน</li>
    </ul>`);
  const S8 = sec('qr', '8', 'ทำ QR PDF และติดสติกเกอร์', `
    ${steps([
      'เมนู <b>ทำ QR PDF</b> → เลือกสถานที่ → ติ๊กรายการที่ต้องการ',
      'ของเป็นชุดใส่ <b>จำนวน QR</b> (เช่น 4 → ได้ 1/4 … 4/4) หรือ <b>แยกชื่อ</b> บรรทัดละชนิด เช่น <code>รถเข็นหน้าแบน x2</code>',
      'กดสร้าง PDF (20 ดวง/หน้า A4) → ดาวน์โหลด หรือบันทึกลง Drive',
      'พิมพ์ขนาดจริง 100% (ไม่ย่อ/ขยาย) → ตัด → <b>สแกนตรวจทุกดวงก่อนติด</b> → ติดในตำแหน่งที่เห็นชัด ไม่โดนน้ำ/ความร้อน'])}`);
  const S9 = sec('faq', '9', 'คำถามที่พบบ่อย', `
    <dl class="mn-faq">
      <dt>สแกนแล้วรูปไม่ขึ้น</dt><dd>โฟลเดอร์หลักยังไม่ได้แชร์ “ทุกคนที่มีลิงก์ – ผู้มีสิทธิ์อ่าน” หรือไฟล์รูปถูกลบ/ย้าย</dd>
      <dt>แก้ข้อมูลแล้ว ต้องพิมพ์ QR ใหม่ไหม</dt><dd>ไม่ต้อง QR ผูกกับรหัส แก้ข้อมูลเมื่อไหร่การ์ดเปลี่ยนตาม ยกเว้นเปลี่ยนรหัส</dd>
      <dt>ไม่เห็นหน่วยงานอื่น</dt><dd>บัญชีหน่วยงานเห็นเฉพาะหน่วยงานที่ได้รับสิทธิ์ ต้องการเพิ่มหน่วยงาน แจ้งผู้ดูแลระบบ</dd>
      <dt>ไม่ได้รับอีเมลเชิญ/รีเซ็ต</dt><dd>ดูในสแปม/โปรโมชัน ถ้ายังไม่มี ขอใหม่ด้วย “ลืมรหัสผ่าน?” (ส่งซ้ำได้ทุก 3 นาที) หรือแจ้งผู้ดูแลระบบ</dd>
      <dt>เปลี่ยน Gmail ของหน่วยงาน</dt><dd>แจ้งผู้ดูแลระบบ เพื่อแก้อีเมลในบัญชีและส่งคำเชิญใหม่</dd>
    </dl>`);
  const SA = adminUser ? sec('admin', 'A', 'สำหรับผู้ดูแลระบบ', `
    <p><b>เชิญ Gmail หน่วยงาน</b> (เฉพาะผู้ดูแลสูงสุด)</p>
    ${steps([
      'เมนู <b>ผู้ใช้ระบบ</b> → <b>+ เชิญ Gmail หน่วยงาน</b>',
      'ใส่ Gmail ชื่อที่แสดง เลือกสิทธิ์ <b>ผู้ใช้หน่วยงาน</b> และติ๊กหน่วยงาน (ให้ได้หลายหน่วยงาน)',
      'กด <b>บันทึกและส่งคำเชิญ</b> — อีเมลส่งจาก Gmail ของบัญชีที่ติดตั้ง Apps Script',
      'สถานะ <span class="pill warn">รอตั้งรหัสผ่าน</span> จะเปลี่ยนเป็น <span class="pill ok">ใช้งาน</span> เมื่อเจ้าของอีเมลตั้งรหัสแล้ว · ลิงก์หมดอายุ กด “ส่งคำเชิญอีกครั้ง”'])}
    <p><b>สิทธิ์ 3 ระดับ</b></p>
    <div class="tablewrap" style="max-height:none"><table><thead><tr><th>สิทธิ์</th><th>เห็นหน่วยงาน</th><th>ทำได้</th></tr></thead><tbody>
      <tr><td>${rolePill('owner')}</td><td>ทุกหน่วยงาน</td><td>ทุกเมนู + จัดการผู้ใช้ + ตั้งค่าลิงก์</td></tr>
      <tr><td>${rolePill('admin')}</td><td>ทุกหน่วยงาน</td><td>ทุกเมนู ยกเว้นจัดการผู้ใช้</td></tr>
      <tr><td>${rolePill('unit')}</td><td>เฉพาะที่ได้รับสิทธิ์</td><td>นำเข้า เพิ่ม แก้ไข ลบ Excel ทำ QR · ไม่เห็นตั้งค่าหน่วยงาน</td></tr>
    </tbody></table></div>
    <p style="margin-top:14px"><b>เตรียม Drive ของหน่วยงานใหม่</b></p>
    <ul class="mn-list">
      <li>ให้หน่วยงานแชร์โฟลเดอร์หลัก “ทะเบียนทรัพย์สิน” ให้ Gmail ผู้ดูแลระบบเป็น <b>ผู้แก้ไข</b> และตั้ง “ทุกคนที่มีลิงก์ – ผู้อ่าน”</li>
      <li>เมนู <b>ตั้งค่าหน่วยงาน</b> → เพิ่ม/แก้ไข → วางลิงก์โฟลเดอร์หลัก → ตรวจ → บันทึก (ผู้ใช้หน่วยงานใช้ Drive ได้เฉพาะในโฟลเดอร์นี้)</li>
      <li>หน่วยงานใหม่ใส่โลโก้และสีธีมได้เอง การ์ดเปลี่ยนตามทันที</li>
    </ul>`) : '';
  const toc = [['login', 'เข้าสู่ระบบ'], ['flow', 'ขั้นตอน'], ['name', 'ชื่อไฟล์'], ['import', 'นำเข้า'], ['add', 'เพิ่ม'], ['edit', 'แก้ไข'], ['excel', 'Excel'], ['qr', 'QR'], ['faq', 'คำถาม']].concat(adminUser ? [['admin', 'ผู้ดูแลระบบ']] : []);
  main.innerHTML = `
  <h2>คู่มือการใช้งาน</h2>
  <section class="mn-hero">
    <div class="mn-hero-ic">${icon('book')}</div>
    <div class="mn-hero-tx"><b>คู่มือการใช้งานระบบ QR ทะเบียนทรัพย์สิน</b><span>${unitUser ? 'สำหรับเจ้าหน้าที่หน่วยงาน' : 'สำหรับเจ้าหน้าที่หน่วยงานและผู้ดูแลระบบ'} · กดหัวข้อเพื่อเปิดอ่าน</span></div>
    ${S.cfg && S.cfg.manualUrl ? `<a class="btn accent" href="${esc(S.cfg.manualUrl)}" target="_blank" rel="noopener">เปิดคู่มือ PDF ฉบับละเอียด ↗</a>` : (S.user && S.user.role === 'owner' ? '<button class="btn sec" id="mnSetPdf">ตั้งลิงก์คู่มือ PDF</button>' : '')}
  </section>
  <nav class="mn-toc">${toc.map(([id, t]) => `<button data-mn="${id}">${t}</button>`).join('')}<button data-mn="__all" class="all">เปิดทั้งหมด</button></nav>
  <div class="mn-wrap">${S1}${S2}${S3}${S4}${S5}${S6}${S7}${S8}${S9}${SA}</div>
  <p class="small muted" style="text-align:center;margin-top:18px">ติดปัญหาการใช้งาน ติดต่อฝ่ายธุรการและประชาสัมพันธ์ (ADM-PR) · Major Property Service</p>`;
  $$('.mn-toc button', main).forEach(b => b.onclick = () => {
    if (b.dataset.mn === '__all') { const all = $$('details.mn', main); const open = all.some(d => !d.open); all.forEach(d => { d.open = open; }); b.textContent = open ? 'ปิดทั้งหมด' : 'เปิดทั้งหมด'; return; }
    const d = $('#mn-' + b.dataset.mn); if (!d) return; d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const sp = $('#mnSetPdf', main); if (sp) sp.onclick = () => go('users');
};

/* =================== ผู้ใช้ระบบ (เฉพาะผู้ดูแลสูงสุด) =================== */
function genPassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', D = '23456789';
  const r = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  let p = 'Mj'; for (let i = 0; i < 6; i++) p += A[r(A.length)]; p += D[r(D.length)] + D[r(D.length)];
  return p;
}
function fmtExp(d) { return d ? new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; }
function siteUrl() { return (S.cfg && S.cfg.webAppUrl) || (location.origin + location.pathname); }
async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); toast('คัดลอกแล้ว'); }
  catch (e) {
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); }
    toast('กด Ctrl+C เพื่อคัดลอกข้อความที่เลือกไว้');
  }
}
/** กล่องข้อความให้ผู้ดูแลคัดลอกไปส่งผู้ใช้ทางช่องทางส่วนตัว (LINE / Gmail) */
function credentialsBox(title, text, note) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<div class="dh"><h3>${esc(title)}</h3><button class="x" data-close>×</button></div>
    <div class="db"><p style="margin:0 0 10px">${esc(note || 'ส่งข้อความนี้ให้ผู้ใช้ทางช่องทางส่วนตัว เช่น LINE หรือ Gmail')}</p><div class="cred" id="credTxt">${esc(text)}</div></div>
    <div class="df"><button class="btn sec" data-close>ปิด</button><button class="btn" id="credCopy">คัดลอกข้อความ</button></div>`;
  dlg.showModal();
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  $('#credCopy').onclick = () => copyText(text, $('#credTxt'));
}
/** แจ้งผู้ใช้: mode 'email' = ส่งอีเมล · 'link' = คัดลอกลิงก์ตั้งรหัสผ่าน */
async function sendInvite(username, mode) {
  const r = await guard(() => run('inviteUser', username, mode === 'link' ? 'link' : 'email'), mode === 'link' ? 'กำลังสร้างลิงก์…' : 'กำลังส่งอีเมล…');
  if (!r) return r;
  if (mode === 'link') {
    const invite = r.kind === 'invite';
    credentialsBox(invite ? 'ลิงก์เชิญเข้าใช้ระบบ' : 'ลิงก์ตั้งรหัสผ่านใหม่',
      `ระบบ QR ทะเบียนทรัพย์สิน · Major Property Service\nเข้าระบบด้วย: ${r.email}\n${invite ? 'เปิดลิงก์นี้เพื่อตั้งรหัสผ่านของคุณ' : 'เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่'} (ใช้ได้ครั้งเดียว ถึง ${fmtExp(r.expires_at)}):\n${r.link}`,
      'ลิงก์นี้ใช้ได้ครั้งเดียว ส่งให้เจ้าของบัญชีเท่านั้น — ลิงก์ที่ส่งก่อนหน้านี้จะใช้ไม่ได้แล้ว');
  } else toast(`ส่ง${r.kind === 'invite' ? 'คำเชิญ' : 'ลิงก์ตั้งรหัสผ่านใหม่'}ไปที่ ${r.email} แล้ว${r.from ? ' (ผู้ส่ง ' + r.from + ')' : ''}`);
  return r;
}
function tempPasswordText(login, pw) {
  return `ระบบ QR ทะเบียนทรัพย์สิน · Major Property Service\nลิงก์: ${siteUrl()}\nเข้าระบบด้วย: ${login}\nรหัสผ่านชั่วคราว: ${pw}\n(ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าครั้งแรก)`;
}
/** รีเซ็ต/แจ้งรหัสผ่านของผู้ใช้ 1 คน: ส่งอีเมล · คัดลอกลิงก์ · ตั้งรหัสชั่วคราว */
function passwordDialog(u, done) {
  const dlg = $('#dlg'), pending = !u.has_password;
  const login = u.email || u.username;
  dlg.innerHTML = `<div class="dh"><h3>${pending ? 'ส่งคำเชิญอีกครั้ง' : 'รีเซ็ตรหัสผ่าน'} · ${esc(login)}</h3><button class="x" data-close>×</button></div>
    <div class="db">
      <div class="pick">
        <label class="pk"><input type="radio" name="pdM" value="email" ${u.email ? 'checked' : 'disabled'}><span><b>ส่งลิงก์ทางอีเมล</b><small>${u.email ? 'ส่งไปที่ ' + esc(u.email) + ' · เจ้าของอีเมลตั้งรหัสเอง' : 'บัญชีนี้ยังไม่มี Gmail'}</small></span></label>
        <label class="pk"><input type="radio" name="pdM" value="link" ${u.email ? '' : 'disabled'}><span><b>คัดลอกลิงก์ไปส่งเอง</b><small>ได้ลิงก์ตั้งรหัสผ่านใช้ครั้งเดียว ส่งทาง LINE หรือช่องทางอื่น</small></span></label>
        <label class="pk"><input type="radio" name="pdM" value="temp" ${u.email ? '' : 'checked'}><span><b>ตั้งรหัสผ่านชั่วคราว</b><small>ผู้ใช้ต้องเปลี่ยนเป็นรหัสของตัวเองเมื่อเข้าครั้งแรก</small></span></label>
      </div>
      <div id="pdTemp" class="row" style="flex-wrap:nowrap;margin-top:12px"><input id="pdPw" class="inp" value="${genPassword()}" autocomplete="off" spellcheck="false"><button class="btn sm sec" id="pdGen" type="button">สุ่มรหัส</button></div>
      <div class="small muted" style="margin-top:10px">${pending ? 'ลิงก์เชิญเดิมจะใช้ไม่ได้ เมื่อออกลิงก์ใหม่' : 'รหัสผ่านเดิมยังใช้ได้จนกว่าผู้ใช้จะตั้งรหัสใหม่จากลิงก์ · ถ้าตั้งรหัสชั่วคราว รหัสเดิมจะใช้ไม่ได้ทันที'}</div>
    </div>
    <div class="df"><button class="btn sec" data-close>ยกเลิก</button><button class="btn" id="pdGo">ดำเนินการ</button></div>`;
  dlg.showModal();
  $$('[data-close]', dlg).forEach(b => b.onclick = () => dlg.close());
  const mode = () => ($$('input[name=pdM]', dlg).find(x => x.checked) || {}).value;
  const sync = () => { $('#pdTemp').style.display = mode() === 'temp' ? '' : 'none'; $('#pdGo').textContent = { email: 'ส่งอีเมล', link: 'สร้างลิงก์', temp: 'ตั้งรหัสชั่วคราว' }[mode()] || 'ดำเนินการ'; };
  $$('input[name=pdM]', dlg).forEach(x => x.onchange = sync); sync();
  $('#pdGen').onclick = () => { $('#pdPw').value = genPassword(); };
  $('#pdGo').onclick = async () => {
    const m = mode();
    if (m === 'temp') {
      const pw = $('#pdPw').value.trim(); const w = pwStrengthMsg(pw); if (w) return toast('รหัสผ่าน: ' + w, true);
      dlg.close();
      const ok = await guard(() => api('users.save', { user: { username: u.username, email: u.email || null, display_name: u.display_name, role: u.role, units: u.units || [], active: u.active, password: pw } }), 'กำลังบันทึก…');
      if (ok) { credentialsBox('ตั้งรหัสผ่านชั่วคราวแล้ว', tempPasswordText(login, pw), 'ส่งข้อความนี้ให้ผู้ใช้ทางช่องทางส่วนตัว รหัสผ่านจะไม่แสดงอีกหลังปิดหน้าต่างนี้'); if (done) done(); }
      return;
    }
    dlg.close();
    if (await sendInvite(u.username, m) && done) done();
  };
}
VIEWS.users = async (main) => {
  if (!S.user || S.user.role !== 'owner') { main.innerHTML = '<div class="card note">เฉพาะผู้ดูแลสูงสุดเท่านั้น</div>'; return; }
  const r = await guard(() => api('users.list', {}), 'กำลังโหลดรายชื่อผู้ใช้…');
  const users = (r && r.users) || [];
  const fmt = d => d ? new Date(d).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  const uname = p => { const x = S.units.find(y => y.prefix === p); return x ? x.name : p; };
  const locked = u => u.locked_until && new Date(u.locked_until) > new Date();
  const status = u => !u.active ? '<span class="pill err">ระงับ</span>' : locked(u) ? '<span class="pill warn">ถูกล็อกชั่วคราว</span>'
    : !u.has_password ? (u.setup_pending ? '<span class="pill warn">รอตั้งรหัสผ่าน</span>' : '<span class="pill err">ลิงก์เชิญหมดอายุ</span>')
    : u.must_change ? '<span class="pill warn">รอเปลี่ยนรหัสชั่วคราว</span>' : '<span class="pill ok">ใช้งาน</span>';
  const nUnit = users.filter(u => u.role === 'unit').length, nWait = users.filter(u => u.active && !u.has_password).length;
  const cfg = S.cfg || {};
  const mailFrom = cfg.mailRelayUrl && cfg.mailRelaySet ? (cfg.mailFrom || 'Gmail กลาง (ยังไม่ได้ทดสอบส่ง)') : 'บัญชีที่ติดตั้ง Apps Script (ยังไม่ได้ตั้ง Gmail กลาง)';
  main.innerHTML = `
  <h2>ผู้ใช้ระบบ</h2>
  <p class="sub">เชิญ Gmail ของหน่วยงานให้ใช้ระบบ → เจ้าของอีเมลตั้งรหัสผ่านเอง · ผู้ใช้หน่วยงานเห็นและแก้ได้เฉพาะหน่วยงานของตัวเอง</p>
  <div class="stats">
    <div class="stat"><span class="si">${icon('users')}</span><div><b>${users.length}</b><span>บัญชีทั้งหมด</span></div></div>
    <div class="stat"><span class="si">${icon('units')}</span><div><b>${nUnit}</b><span>ผู้ใช้หน่วยงาน</span></div></div>
    <div class="stat"><span class="si or">${icon('clock')}</span><div><b>${nWait}</b><span>รอตั้งรหัสผ่าน</span></div></div>
  </div>
  <section class="panel" style="margin-top:16px">
    <div class="ph"><h3>บัญชีทั้งหมด</h3><button class="btn" id="usNew">+ เชิญผู้ใช้ใหม่</button></div>
    <div class="tablewrap"><table><thead><tr><th>บัญชี (เข้าระบบด้วย)</th><th>สิทธิ์ / หน่วยงาน</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td><div class="ucell"><span class="av">${esc((u.display_name || u.username).trim().charAt(0).toUpperCase())}</span><div><b>${esc(u.email || u.username)}</b>${u.username === S.user.username ? ' <span class="pill gray">คุณ</span>' : ''}<div class="small muted">${esc(u.display_name || '–')}${u.email && u.username !== u.email ? ' · ชื่อผู้ใช้ ' + esc(u.username) : ''}</div></div></div></td>
      <td>${rolePill(u.role)}${u.role === 'unit' ? `<div class="uchips" style="margin-top:6px">${(u.units || []).map(p => `<span class="uchip" title="${esc(uname(p))}">${esc(p)}</span>`).join('')}</div>` : ''}</td>
      <td>${status(u)}</td><td class="small">${fmt(u.last_login)}</td>
      <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap">
        <button class="btn sm sec" data-ed="${esc(u.username)}">แก้ไขสิทธิ์</button>
        ${u.active ? `<button class="btn sm sec" data-pw="${esc(u.username)}">${u.has_password ? 'รีเซ็ตรหัสผ่าน' : 'ส่งคำเชิญอีกครั้ง'}</button>` : ''}
        <button class="btn sm danger" data-del="${esc(u.username)}" ${u.username === S.user.username ? 'disabled title="ลบบัญชีของตัวเองไม่ได้"' : ''}>ลบบัญชี</button></div></td></tr>`).join('')}
    </tbody></table></div>
  </section>
  <div id="usForm"></div>
  <section class="panel" style="margin-top:16px" id="mailPanel">
    <div class="ph"><h3>ผู้ส่งอีเมล</h3><span class="pill ${cfg.mailFrom ? 'ok' : 'gray'}">ส่งจาก: ${esc(mailFrom)}</span></div>
    <p class="small muted" style="margin:0 0 12px">อีเมลเชิญและลิงก์ตั้งรหัสผ่านจะส่งจาก Gmail กลางของบริษัท เมื่อติดตั้ง “ตัวส่งอีเมล” (ไฟล์ <code>MailRelay.gs</code>) ใน Apps Script ของ Gmail กลาง แล้วใส่ลิงก์และรหัสด้านล่าง</p>
    <div class="grid g2">
      <label class="f">ลิงก์ตัวส่งอีเมล (/exec)<input id="mrUrl" value="${esc(cfg.mailRelayUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" spellcheck="false"></label>
      <label class="f">รหัสตัวส่งอีเมล<div class="lg-in">${IC.lock}<input id="mrSec" type="password" autocomplete="off" spellcheck="false" placeholder="${cfg.mailRelaySet ? 'ตั้งไว้แล้ว — เว้นว่างถ้าไม่เปลี่ยน' : 'คัดลอกจากบันทึกการดำเนินการ'}"><button type="button" class="lg-eye" data-eye="mrSec" aria-label="แสดงรหัส">${IC.eyeOn}</button></div></label>
    </div>
    <div class="row" style="justify-content:space-between;margin-top:12px;gap:10px">
      <div class="row" style="flex-wrap:nowrap;flex:1;min-width:260px;max-width:480px"><input id="mrTo" class="inp" type="email" value="${esc(S.user.email || '')}" placeholder="อีเมลสำหรับทดสอบ"><button class="btn sm sec" id="mrTest" type="button">ทดสอบส่ง</button></div>
      <div class="row">${cfg.mailRelayUrl ? '<button class="btn sm danger" id="mrOff" type="button">เลิกใช้ Gmail กลาง</button>' : ''}<button class="btn" id="mrSave" type="button">บันทึกผู้ส่งอีเมล</button></div>
    </div>
  </section>
  <section class="panel" style="margin-top:16px">
    <div class="ph"><h3>ตั้งค่าลิงก์</h3></div>
    <div class="grid g2">
      <label class="f">ลิงก์หน้าเว็บ (ใช้ในลิงก์ที่ส่งทางอีเมล)<div class="row" style="flex-wrap:nowrap"><input id="stWeb" class="inp" value="${esc(cfg.webAppUrl || '')}" placeholder="https://ชื่อผู้ใช้.github.io/qr-asset/">${HAS_GAS ? '' : '<button class="btn sm sec" id="stHere" type="button">ใช้ลิงก์หน้านี้</button>'}</div></label>
      <label class="f">ลิงก์คู่มือ PDF ฉบับละเอียด (แสดงในเมนูคู่มือ)<input id="stMan" value="${esc(cfg.manualUrl || '')}" placeholder="https://drive.google.com/file/d/…"></label>
    </div>
    ${!HAS_GAS && cfg.webAppUrl !== location.origin + location.pathname ? '<div class="note small" style="margin-top:10px">ลิงก์ในอีเมลเชิญยังไม่ใช่หน้าเว็บนี้ — กด “ใช้ลิงก์หน้านี้” แล้วบันทึก เพื่อให้ผู้รับเปิดหน้าเว็บบน GitHub</div>' : ''}
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="stSave">บันทึกการตั้งค่า</button></div>
  </section>`;
  bindEyes($('#mailPanel'));
  if ($('#stHere')) $('#stHere').onclick = () => { $('#stWeb').value = location.origin + location.pathname; };
  $('#stSave').onclick = async () => {
    const r2 = await guard(() => run('saveSettings', { webAppUrl: $('#stWeb').value.trim(), manualUrl: $('#stMan').value.trim() }), 'กำลังบันทึก…');
    if (r2) { S.cfg = Object.assign(S.cfg || {}, r2); toast('บันทึกการตั้งค่าแล้ว'); }
  };
  $('#mrSave').onclick = async () => {
    const o = { mailRelayUrl: $('#mrUrl').value.trim() }; const sec = $('#mrSec').value.trim();
    if (sec) o.mailRelaySecret = sec;
    if (o.mailRelayUrl && !sec && !cfg.mailRelaySet) return toast('ใส่รหัสตัวส่งอีเมลด้วย', true);
    const r2 = await guard(() => run('saveSettings', o), 'กำลังบันทึก…');
    if (r2) { S.cfg = Object.assign(S.cfg || {}, r2); toast('บันทึกแล้ว — กด “ทดสอบส่ง” เพื่อตรวจว่าใช้งานได้'); go('users'); }
  };
  if ($('#mrOff')) $('#mrOff').onclick = async () => {
    if (!confirm('เลิกใช้ Gmail กลาง? อีเมลจะกลับไปส่งจากบัญชีที่ติดตั้ง Apps Script')) return;
    const r2 = await guard(() => run('saveSettings', { mailRelayUrl: '', mailRelaySecret: '' }), 'กำลังบันทึก…');
    if (r2) { S.cfg = Object.assign(S.cfg || {}, r2); go('users'); }
  };
  $('#mrTest').onclick = async () => {
    const to = $('#mrTo').value.trim(); if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) return toast('ใส่อีเมลสำหรับทดสอบ', true);
    const r2 = await guard(() => run('testMail', to), 'กำลังส่งอีเมลทดสอบ…');
    if (r2) { toast(`ส่งอีเมลทดสอบแล้ว จาก ${r2.from || '-'}${r2.quota != null ? ' · ส่งได้อีกวันนี้ ' + r2.quota + ' ฉบับ' : ''}`); S.cfg.mailFrom = r2.from || S.cfg.mailFrom; }
  };
  const form = (u) => {
    const isNew = !u;
    u = u || { username: '', email: '', display_name: '', role: 'unit', units: S.unit ? [S.unit.prefix] : [], active: true };
    const self = !isNew && u.username === S.user.username;
    const sel = new Set(u.units || []);
    $('#usForm').innerHTML = `<section class="panel usform" style="margin-top:16px">
      <div class="ph"><h3>${isNew ? 'เชิญผู้ใช้ใหม่' : 'แก้ไขสิทธิ์ · ' + esc(u.email || u.username)}</h3></div>
      <div class="grid g2">
        <label class="f">Gmail ที่ใช้เข้าระบบ${isNew ? ' *' : ''}<input id="ufE" type="email" value="${esc(u.email || '')}" autocapitalize="none" spellcheck="false" placeholder="เช่น juristic.project@gmail.com"></label>
        <label class="f">ชื่อที่แสดง<input id="ufN" value="${esc(u.display_name || '')}" placeholder="เช่น นิติบุคคลอาคารชุด พลัมมิกซ์ แจ้งวัฒนะ"></label>
        <label class="f">บทบาท<select id="ufR" ${self ? 'disabled' : ''}>
          <option value="unit"${u.role === 'unit' ? ' selected' : ''}>ผู้ใช้หน่วยงาน — เห็นเฉพาะหน่วยงานที่เลือก</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>แอดมิน — เห็นทุกหน่วยงาน</option>
          <option value="owner"${u.role === 'owner' ? ' selected' : ''}>ผู้ดูแลสูงสุด — เห็นทุกหน่วยงาน + จัดการผู้ใช้</option></select></label>
        ${isNew ? '' : `<label class="f">ชื่อผู้ใช้ (แก้ไขไม่ได้)<input value="${esc(u.username)}" disabled></label>`}
      </div>
      <div id="ufUnitsBox" style="margin-top:14px"><div class="small" style="font-weight:600;color:var(--muted);margin-bottom:6px">หน่วยงานที่ให้สิทธิ์ *</div>
        <div class="ucheck">${S.units.map(x => `<label><input type="checkbox" value="${esc(x.prefix)}" ${sel.has(x.prefix) ? 'checked' : ''}><b>${esc(x.prefix)}</b><span>${esc(x.name)}</span></label>`).join('')}</div></div>
      ${isNew ? `<div style="margin-top:16px"><div class="small" style="font-weight:600;color:var(--muted);margin-bottom:6px">วิธีแจ้งผู้ใช้</div>
        <div class="pick row3">
          <label class="pk"><input type="radio" name="ufM" value="email" checked><span><b>ส่งอีเมลเชิญ</b><small>ระบบส่งลิงก์ไปที่ Gmail · เจ้าของอีเมลตั้งรหัสเอง (แนะนำ)</small></span></label>
          <label class="pk"><input type="radio" name="ufM" value="link"><span><b>คัดลอกลิงก์เชิญ</b><small>ได้ลิงก์ใช้ครั้งเดียว ส่งทาง LINE เอง</small></span></label>
          <label class="pk"><input type="radio" name="ufM" value="temp"><span><b>รหัสผ่านชั่วคราว</b><small>คัดลอกชื่อผู้ใช้ + รหัสไปส่งเอง</small></span></label>
        </div>
        <div id="ufTemp" class="row" style="flex-wrap:nowrap;margin-top:10px;max-width:460px"><input id="ufP" class="inp" value="${genPassword()}" autocomplete="off" spellcheck="false"><button class="btn sm sec" id="ufGen" type="button">สุ่มรหัส</button></div></div>`
      : `<label class="chk" style="margin-top:12px"><input type="checkbox" id="ufA" ${u.active !== false ? 'checked' : ''} ${self ? 'disabled' : ''}> เปิดใช้งาน (เอาเครื่องหมายออก = ระงับชั่วคราว)</label>`}
      <div class="note info small" style="margin-top:12px">${isNew ? 'ลิงก์เชิญใช้ได้ 7 วัน ครั้งเดียว · เจ้าของอีเมลเข้าระบบด้วย Gmail + รหัสผ่านที่ตั้งเอง · ลืมรหัสกด “ลืมรหัสผ่าน?” ที่หน้าเข้าสู่ระบบได้เอง' : 'เปลี่ยนบทบาทหรือระงับบัญชี ผู้ใช้จะถูกออกจากระบบทันที · เปลี่ยนรหัสผ่านใช้ปุ่ม “รีเซ็ตรหัสผ่าน” ในตาราง'}</div>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn sec" id="ufX">${isNew ? 'ล้างฟอร์ม' : 'ปิด'}</button><button class="btn" id="ufSave">${isNew ? 'เชิญผู้ใช้' : 'บันทึกสิทธิ์'}</button></div></section>`;
    const syncRole = () => { $('#ufUnitsBox').style.display = $('#ufR').value === 'unit' ? '' : 'none'; };
    $('#ufR').onchange = syncRole; syncRole();
    const mode = () => isNew ? ($$('input[name=ufM]').find(x => x.checked) || {}).value : '';
    if (isNew) {
      const syncM = () => { $('#ufTemp').style.display = mode() === 'temp' ? '' : 'none'; $('#ufSave').textContent = { email: 'เชิญและส่งอีเมล', link: 'เชิญและสร้างลิงก์', temp: 'สร้างบัญชี' }[mode()]; };
      $$('input[name=ufM]').forEach(x => x.onchange = syncM); syncM();
      $('#ufGen').onclick = () => { $('#ufP').value = genPassword(); };
    }
    $('#ufX').onclick = () => { if (isNew) form(null); else $('#usForm').innerHTML = ''; };
    $('#ufSave').onclick = async () => {
      const email = $('#ufE').value.trim().toLowerCase();
      const role = self ? 'owner' : $('#ufR').value;
      const units = $$('#ufUnitsBox input:checked').map(x => x.value);
      const m = mode(), pw = m === 'temp' ? $('#ufP').value.trim() : '';
      if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return toast('รูปแบบ Gmail ไม่ถูกต้อง', true);
      if (isNew && !email) return toast('ใส่ Gmail ที่ใช้เข้าระบบ', true);
      if (role === 'unit' && !email) return toast('ผู้ใช้หน่วยงานต้องมี Gmail', true);
      if (role === 'unit' && !units.length) return toast('เลือกหน่วยงานอย่างน้อย 1 หน่วยงาน', true);
      if (isNew && users.some(x => x.email === email || x.username === email)) return toast('มีบัญชีนี้อยู่แล้ว ใช้ปุ่ม “แก้ไขสิทธิ์” หรือ “รีเซ็ตรหัสผ่าน” แทน', true);
      if (pw && pwStrengthMsg(pw)) return toast('รหัสผ่าน: ' + pwStrengthMsg(pw), true);
      const user = { username: isNew ? email : u.username, email: email || null, display_name: $('#ufN').value.trim(), role, units: role === 'unit' ? units : [], active: isNew || self ? true : $('#ufA').checked };
      if (pw) user.password = pw;
      const ok = await guard(() => api('users.save', { user }), 'กำลังบันทึก…');
      if (!ok) return;
      if (isNew && m === 'temp') credentialsBox('สร้างบัญชีแล้ว', tempPasswordText(email, pw), 'ส่งข้อความนี้ให้ผู้ใช้ทางช่องทางส่วนตัว รหัสผ่านจะไม่แสดงอีกหลังปิดหน้าต่างนี้');
      else if (isNew) await sendInvite(ok.username || email, m);
      else toast('บันทึกสิทธิ์ ' + (email || u.username) + ' แล้ว');
      go('users');
    };
    $('#usForm').scrollIntoView({ behavior: 'smooth' });
  };
  $('#usNew').onclick = () => form(null);
  $$('button[data-ed]').forEach(b => b.onclick = () => form(users.find(x => x.username === b.dataset.ed)));
  $$('button[data-pw]').forEach(b => b.onclick = () => passwordDialog(users.find(x => x.username === b.dataset.pw), () => go('users')));
  $$('button[data-del]').forEach(b => b.onclick = async () => {
    const u = users.find(x => x.username === b.dataset.del);
    if (!confirm(`ลบบัญชี ${u.email || u.username} ถาวร?\nผู้ใช้นี้จะเข้าระบบไม่ได้อีก — ถ้าต้องการปิดชั่วคราว ใช้ “แก้ไขสิทธิ์” แล้วเอาเครื่องหมาย “เปิดใช้งาน” ออกแทน`)) return;
    const ok = await guard(() => api('users.delete', { username: u.username }), 'กำลังลบ…');
    if (ok) { toast('ลบบัญชีแล้ว'); go('users'); }
  });
};

async function init() {
  $$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  const hb = $('#hamb'), sc = $('#scrim');
  if (hb) hb.onclick = () => document.body.classList.toggle('nav-open');
  if (sc) sc.onclick = () => document.body.classList.remove('nav-open');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });
  $('#unitSel').onchange = e => { selectUnit(e.target.value); go(S.tab === 'units' ? 'units' : S.tab); };
  busy(true, 'กำลังเชื่อมต่อ…');
  try { S.cfg = await rawRun('getConfig'); }
  catch (e) { busy(false); $('#main').innerHTML = `<div class="card note">เชื่อมต่อไม่สำเร็จ: ${esc(e.message)}<br><span class="small">ตรวจว่าได้รันฟังก์ชัน setup() ใน Apps Script แล้ว</span></div>`; return; }
  const prm = await urlParams();
  if (prm.setup) { busy(false); return showSetup(String(prm.setup)); }
  const st = loadSession();
  if (st && st.token) {
    S.session = st.token; S.user = st.user;
    try {
      const r = await rawRun('rpc', st.token, 'api', ['auth.check', {}]);
      S.user = r.user; busy(false);
      if (r.user.must_change) await changePasswordDialog(true);
      return startAfterLogin();
    } catch (e) { clearSession(); }
  }
  busy(false);
  showLogin('');
}
// เริ่มทำงาน: Apps Script ใส่หน้าเว็บเข้า iframe ภายหลัง บางครั้ง event 'load' ไม่เกิด → เริ่มเองทันทีที่พร้อม
(function startApp() {
  let started = false;
  const begin = () => {
    if (started) return; started = true;
    Promise.resolve().then(init).catch(e => { busy(false); $('#main').innerHTML = `<div class="card note">เริ่มระบบไม่สำเร็จ: ${esc(e && e.message || e)}</div>`; });
  };
  window.addEventListener('error', e => { const m = $('#main'); if (m && !m.innerHTML.trim()) m.innerHTML = `<div class="card note">เกิดข้อผิดพลาด: ${esc(e.message)}</div>`; });
  if (document.readyState !== 'loading') setTimeout(begin, 0);
  else { document.addEventListener('DOMContentLoaded', begin); window.addEventListener('load', begin); }
  setTimeout(begin, 1500);
})();

// เปิดให้หน้าตัวอย่าง/ชุดทดสอบเข้าถึงได้ (ไม่ประกาศตัวแปร global ชนกับสคริปต์ของ Google)
window.QRAPP = {
  S, toast, renderImpBody, buildSpecs, codeLoc,
  override(k, fn) { if (k === 'thumb') thumb = fn; if (k === 'downloadBlob') downloadBlob = fn; },
};
})();
