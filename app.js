/* PFJ Coordinación — versión conectada a Supabase.
 * Ingreso con código por correo (Supabase Auth). Los datos y permisos viven en Supabase;
 * cada rol recibe del servidor solo lo que puede ver (ver supabase/schema.sql).
 */
'use strict';

const CFG = window.PFJ_CONFIG;
const OWNER = CFG.OWNER_EMAIL;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
// Si se entra tocando el enlace del correo, Supabase lee la sesión de la dirección; después la limpiamos.
const APP_URL = location.origin + location.pathname;
const otpOptions = () => ({ shouldCreateUser: true, emailRedirectTo: APP_URL });

/* =============== roles =============== */
const ROLES = {
  coordinador: 'Coordinador/a',
  coord_auxiliar: 'Coordinador/a auxiliar',
  coord_bienestar: 'Coordinador/a de bienestar',
  consejero: 'Consejero/a',
  obispo: 'Obispo / presidente de rama',
  enfermeria: 'Enfermería',
  cocina: 'Cocina'
};
const roleName = (r) => (r === 'dueno' ? 'Dueña' : ROLES[r] || r);
const TABS_BY_ROLE = {
  dueno: ['inicio', 'consejeros', 'participantes', 'obispos', 'salud', 'accesos'],
  coordinador: ['inicio', 'consejeros', 'participantes', 'obispos', 'salud'],
  coord_auxiliar: ['inicio', 'consejeros', 'participantes', 'obispos'],
  coord_bienestar: ['inicio', 'consejeros', 'participantes', 'salud'],
  consejero: ['participantes'],
  obispo: ['consejeros', 'participantes'],
  enfermeria: ['salud', 'consejeros', 'participantes'],
  cocina: ['salud']
};
const can = {
  mark: (r) => ['dueno', 'coordinador', 'coord_auxiliar', 'coord_bienestar', 'consejero'].includes(r),
  bishopMark: (r) => ['dueno', 'coordinador', 'coord_auxiliar'].includes(r),
  export: (r) => ['dueno', 'coordinador'].includes(r)
};

/* =============== estado =============== */
const S = {
  email: null, role: null, stake: null,
  people: [], bishopMarks: {}, markLabel: 'Confirmado',
  users: [], requests: [],
  loading: false
};
const UI_KEY = 'pfj-ui-v2'; // solo preferencias de pantalla (pestaña, grupos abiertos); nada personal
const UI = (() => { try { return { tab: null, open: {}, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') }; } catch { return { tab: null, open: {} }; } })();
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(UI)); } catch { /* sin almacenamiento */ } };

/* =============== utilidades =============== */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const has = (v) => v !== null && v !== undefined && v !== '';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800); }
function plural(n, s, p) { return `${n} ${n === 1 ? s : p}`; }
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/rate limit|too many/i.test(m)) return 'Se pidieron demasiados códigos. Esperá unos minutos y volvé a intentar.';
  if (/expired|invalid/i.test(m) && /otp|token/i.test(m)) return 'El código es incorrecto o venció. Pedí uno nuevo.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor. Revisá internet.';
  if (/function .* does not exist|Could not find the function/i.test(m)) return 'Falta actualizar la base de datos en Supabase (ejecutar 02_acceso.sql).';
  return m;
}

/* =============== lectura del Excel de inscripciones =============== */
const PROVINCES = ['Buenos Aires', 'Catamarca', 'La Rioja', 'Santiago del Estero', 'Tucumán', 'Sin datos'];
function province(stake, ward, phone) {
  if (/^(Ambato|Ancasti|Catamarca) /.test(ward)) return 'Catamarca';
  if (/^(La Rioja|Los Incas|Universidad|La Quebrada|Chilecito) /.test(ward)) return 'La Rioja';
  if (/Santiago del Estero/.test(stake)) return 'Santiago del Estero';
  if (/Tucum|Concepci/.test(stake)) return 'Tucumán';
  if (/Buenos Aires/.test(stake)) return 'Buenos Aires';
  const p = phone.replace(/\D/g, '').replace(/^0/, '');
  if (/^383/.test(p)) return 'Catamarca';
  if (/^380|^3825/.test(p)) return 'La Rioja';
  if (/^385/.test(p)) return 'Santiago del Estero';
  if (/^381|^3865/.test(p)) return 'Tucumán';
  if (/^11/.test(p)) return 'Buenos Aires';
  return 'Sin datos';
}
const NOTHING = new Set(['', '-', '.', 'nada', 'ninguno', 'ninguna', 'no', 'no regiere', 'no requiere', 'n/a']);
const isNothing = (s) => NOTHING.has(norm(s).replace(/\.$/, ''));
const nameCase = (s) => { s = clean(s); return (s === s.toLowerCase() || s === s.toUpperCase()) ? s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : s; };

function parseWorkbook(wb) {
  const seen = new Map();
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
    if (!rows.length) continue;
    const hdr = rows[0].map((h) => clean(h));
    const col = (name) => hdr.indexOf(name);
    const colStarts = (prefix) => hdr.findIndex((h) => h.startsWith(prefix));
    const C = {
      first: col('Nombre de pila'), last: col('Apellido'), pref: col('Nombre que se prefiere'), birth: col('Cumpleaños'),
      sex: col('Sexo'), phone: col('Teléfono'), email: col('Correo electrónico'), med: col('Información médica'),
      food: col('Información alimentaria'), c1n: col('Nombre del contacto 1'), c1e: col('Correo electrónico del contacto 1'),
      c1t: col('Teléfono del contacto 1'), c2n: col('Nombre del contacto 2'), c2e: col('Correo electrónico del contacto 2'),
      c2t: col('Teléfono del contacto 2'), age: col('Edad'), reg: col('Fecha'), estado: col('Estado'), tipo: col('Tipo'),
      stake: col('Nombre de la estaca o distrito'), ward: col('Nombre del barrio o rama'), bishopE: col('Correo electrónico del obispo'),
      bishop: col('Nombre del obispo'), commit: colStarts('Me comprometo'), training: colStarts('He completado la capacitación'),
      church: colStarts('Sobre ti y la Iglesia')
    };
    if (C.first < 0 || C.last < 0) continue;
    for (const r of rows.slice(1)) {
      const g = (k) => (C[k] >= 0 ? clean(r[C[k]]) : '');
      if (!g('first') && !g('last')) continue;
      const tipo = g('tipo') || (/consej/i.test(sheetName) ? 'Consejero' : /partic/i.test(sheetName) ? 'Participante' : '');
      if (!tipo) continue;
      const stake = g('stake'), ward = g('ward'), phone = g('phone');
      const p = {
        tipo, first: nameCase(g('first')), last: nameCase(g('last')), pref: g('pref'),
        prov: province(stake, ward, phone), stake, ward, estado: g('estado'), sex: g('sex'), age: g('age'), birth: g('birth'),
        phone, email: g('email').toLowerCase(), med: g('med'), food: g('food'),
        c1n: g('c1n'), c1t: g('c1t'), c1e: g('c1e').toLowerCase(), c2n: g('c2n'), c2t: g('c2t'), c2e: g('c2e').toLowerCase(),
        bishop: g('bishop'), bishop_e: g('bishopE').toLowerCase(),
        commit: g('commit') === 'true' ? 'Sí' : g('commit') === 'false' ? 'No' : g('commit'),
        training: tipo === 'Consejero' ? g('training') : '',
        member: tipo === 'Participante' ? (/^Soy miembro/.test(g('church')) ? 'Sí' : /^No soy/.test(g('church')) ? 'No' : g('church')) : '',
        reg: g('reg'), obs: []
      };
      p.med_flag = !isNothing(p.med); p.food_flag = !isNothing(p.food);
      p.id = norm(`${tipo}|${p.first}|${p.last}|${p.email}|${p.ward}`);
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
  }
  const people = [...seen.values()];
  const byKey = new Map();
  for (const p of people) {
    const k = p.tipo + '|' + norm(`${p.first} ${p.last}`).split(' ').sort().join(' ');
    (byKey.get(k) || byKey.set(k, []).get(k)).push(p);
  }
  for (const grp of byKey.values()) if (grp.length > 1) for (const p of grp) p.obs.push('Posible inscripción duplicada');
  for (const p of people) if (!p.ward) p.obs.push('Sin estaca ni barrio (provincia estimada por teléfono)');
  for (const p of people) p.obs = p.obs.join(' · ');
  return people;
}

async function importFile(file) {
  if (typeof XLSX === 'undefined') return toast('No se pudo cargar el lector de Excel. Revisá la conexión.');
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = parseWorkbook(wb);
    if (!rows.length) return toast('No encontré inscripciones en ese archivo.');
    toast('Subiendo datos…');
    const { data, error } = await sb.rpc('import_people', { rows });
    if (error) throw error;
    await loadData();
    render();
    toast(`Listo: ${data} personas en la base de datos`);
  } catch (e) { console.error(e); toast(errMsg(e)); }
}

function exportExcel() {
  const rows = (tipo) => sorted(S.people.filter((p) => p.tipo === tipo)).map((p) => ({
    [S.markLabel]: p.mark || '', Provincia: p.prov, Apellido: p.last, Nombre: p.first, 'Barrio / Rama': p.ward,
    'Estaca / Distrito': p.stake, Estado: p.estado, Edad: p.age, Teléfono: p.phone, Correo: p.email,
    ...(tipo === 'Consejero' ? { 'Capacitación de protección': p.training } : { 'Miembro de la Iglesia': p.member }),
    'Información médica': p.med, 'Información alimentaria': p.food, 'Contacto 1': p.c1n, 'Tel. contacto 1': p.c1t,
    Obispo: p.bishop, 'Correo obispo': p.bishop_e, Observaciones: p.obs
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows('Consejero')), 'Consejeros');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows('Participante')), 'Participantes');
  const d = new Date();
  XLSX.writeFile(wb, `PFJ_export_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`);
}

/* =============== datos desde Supabase =============== */
async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { S.email = null; S.role = null; return; }
  S.email = (session.user.email || '').toLowerCase();
  const { data: role, error } = await sb.rpc('my_role');
  if (error) throw error;
  S.role = role || null;
  if (S.role && S.role !== 'dueno') {
    const { data } = await sb.from('app_users').select('stake,name').eq('email', S.email).maybeSingle();
    S.stake = data?.stake || null;
  }
}
async function loadData() {
  const [ppl, st] = await Promise.all([sb.rpc('get_people'), sb.from('settings').select('key,value')]);
  if (ppl.error) throw ppl.error;
  S.people = (ppl.data || []).map((p) => ({ ...p, prov: p.prov || 'Sin datos', ward: p.ward || '', last: p.last || '', first: p.first || '' }));
  const lbl = (st.data || []).find((x) => x.key === 'mark_label');
  if (lbl) S.markLabel = lbl.value;
  if (can.bishopMark(S.role)) {
    const { data } = await sb.from('bishop_marks').select('bishop_key,value');
    S.bishopMarks = Object.fromEntries((data || []).map((x) => [x.bishop_key, x.value]));
  }
  if (S.role === 'dueno') await loadAccess();
}
async function loadAccess() {
  const [u, r] = await Promise.all([
    sb.from('app_users').select('*').order('created_at'),
    sb.from('access_requests').select('*').order('created_at')
  ]);
  S.users = u.data || []; S.requests = r.data || [];
}
async function refresh(quiet) {
  try { await loadData(); render(); if (!quiet) toast('Datos actualizados'); } catch (e) { toast(errMsg(e)); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.role) refresh(true); });

/* =============== derivados =============== */
const isApproved = (p) => /^Aprobado/.test(p.estado || '');
const estadoBadge = (e) => (has(e) ? `<span class="badge ${/^Aprobado/.test(e) ? 'ok' : /^Pendiente/.test(e) ? 'pend' : ''}">${esc(e)}</span>` : '');
function sorted(list) {
  return [...list].sort((a, b) => PROVINCES.indexOf(a.prov) - PROVINCES.indexOf(b.prov) || a.ward.localeCompare(b.ward) || a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}
function waLink(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('54')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.startsWith('9')) d = d.slice(1);
  return d.length === 10 ? `https://wa.me/549${d}` : null;
}
const telLink = (phone) => { const d = String(phone || '').replace(/[^\d+]/g, ''); return d.length >= 8 ? `tel:${d}` : null; };

/* =============== render principal =============== */
async function boot() {
  $('#app').innerHTML = `<div class="auth"><div class="note">Cargando…</div></div>`;
  try {
    const linkFailed = /error_description=/.test(location.hash + location.search);
    await loadMe();
    if (/access_token|error_description|[?&]code=/.test(location.href)) history.replaceState(null, '', APP_URL);
    if (linkFailed && !S.email) toast('El enlace venció o ya se usó. Pedí uno nuevo.');
    if (S.role) await loadData();
  } catch (e) { console.error(e); toast(errMsg(e)); }
  render();
}

function render() {
  const app = $('#app');
  if (!S.email) return renderLogin(app);
  if (!S.role) return renderNoRole(app);
  renderShell(app);
}

function authCard(inner) {
  return `<div class="auth"><div class="auth-card"><img src="icon.svg" alt=""><h1>PFJ Coordinación</h1>${inner}</div></div>`;
}

/* ---------- ingreso ----------
 * Dueña: correo + contraseña fija.
 * Resto: solo si la dueña ya los aceptó reciben un código numérico por correo.
 * Desconocidos: dejan una solicitud (sin código); cuando la aceptan, vuelven y piden el código.
 */
const login = { step: 'email', email: '', msg: '' };

async function startLogin(em) {
  const { data: status, error } = await sb.rpc('login_status', { e: em });
  if (error) throw error;
  login.email = em;
  if (status === 'owner') { login.step = 'password'; return; }
  if (status === 'pending') { login.step = 'pending'; return; }
  if (status === 'none') { login.step = 'request'; return; }
  const { error: e2 } = await sb.auth.signInWithOtp({ email: em, options: otpOptions() });
  if (e2) throw e2;
  login.step = 'code';
}

function renderLogin(app) {
  const back = `<button class="linkbtn" id="back" style="margin-top:8px">Usar otro correo</button>`;
  const bindBack = () => { const b = $('#back'); if (b) b.onclick = () => { Object.assign(login, { step: 'email', email: '', msg: '' }); render(); }; };

  if (login.step === 'email') {
    app.innerHTML = authCard(`
      <p class="lead">Ingresá con tu correo.</p>
      <form id="f">
        <div class="field"><label for="em">Correo</label><input class="input" id="em" type="email" autocomplete="email" required placeholder="nombre@correo.com" value="${esc(login.email)}"></div>
        <div id="err">${login.msg ? `<p class="error">${esc(login.msg)}</p>` : ''}</div>
        <button class="btn btn-primary btn-block" id="go">Continuar</button>
      </form>
      <p class="note" style="margin-top:14px">Si es tu primera vez, vas a poder solicitar acceso. Cuando la coordinación te acepte, te llegará un código al correo para entrar.</p>`);
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const em = clean($('#em').value).toLowerCase();
      if (!emailOk(em)) { $('#err').innerHTML = '<p class="error">Revisá el correo.</p>'; return; }
      $('#go').disabled = true; $('#go').textContent = 'Un momento…';
      try { login.msg = ''; await startLogin(em); }
      catch (err) { login.msg = errMsg(err); }
      render();
    };
    return;
  }

  if (login.step === 'password') {
    app.innerHTML = authCard(`
      <p class="lead">Hola, <b>${esc(login.email)}</b></p>
      <form id="f">
        <div class="field"><label for="pw">Contraseña</label><input class="input" id="pw" type="password" autocomplete="current-password" required></div>
        <div id="err"></div>
        <button class="btn btn-primary btn-block" id="go">Entrar</button>
      </form>
      ${back}
      <p class="note" style="margin-top:10px">¿Todavía no tenés contraseña o la olvidaste? Se crea o se cambia desde Supabase → Authentication → Users (ver la guía).</p>`);
    bindBack();
    $('#pw').focus();
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      $('#go').disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: login.email, password: $('#pw').value });
      $('#go').disabled = false;
      if (error) { $('#err').innerHTML = `<p class="error">${/invalid login/i.test(error.message) ? 'Contraseña incorrecta (o todavía no fue creada).' : esc(errMsg(error))}</p>`; return; }
      Object.assign(login, { step: 'email', email: '', msg: '' });
      await boot(); toast('¡Bienvenida!');
    };
    return;
  }

  if (login.step === 'code') {
    app.innerHTML = authCard(`
      <p class="lead">Te enviamos un código a<br><b>${esc(login.email)}</b></p>
      <form id="f">
        <div class="field"><input class="input code-input" id="code" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="8" required placeholder="000000"></div>
        <div id="err"></div>
        <button class="btn btn-primary btn-block" id="go">Entrar</button>
      </form>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <button class="linkbtn" id="back">Usar otro correo</button>
        <button class="linkbtn" id="resend">Reenviar código</button>
      </div>
      <p class="note" style="margin-top:10px">Revisá también spam o promociones.</p>`);
    bindBack();
    $('#code').focus();
    $('#code').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, ''); };
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      $('#go').disabled = true;
      const { error } = await sb.auth.verifyOtp({ email: login.email, token: clean($('#code').value), type: 'email' });
      $('#go').disabled = false;
      if (error) { $('#err').innerHTML = `<p class="error">${esc(errMsg(error))}</p>`; return; }
      Object.assign(login, { step: 'email', email: '', msg: '' });
      await boot(); if (S.role) toast('¡Bienvenida/o!');
    };
    $('#resend').onclick = async () => {
      const { error } = await sb.auth.signInWithOtp({ email: login.email, options: otpOptions() });
      toast(error ? errMsg(error) : 'Código reenviado');
    };
    return;
  }

  if (login.step === 'pending') {
    app.innerHTML = authCard(`
      <p class="lead">La solicitud de <b>${esc(login.email)}</b> está esperando la aprobación de la coordinación.</p>
      <div class="callout">Cuando te acepten, volvé a ingresar tu correo y te llegará un código para entrar.</div>
      <button class="btn btn-primary btn-block" id="chk">Volver a revisar</button>
      ${back}`);
    bindBack();
    $('#chk').onclick = async () => { try { await startLogin(login.email); } catch (err) { login.msg = errMsg(err); login.step = 'email'; } render(); };
    return;
  }

  // login.step === 'request'
  app.innerHTML = authCard(`
    <p class="lead"><b>${esc(login.email)}</b> todavía no tiene acceso.<br>Completá tus datos y la coordinación revisará tu solicitud.</p>
    <form id="f">
      <div class="field"><label for="nm">Nombre y apellido</label><input class="input" id="nm" required maxlength="80" autocomplete="name"></div>
      <div class="field"><label for="rl">¿Cuál es tu función en PFJ?</label>
        <select class="input" id="rl">${Object.values(ROLES).map((r) => `<option>${esc(r)}</option>`).join('')}<option>Otro</option></select></div>
      <div class="field"><label for="nt">Mensaje (opcional)</label><textarea class="input" id="nt" rows="2" maxlength="200" placeholder="Ej.: soy consejera de la estaca La Rioja"></textarea></div>
      <div id="err"></div>
      <button class="btn btn-primary btn-block" id="go">Solicitar acceso</button>
    </form>
    ${back}`);
  bindBack();
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    $('#go').disabled = true;
    const { data, error } = await sb.rpc('request_access', { e: login.email, n: clean($('#nm').value), f: $('#rl').value, msg: clean($('#nt').value) });
    if (error) { $('#go').disabled = false; $('#err').innerHTML = `<p class="error">${esc(errMsg(error))}</p>`; return; }
    if (data === 'user') { await startLogin(login.email).catch(() => {}); render(); return; }
    login.step = 'pending'; render(); toast('Solicitud enviada');
  };
}

async function logout() {
  await sb.auth.signOut();
  Object.assign(S, { email: null, role: null, stake: null, people: [], users: [], requests: [], bishopMarks: {} });
  render();
}

// Conectado pero sin rol (por ejemplo, le quitaron el acceso).
function renderNoRole(app) {
  app.innerHTML = authCard(`
    <p class="lead"><b>${esc(S.email)}</b> no tiene acceso en este momento.</p>
    <div class="callout">Si creés que es un error, hablá con la coordinación.</div>
    <button class="btn btn-block" id="out">Salir</button>`);
  $('#out').onclick = logout;
}

const TAB_INFO = {
  inicio: { label: 'Inicio', ico: '🏠' },
  consejeros: { label: 'Consejeros', ico: '🧑‍🏫' },
  participantes: { label: 'Participantes', ico: '🧒' },
  obispos: { label: 'Obispos', ico: '✉️' },
  salud: { label: 'Salud', ico: '🩺' },
  accesos: { label: 'Accesos', ico: '🔑' }
};

function renderShell(app) {
  const tabs = TABS_BY_ROLE[S.role] || [];
  if (!tabs.includes(UI.tab)) UI.tab = tabs[0];
  const label = (t) => (t === 'salud' && S.role === 'cocina' ? 'Dietas' : TAB_INFO[t].label);
  app.innerHTML = `
    <header class="topbar">
      <img src="icon.svg" alt="">
      <div class="title">PFJ Coordinación</div>
      <div class="user"><span>${esc(roleName(S.role))}</span><b>${esc(S.email)}</b></div>
      <button id="ref" title="Actualizar datos">⟳</button>
      <button id="logout">Salir</button>
    </header>
    <nav class="tabs">${tabs.map((t) => `<button data-tab="${t}" class="${UI.tab === t ? 'active' : ''}"><span class="ico">${TAB_INFO[t].ico}</span>${label(t)}${t === 'accesos' && S.requests.length ? `<span class="dot">${S.requests.length}</span>` : ''}</button>`).join('')}</nav>
    ${S.role === 'dueno' && S.requests.length && UI.tab !== 'accesos' ? `<div class="reqbar">🔔 ${plural(S.requests.length, 'solicitud de acceso pendiente', 'solicitudes de acceso pendientes')} <button class="btn btn-sm" id="goreq">Revisar</button></div>` : ''}
    <main id="main"></main>`;
  $('#logout').onclick = logout;
  $('#ref').onclick = () => refresh();
  if ($('#goreq')) $('#goreq').onclick = () => { UI.tab = 'accesos'; saveUI(); render(); };
  app.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { UI.tab = b.dataset.tab; saveUI(); render(); window.scrollTo(0, 0); }));
  const main = $('#main');
  if (UI.tab === 'accesos') return renderAccess(main);
  if (!S.people.length) return renderNoData(main);
  ({ inicio: renderHome, consejeros: (m) => renderList(m, 'Consejero'), participantes: (m) => renderList(m, 'Participante'), obispos: renderBishops, salud: renderHealth }[UI.tab])(main);
}

function renderNoData(main) {
  if (S.role !== 'dueno') {
    const why = S.role === 'consejero' ? (S.stake ? `No hay participantes cargados de la estaca «${esc(S.stake)}».` : 'Todavía no te asignaron una estaca. Pedíselo a la coordinación.')
      : S.role === 'obispo' ? 'No hay inscripciones asociadas a tu correo. Si figura otro correo en las inscripciones, avisá a la coordinación.'
      : 'Todavía no hay inscripciones cargadas.';
    main.innerHTML = `<div class="empty"><div class="big">📭</div><p>${why}</p></div>`;
    return;
  }
  main.innerHTML = `
    <h2 class="page">Cargá las inscripciones</h2>
    <p class="sub">Elegí el Excel que descargaste del sistema de inscripciones (por ejemplo <b>Todos.xlsx</b>). Se guarda en la base de datos y cada persona verá solo lo que su rol permite.</p>
    ${dropzone()}`;
  bindDropzone(main);
}
function dropzone() {
  return `<label class="dropzone" id="dz"><div style="font-size:34px">📄</div><b>Tocá para elegir el archivo</b><div class="note">o arrastralo hasta acá · .xlsx</div><input type="file" id="file" accept=".xlsx,.xls" hidden></label>`;
}
function bindDropzone(root) {
  const dz = $('#dz', root), inp = $('#file', root);
  inp.onchange = () => inp.files[0] && importFile(inp.files[0]);
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); e.dataTransfer.files[0] && importFile(e.dataTransfer.files[0]); };
}

/* ---------- Inicio ---------- */
function renderHome(main) {
  const all = S.people;
  const C = all.filter((p) => p.tipo === 'Consejero'), P = all.filter((p) => p.tipo === 'Participante');
  const mk = (list, v) => list.filter((p) => p.mark === v).length;
  const showEstado = all.some((p) => has(p.estado));
  const pend = all.filter((p) => has(p.estado) && !isApproved(p)).length;
  const noTraining = C.filter((p) => p.training === 'No').length;
  const health = all.filter((p) => p.med_flag || p.food_flag).length;
  const bishops = can.bishopMark(S.role) ? bishopGroups().filter((b) => b.pend > 0) : [];
  const bDone = bishops.filter((b) => S.bishopMarks[b.key] === 'Sí').length;
  const provs = PROVINCES.filter((pr) => all.some((p) => p.prov === pr));
  main.innerHTML = `
    <h2 class="page">Resumen</h2>
    <p class="sub">Datos en línea · los cambios de todo el equipo se ven al actualizar (⟳)</p>
    <div class="stats">
      <div class="stat"><div class="k">Consejeros</div><div class="v">${C.length}</div><div class="d">${esc(S.markLabel)}: ${mk(C, 'Sí')} sí · ${mk(C, 'No')} no</div></div>
      <div class="stat"><div class="k">Participantes</div><div class="v">${P.length}</div><div class="d">${esc(S.markLabel)}: ${mk(P, 'Sí')} sí · ${mk(P, 'No')} no</div></div>
      ${showEstado ? `<div class="stat warn"><div class="k">Sin aprobar</div><div class="v">${pend}</div><div class="d">pendientes o en espera</div></div>` : ''}
      ${bishops.length ? `<div class="stat"><div class="k">Obispos avisados</div><div class="v">${bDone}/${bishops.length}</div><div class="d">con inscripciones sin aprobar</div></div>` : ''}
      ${C.some((p) => has(p.training)) ? `<div class="stat bad"><div class="k">Sin capacitación</div><div class="v">${noTraining}</div><div class="d">consejeros (protección)</div></div>` : ''}
      <div class="stat warn"><div class="k">Salud / dieta</div><div class="v">${health}</div><div class="d">personas a tener en cuenta</div></div>
    </div>
    <div class="panel"><h3>Por provincia</h3>
      <table class="t"><thead><tr><th>Provincia</th><th>Consejeros</th><th>Participantes</th><th>Total</th><th>${esc(S.markLabel)} · Sí</th><th>${esc(S.markLabel)} · No</th><th>Sin responder</th></tr></thead>
      <tbody>${provs.map((pr) => {
        const l = all.filter((p) => p.prov === pr), y = mk(l, 'Sí'), n = mk(l, 'No');
        return `<tr><td>${esc(pr)}</td><td>${l.filter((p) => p.tipo === 'Consejero').length}</td><td>${l.filter((p) => p.tipo === 'Participante').length}</td><td><b>${l.length}</b></td><td>${y}</td><td>${n}</td><td>${l.length - y - n}</td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td>${C.length}</td><td>${P.length}</td><td>${all.length}</td><td>${mk(all, 'Sí')}</td><td>${mk(all, 'No')}</td><td>${all.length - mk(all, 'Sí') - mk(all, 'No')}</td></tr></tfoot></table>
    </div>
    <div class="toolbar">${can.export(S.role) ? '<button class="btn" id="exp">⬇️ Exportar a Excel</button>' : ''}<button class="btn" id="prn">🖨️ Imprimir</button></div>`;
  if ($('#exp')) $('#exp').onclick = exportExcel;
  $('#prn').onclick = () => window.print();
}

/* ---------- Listas ---------- */
const listState = { q: '', filter: 'todos' };
function renderList(main, tipo) {
  const plur = tipo === 'Consejero' ? 'Consejeros' : 'Participantes';
  const markable = can.mark(S.role) && !(S.role === 'consejero' && tipo === 'Consejero');
  const filters = [['todos', 'Todos']];
  if (markable) filters.push(['sin', 'Sin responder'], ['si', 'Sí'], ['no', 'No']);
  if (S.people.some((p) => has(p.estado))) filters.push(['pend', 'Sin aprobar']);
  if (S.people.some((p) => p.med_flag || p.food_flag)) filters.push(['salud', 'Salud / dieta']);
  if (!filters.some(([k]) => k === listState.filter)) listState.filter = 'todos';
  main.innerHTML = `
    <h2 class="page">${plur}</h2>
    <p class="sub">Tocá una persona para ver sus datos.${markable ? ` Marcá <b>${esc(S.markLabel)}</b> con Sí / No.` : ''}</p>
    <div class="toolbar"><input class="input" id="q" type="search" placeholder="Buscar por nombre o barrio…" value="${esc(listState.q)}"></div>
    <div class="toolbar chips" id="fil">${filters.map(([k, l]) => `<button class="chip ${listState.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
    <div id="groups"></div>`;
  const draw = () => {
    const q = norm(listState.q);
    let list = S.people.filter((p) => p.tipo === tipo);
    if (q) list = list.filter((p) => norm(`${p.first} ${p.last} ${p.pref} ${p.ward} ${p.stake} ${p.bishop} ${p.prov}`).includes(q));
    list = list.filter((p) => ({ todos: true, sin: !p.mark, si: p.mark === 'Sí', no: p.mark === 'No', pend: has(p.estado) && !isApproved(p), salud: p.med_flag || p.food_flag }[listState.filter]));
    $('#groups', main).innerHTML = list.length ? PROVINCES.map((pr) => {
      const g = sorted(list.filter((p) => p.prov === pr));
      if (!g.length) return '';
      const gk = `${tipo}|${pr}`, closed = UI.open[gk] === false;
      return `<section class="group ${closed ? 'closed' : ''}" data-g="${esc(gk)}">
        <button class="group-h"><span class="car">▾</span>${esc(pr.toUpperCase())}<span class="n">${plural(g.length, tipo.toLowerCase(), plur.toLowerCase())}</span></button>
        <div class="group-b">${g.map((p) => personCard(p, markable)).join('')}</div></section>`;
    }).join('') : `<div class="empty"><div class="big">🔍</div><p>No hay ${plur.toLowerCase()} para mostrar.</p></div>`;
  };
  draw();
  $('#q', main).oninput = (e) => { listState.q = e.target.value; draw(); };
  $('#fil', main).onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; listState.filter = b.dataset.f; main.querySelectorAll('#fil .chip').forEach((c) => c.classList.toggle('on', c === b)); draw(); };
  $('#groups', main).onclick = async (e) => {
    const yn = e.target.closest('[data-mark]');
    if (yn) {
      e.stopPropagation(); if (!markable) return;
      const p = S.people.find((x) => x.id === yn.dataset.id); const prev = p.mark;
      p.mark = prev === yn.dataset.v ? null : yn.dataset.v; draw();
      const { error } = await sb.rpc('set_mark', { pid: p.id, val: p.mark || '' });
      if (error) { p.mark = prev; draw(); toast(errMsg(error)); }
      return;
    }
    if (e.target.closest('a, .details')) return;
    const gh = e.target.closest('.group-h');
    if (gh) { const sec = gh.parentElement; UI.open[sec.dataset.g] = sec.classList.contains('closed'); saveUI(); sec.classList.toggle('closed'); return; }
    const row = e.target.closest('.card-row');
    if (row) { const card = row.parentElement; const d = $('.details', card); if (d) d.remove(); else card.insertAdjacentHTML('beforeend', personDetails(S.people.find((p) => p.id === card.dataset.id))); }
  };
}

function personCard(p, markable) {
  const badges = [estadoBadge(p.estado)];
  if (p.med_flag) badges.push('<span class="badge alert">Médico</span>');
  if (p.food_flag) badges.push('<span class="badge alert">Dieta</span>');
  if (p.tipo === 'Consejero' && p.training === 'No') badges.push('<span class="badge bad">Sin capacitación</span>');
  if (p.tipo === 'Participante' && p.member === 'No') badges.push('<span class="badge">No miembro</span>');
  if (has(p.obs)) badges.push(`<span class="badge bad">${esc(p.obs.split(' · ')[0])}</span>`);
  const meta = [p.ward || (has(p.stake) ? 'Sin barrio' : ''), has(p.age) ? `${p.age} años` : '', p.sex].filter(has).join(' · ');
  return `<article class="card" data-id="${esc(p.id)}">
    <div class="card-row">
      <div class="who"><div class="name">${esc(p.last)}, ${esc(p.first)}</div>
        ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
        <div class="badges">${badges.join('')}</div></div>
      ${markable ? `<div><div class="yn-label">${esc(S.markLabel)}</div>
      <div class="yn"><button class="yes ${p.mark === 'Sí' ? 'on' : ''}" data-mark data-id="${esc(p.id)}" data-v="Sí">Sí</button><button class="no ${p.mark === 'No' ? 'on' : ''}" data-mark data-id="${esc(p.id)}" data-v="No">No</button></div></div>` : ''}
    </div></article>`;
}

function contactLinks(phone, email) {
  const a = [];
  const t = telLink(phone), w = waLink(phone);
  if (t) a.push(`<a class="btn btn-sm" href="${t}">📞 Llamar</a>`);
  if (w) a.push(`<a class="btn btn-sm" href="${w}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
  if (email) a.push(`<a class="btn btn-sm" href="mailto:${esc(email)}">✉️ Correo</a>`);
  return a.length ? `<div class="actions">${a.join('')}</div>` : '';
}
function personDetails(p) {
  const f = (k, v, hl) => (has(v) ? `<div><div class="k">${k}</div><div class="${hl ? 'hl' : ''}">${esc(v)}</div></div>` : '');
  const out = [];
  if (has(p.phone) || has(p.email)) out.push(`<div><div class="k">Contacto</div>${esc(p.phone || '')}<br>${esc(p.email || '')}${contactLinks(p.phone, p.email)}</div>`);
  out.push(f('Nombre preferido', p.pref), f('Estaca / Distrito', p.stake));
  if (has(p.bishop)) out.push(f('Obispo / Presidente', `${p.bishop}${p.bishop_e ? ' · ' + p.bishop_e : ''}`));
  out.push(f('Información médica', p.med, p.med_flag), f('Información alimentaria', p.food, p.food_flag));
  if (has(p.c1n) || has(p.c1t)) out.push(`<div><div class="k">Contacto de emergencia 1</div>${esc(p.c1n || '')}<br>${esc(p.c1t || '')}${contactLinks(p.c1t, p.c1e)}</div>`);
  if (has(p.c2n) || has(p.c2t)) out.push(`<div><div class="k">Contacto de emergencia 2</div>${esc(p.c2n || '')}<br>${esc(p.c2t || '')}${contactLinks(p.c2t, p.c2e)}</div>`);
  out.push(p.tipo === 'Consejero' ? f('Capacitación de protección', p.training, p.training === 'No') : f('Miembro de la Iglesia', p.member));
  out.push(f('Fecha de nacimiento', p.birth), f('Compromiso de salida', p.commit), f('Inscripción', p.reg), f('Observaciones', p.obs, true));
  const body = out.filter(Boolean).join('');
  return `<div class="details">${body || '<div class="note">Tu rol no tiene más datos para ver de esta persona.</div>'}</div>`;
}

/* ---------- Obispos ---------- */
function bishopGroups() {
  const m = new Map();
  for (const p of S.people) {
    const key = p.bishop ? norm(p.bishop) + '|' + (p.bishop_e || '') : '~';
    if (!m.has(key)) m.set(key, { key, name: p.bishop || 'Sin obispo cargado', email: p.bishop_e, list: [] });
    m.get(key).list.push(p);
  }
  return [...m.values()].map((b) => ({ ...b, pend: b.list.filter((p) => !isApproved(p)).length }))
    .sort((a, b) => (a.key === '~') - (b.key === '~') || b.pend - a.pend || a.name.localeCompare(b.name));
}
function bishopMail(b) {
  const pend = b.list.filter((p) => !isApproved(p));
  const body = `Hola, hermano ${b.name}:\n\nTe escribo por la coordinación de PFJ. Estas inscripciones de tu unidad todavía no están aprobadas:\n\n` +
    pend.map((p) => `- ${p.first} ${p.last} (${p.tipo}, ${p.ward}) — ${p.estado}`).join('\n') +
    `\n\n¿Podrías revisarlas cuando tengas un momento? ¡Muchas gracias!`;
  return `mailto:${encodeURIComponent(b.email)}?subject=${encodeURIComponent('PFJ – Inscripciones pendientes de aprobación')}&body=${encodeURIComponent(body)}`;
}
function renderBishops(main) {
  const groups = bishopGroups();
  const withPend = groups.filter((g) => g.pend > 0).length;
  main.innerHTML = `
    <h2 class="page">Obispos y presidentes de rama</h2>
    <p class="sub">${plural(groups.length, 'obispo', 'obispos')} · ${withPend} con inscripciones sin aprobar (aparecen primero). «Escribir correo» abre tu correo con el mensaje armado; vos lo revisás y lo enviás.</p>
    <div id="bl"></div>`;
  const draw = () => {
    $('#bl', main).innerHTML = groups.map((b) => {
      const av = S.bishopMarks[b.key];
      const gk = `b|${b.key}`, closed = UI.open[gk] !== true;
      const list = [...b.list].sort((x, y) => isApproved(x) - isApproved(y) || x.last.localeCompare(y.last));
      return `<section class="group ${closed ? 'closed' : ''}" data-g="${esc(gk)}">
        <button class="group-h"><span class="car">▾</span><span>${esc(b.name)}<br><span style="font-weight:500;font-size:12px">${esc(b.email || '')}</span></span>
          <span class="n">${b.pend ? `<span class="badge pend">${b.pend} sin aprobar</span>` : '<span class="badge ok">Todo aprobado</span>'} de ${b.list.length}</span></button>
        <div class="group-b">
          <div class="row-item">
            <div class="grow"><b>¿Obispo avisado?</b></div>
            <div class="yn"><button class="yes ${av === 'Sí' ? 'on' : ''}" data-bm="${esc(b.key)}" data-v="Sí">Sí</button><button class="no ${av === 'No' ? 'on' : ''}" data-bm="${esc(b.key)}" data-v="No">No</button></div>
            ${b.email && b.pend ? `<a class="btn btn-sm btn-primary" href="${bishopMail(b)}">✉️ Escribir correo</a>` : ''}
          </div>
          ${list.map((p) => `<div class="row-item"><div class="grow"><b>${esc(p.last)}, ${esc(p.first)}</b><div class="note">${esc(p.tipo)} · ${esc(p.ward || 'Sin barrio')} · ${esc(p.prov)}</div></div>${estadoBadge(p.estado)}${contactLinks(p.phone, '')}</div>`).join('')}
        </div></section>`;
    }).join('');
  };
  draw();
  $('#bl', main).onclick = async (e) => {
    const bm = e.target.closest('[data-bm]');
    if (bm) {
      const k = bm.dataset.bm, v = bm.dataset.v, prev = S.bishopMarks[k];
      const next = prev === v ? null : v;
      if (next) S.bishopMarks[k] = next; else delete S.bishopMarks[k];
      draw();
      const { error } = next
        ? await sb.from('bishop_marks').upsert({ bishop_key: k, value: next, updated_by: S.email, updated_at: new Date().toISOString() })
        : await sb.from('bishop_marks').delete().eq('bishop_key', k);
      if (error) { if (prev) S.bishopMarks[k] = prev; else delete S.bishopMarks[k]; draw(); toast(errMsg(error)); }
      return;
    }
    const gh = e.target.closest('.group-h');
    if (gh) { const sec = gh.parentElement; UI.open[sec.dataset.g] = sec.classList.contains('closed'); saveUI(); sec.classList.toggle('closed'); }
  };
}

/* ---------- Salud / Dietas ---------- */
function renderHealth(main) {
  const kitchen = S.role === 'cocina';
  const list = sorted(S.people.filter((p) => (kitchen ? p.food_flag : p.med_flag || p.food_flag)));
  main.innerHTML = `
    <h2 class="page">${kitchen ? 'Dietas especiales' : 'Salud y alimentación'}</h2>
    <p class="sub">${plural(list.length, 'persona', 'personas')} ${kitchen ? 'con indicaciones de alimentación.' : 'con información médica o alimentaria a tener en cuenta.'}</p>
    <div class="toolbar"><button class="btn" id="prn">🖨️ Imprimir esta lista</button></div>
    <div class="list">${list.map((p) => `
      <div class="card"><div class="details" style="border-top:0">
        <div><div class="k">${esc(p.tipo)} · ${esc(p.prov)}</div><b>${esc(p.last)}, ${esc(p.first)}</b>${has(p.age) ? `<div class="note">${esc(p.age)} años · ${esc(p.ward || '')}</div>` : ''}</div>
        ${p.med_flag && has(p.med) ? `<div><div class="k">Médico</div><div class="hl">${esc(p.med)}</div></div>` : ''}
        ${p.food_flag && has(p.food) ? `<div><div class="k">Alimentación</div><div class="hl">${esc(p.food)}</div></div>` : ''}
        ${has(p.c1n) || has(p.c1t) ? `<div><div class="k">Emergencia</div>${esc(p.c1n || '')} · ${esc(p.c1t || '')}${contactLinks(p.c1t, '')}</div>` : ''}
      </div></div>`).join('') || '<div class="empty"><p>No hay personas para mostrar.</p></div>'}</div>`;
  $('#prn').onclick = () => window.print();
}

/* ---------- Accesos (solo la dueña) ---------- */
function roleSelect(attr, value, extra = '') {
  return `<select ${attr} ${extra}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
}
function stakeSelect(attr, value) {
  const stakes = [...new Set(S.people.map((p) => p.stake).filter(has))].sort();
  return `<select ${attr}><option value="">— Estaca —</option>${stakes.map((s) => `<option ${s === value ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
}
function guessRole(func) { const e = Object.entries(ROLES).find(([, v]) => v === func); return e ? e[0] : 'consejero'; }

async function renderAccess(main) {
  await loadAccess().catch((e) => toast(errMsg(e)));
  main.innerHTML = `
    <h2 class="page">Accesos y ajustes</h2>
    <p class="sub">Solo vos ves esta sección. Las personas piden acceso desde la pantalla de ingreso; vos elegís a quién aceptar y con qué rol.</p>
    <div class="callout">El <b>rol</b> define qué datos ve cada persona. Para <b>consejeros</b> elegí también la estaca: verán solo a los participantes de esa estaca. Los <b>obispos</b> ven a los jóvenes cuyo correo de obispo coincide con el suyo.</div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px">Solicitudes pendientes</h3>
      <div class="list" id="reqs"></div>
    </div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px">Personas con acceso</h3>
      <form class="form-inline" id="add">
        <input class="input" id="em" type="email" required placeholder="Agregar correo directamente">
        ${roleSelect('id="role"', 'coordinador')}
        <button class="btn btn-primary">Agregar</button>
      </form>
      <div class="list" id="users"></div>
    </div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px">Inscripciones</h3>
      <p class="note" style="margin-top:0">${S.people.length ? `Hay <b>${S.people.length}</b> personas en la base de datos. Si cargás un Excel nuevo se actualizan; las marcas Sí / No se conservan para quienes sigan en la lista.` : 'Todavía no cargaste el Excel de inscripciones.'}</p>
      ${dropzone()}
      <div class="toolbar" style="margin-top:12px">
        ${S.people.length ? '<button class="btn" id="exp">⬇️ Exportar a Excel</button>' : ''}
        <button class="btn btn-danger" id="wipe">Borrar todas las inscripciones</button>
      </div>
    </div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px">Nombre de la casilla Sí / No</h3>
      <form class="form-inline" id="lbl"><input class="input" id="lb" maxlength="30" value="${esc(S.markLabel)}"><button class="btn">Guardar</button></form>
      <p class="note" style="margin:0">Por ejemplo: Confirmado, Asistió, Pagó, Llegó.</p>
    </div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px">Mi contraseña</h3>
      <form class="form-inline" id="pwf">
        <input class="input" id="pw1" type="password" autocomplete="new-password" minlength="8" required placeholder="Nueva contraseña (mínimo 8)">
        <input class="input" id="pw2" type="password" autocomplete="new-password" minlength="8" required placeholder="Repetila">
        <button class="btn">Cambiar</button>
      </form>
    </div>`;

  const drawReqs = () => {
    $('#reqs', main).innerHTML = S.requests.length ? S.requests.map((x) => {
      const r = guessRole(x.func);
      return `<div class="row-item" data-req="${esc(x.email)}">
        <div class="grow"><b>${esc(x.name || x.email)}</b><div class="note">${esc(x.email)} · pidió: ${esc(x.func || '—')} · ${new Date(x.created_at).toLocaleDateString('es-AR')}</div>${x.note ? `<div class="note">“${esc(x.note)}”</div>` : ''}</div>
        ${roleSelect('data-f="role"', r)} ${stakeSelect('data-f="stake"', '')}
        <button class="btn btn-sm btn-primary" data-accept>Aceptar</button>
        <button class="btn btn-sm btn-danger" data-reject>Rechazar</button></div>`;
    }).join('') : '<p class="note" style="margin:0">No hay solicitudes nuevas.</p>';
  };
  const drawUsers = () => {
    $('#users', main).innerHTML = `<div class="row-item"><div class="grow"><b>${esc(OWNER)}</b><div class="note">Dueña · acceso total · no se puede quitar</div></div></div>` +
      S.users.map((x) => `<div class="row-item" data-user="${esc(x.email)}">
        <div class="grow"><b>${esc(x.name || x.email)}</b><div class="note">${x.name ? esc(x.email) + ' · ' : ''}desde ${new Date(x.created_at).toLocaleDateString('es-AR')}</div></div>
        ${roleSelect('data-f="role"', x.role)} ${stakeSelect('data-f="stake"', x.stake || '')}
        <button class="btn btn-sm btn-danger" data-del>Quitar</button></div>`).join('');
  };
  drawReqs(); drawUsers();

  $('#reqs', main).onclick = async (e) => {
    const row = e.target.closest('[data-req]'); if (!row) return;
    const em = row.dataset.req, req = S.requests.find((x) => x.email === em);
    if (e.target.closest('[data-accept]')) {
      const role = $('[data-f="role"]', row).value, stake = $('[data-f="stake"]', row).value || null;
      if (role === 'consejero' && !stake) return toast('Elegí la estaca del consejero');
      const { error } = await sb.from('app_users').upsert({ email: em, name: req?.name || null, role, stake });
      if (error) return toast(errMsg(error));
      await sb.from('access_requests').delete().eq('email', em);
      toast(`${req?.name || em} ya puede ingresar`);
    } else if (e.target.closest('[data-reject]')) {
      if (!confirm(`¿Rechazar la solicitud de ${em}?`)) return;
      const { error } = await sb.from('access_requests').delete().eq('email', em);
      if (error) return toast(errMsg(error));
      toast('Solicitud rechazada');
    } else return;
    await loadAccess(); render();
  };
  $('#users', main).onchange = async (e) => {
    const row = e.target.closest('[data-user]'); if (!row) return;
    const role = $('[data-f="role"]', row).value, stake = $('[data-f="stake"]', row).value || null;
    const { error } = await sb.from('app_users').update({ role, stake }).eq('email', row.dataset.user);
    toast(error ? errMsg(error) : 'Permiso actualizado');
    if (!error && role === 'consejero' && !stake) toast('Acordate de elegir la estaca del consejero');
  };
  $('#users', main).onclick = async (e) => {
    if (!e.target.closest('[data-del]')) return;
    const em = e.target.closest('[data-user]').dataset.user;
    if (!confirm(`¿Quitar el acceso de ${em}?`)) return;
    const { error } = await sb.from('app_users').delete().eq('email', em);
    if (error) return toast(errMsg(error));
    toast('Acceso quitado'); await loadAccess(); drawUsers();
  };
  $('#add', main).onsubmit = async (e) => {
    e.preventDefault();
    const em = clean($('#em', main).value).toLowerCase();
    if (!emailOk(em)) return toast('Revisá el correo');
    if (em === OWNER || S.users.some((u) => u.email === em)) return toast('Ese correo ya tiene acceso');
    const role = $('#role', main).value;
    const { error } = await sb.from('app_users').insert({ email: em, role });
    if (error) return toast(errMsg(error));
    await sb.from('access_requests').delete().eq('email', em);
    toast(role === 'consejero' ? 'Agregado. Elegí su estaca en la lista.' : 'Acceso otorgado');
    await loadAccess(); render();
  };
  bindDropzone(main);
  if ($('#exp', main)) $('#exp', main).onclick = exportExcel;
  $('#wipe', main).onclick = async () => {
    if (!confirm('Se borran TODAS las inscripciones y marcas Sí / No de la base de datos, para todo el equipo. No se puede deshacer. ¿Continuar?')) return;
    const { error } = await sb.rpc('wipe_people');
    if (error) return toast(errMsg(error));
    await loadData(); render(); toast('Inscripciones borradas');
  };
  $('#pwf', main).onsubmit = async (e) => {
    e.preventDefault();
    const a = $('#pw1', main).value, b = $('#pw2', main).value;
    if (a !== b) return toast('Las contraseñas no coinciden');
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) return toast(errMsg(error));
    $('#pw1', main).value = ''; $('#pw2', main).value = ''; toast('Contraseña cambiada');
  };
  $('#lbl', main).onsubmit = async (e) => {
    e.preventDefault();
    const v = clean($('#lb', main).value) || 'Confirmado';
    const { error } = await sb.from('settings').upsert({ key: 'mark_label', value: v });
    if (error) return toast(errMsg(error));
    S.markLabel = v; toast('Guardado');
  };
}

boot();
