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
  matrimonio_director: 'Matrimonio director de sesión',
  coord_auxiliar: 'Coordinador/a auxiliar',
  coord_bienestar: 'Coordinador/a de bienestar',
  consejero: 'Consejero/a',
  obispo: 'Obispo / presidente de rama',
  enfermeria: 'Enfermería',
  cocina: 'Cocina'
};
const roleName = (r) => (r === 'dueno' ? 'Dueña' : ROLES[r] || r);
const TABS_BY_ROLE = {
  // «Accesos» ya no es una pestaña: es el botón de engranaje de arriba (solo la dueña).
  // «Más» agrupa: Mapa, Obispos, Recuentos, Incidentes, Directorio, Recursos y Mi perfil.
  dueno: ['inicio', 'agenda', 'consejeros', 'participantes', 'salud', 'mas'],
  coordinador: ['inicio', 'agenda', 'consejeros', 'participantes', 'salud', 'mas'],
  matrimonio_director: ['inicio', 'agenda', 'consejeros', 'participantes', 'salud', 'mas'],
  coord_auxiliar: ['inicio', 'agenda', 'consejeros', 'participantes', 'salud', 'mas'],
  coord_bienestar: ['inicio', 'agenda', 'consejeros', 'participantes', 'salud', 'mas'],
  consejero: ['agenda', 'participantes', 'salud', 'mas'],
  obispo: ['consejeros', 'participantes', 'mas'],
  enfermeria: ['agenda', 'salud', 'consejeros', 'participantes', 'mas'],
  cocina: ['agenda', 'salud', 'mas']
};
const inRoles = (list) => (r) => list.includes(r);
const can = {
  // Agenda, avisos y mapa: solo la dueña y los coordinadores pueden modificarlos.
  editEvent: (r) => ['dueno', 'coordinador'].includes(r),
  // Avisos: dueña, coordinadores y matrimonio director.
  postNotice: (r) => ['dueno', 'coordinador', 'matrimonio_director'].includes(r),
  health: inRoles(['dueno', 'coordinador', 'matrimonio_director', 'coord_bienestar', 'enfermeria']),
  healthLog: inRoles(['dueno', 'coordinador', 'matrimonio_director', 'coord_bienestar', 'enfermeria', 'consejero', 'coord_auxiliar']),  owner: (r) => r === 'dueno',
  headcount: inRoles(['dueno', 'coordinador', 'matrimonio_director', 'coord_auxiliar', 'coord_bienestar', 'consejero']),
  seeAllHeadcounts: inRoles(['dueno', 'coordinador', 'matrimonio_director', 'coord_auxiliar', 'coord_bienestar']),
  directory: inRoles(['dueno', 'coordinador', 'matrimonio_director']),
  companies: inRoles(['dueno', 'coordinador', 'matrimonio_director', 'coord_auxiliar', 'coord_bienestar', 'consejero', 'enfermeria']),
  // Sí / No de consejeros: solo la dueña y los coordinadores (los demás no lo ven).
  mark: (r) => ['dueno', 'coordinador'].includes(r),
  seeCons: (r) => (TABS_BY_ROLE[r] || []).includes('consejeros'),
  bishopMark: (r) => ['dueno', 'coordinador', 'matrimonio_director', 'coord_auxiliar'].includes(r),
  export: (r) => ['dueno', 'coordinador', 'matrimonio_director'].includes(r)
};

/* =============== estado =============== */
const S = {
  email: null, role: null, stake: null,
  people: [], bishopMarks: {}, markLabel: 'Confirmado',
  users: [], requests: [],
  schedule: [], notices: [], places: [], day1: null, extrasOk: true,
  reads: [], offline: false, companies: [], members: {},
  loading: false
};
const UI_KEY = 'pfj-ui-v2'; // solo preferencias de pantalla (pestaña, grupos abiertos); nada personal
const UI = (() => { try { return { tab: null, open: {}, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') }; } catch { return { tab: null, open: {} }; } })();
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(UI)); } catch { /* sin almacenamiento */ } };

/* tema claro / oscuro: UI.theme = 'light' | 'dark' | undefined (sigue al celular) */
const systemDark = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = () => (UI.theme ? UI.theme === 'dark' : systemDark());
function applyTheme() {
  if (UI.theme) document.documentElement.setAttribute('data-theme', UI.theme);
  else document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.toggle('dark', isDark());
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', isDark() ? '#16243F' : '#1F3864');
}
function toggleTheme() { UI.theme = isDark() ? 'light' : 'dark'; saveUI(); applyTheme(); render(); }
applyTheme();

/* ---------- Diseño de la app (lo define la dueña desde el Probador de diseño y se guarda para todos) ---------- */
const DESIGN_KEY = 'pfj-design4';
const DESIGN_DEFAULT = { palette: 'institucional', icons: 'cuadro-solido', btn: 'redondeado', nav: 'color', cards: 'borde', font: 'opensans', navico: 'modernos' }; // elegido por Daiana el 8/11/2026
// Juegos de dibujos para la barra de abajo (orden: inicio, agenda, consejeros, participantes, salud, más, obispos, mapa, accesos).
const NAV_SETS = {
  clasicos: ['home', 'calendar-event', 'users', 'mood-kid', 'heartbeat', 'layout-grid', 'mail', 'map-2', 'settings'],
  modernos: ['smart-home', 'calendar-time', 'users-group', 'user-star', 'stethoscope', 'dots-circle-horizontal', 'mail-opened', 'map-pin', 'adjustments'],
  simples: ['home-2', 'calendar', 'user-shield', 'users', 'first-aid-kit', 'menu-2', 'send', 'map', 'settings-2'],
  tablero: ['layout-dashboard', 'clock-hour-4', 'id-badge-2', 'school', 'heart-plus', 'apps', 'mail-forward', 'compass', 'lock'],
  rellenos: ['home-filled', 'calendar-filled', 'user-filled', 'mood-kid-filled', 'heart-filled', 'layout-grid-filled', 'mail-filled', 'map-pin-filled', 'settings-filled'],
  comunidad: ['building-community', 'calendar-star', 'user-check', 'mood-happy', 'heart-handshake', 'category', 'message-2', 'route', 'key']
};
const NAV_ORDER = ['inicio', 'agenda', 'consejeros', 'participantes', 'salud', 'mas', 'obispos', 'mapa', 'accesos'];
const tabIco = (t) => (NAV_SETS[document.documentElement.getAttribute('data-navico')] || NAV_SETS.clasicos)[NAV_ORDER.indexOf(t)] || 'circle';
const DESIGN_OPTS = {
  palette: { title: 'Paleta de colores', opts: [
    ['institucional', 'Institucional', 'Azul marino (la original)', ['#1F3864', '#DCE5F5', '#F4F6FA']],
    ['constelacion', 'Constelación', 'Índigo y celeste, como el logo', ['#14205C', '#38BDF8', '#DBF0FF']],
    ['violeta', 'Noche violeta', 'Violeta profundo', ['#3B1D6E', '#7C5AC9', '#ECE4FB']],
    ['clara', 'Clara y suave', 'Azul vivo y fondo claro', ['#2563EB', '#93C5FD', '#FAFBFD']],
    ['bosque', 'Bosque', 'Verde profundo y natural', ['#1F5135', '#4CA36B', '#EEF6F0']],
    ['oceano', 'Océano', 'Turquesa y azul petróleo', ['#0E4C5A', '#14B8A6', '#ECF8F8']],
    ['vino', 'Vino', 'Bordó elegante', ['#6B1D2F', '#B4475E', '#FBF1F3']],
    ['atardecer', 'Atardecer', 'Terracota cálido', ['#8A3B12', '#E07A3E', '#FDF4EC']],
    ['dorado', 'Azul y dorado', 'Marino con detalles dorados', ['#1B2A4A', '#C9A227', '#F7F5EE']],
    ['grafito', 'Grafito', 'Gris sobrio y neutro', ['#2B2F36', '#6B7280', '#F4F5F7']]] },
  icons: { title: 'Íconos', opts: [
    ['linea', 'De línea', 'Finos y simples (los originales)'],
    ['circulo', 'En círculo', 'Dentro de un círculo suave'],
    ['solido', 'Círculo sólido', 'Ícono blanco sobre color'],
    ['brillo', 'Con brillo', 'Celeste luminoso, estilo constelación'],
    ['cuadro', 'En cuadrito', 'Dentro de un cuadrado redondeado suave'],
    ['cuadro-solido', 'Cuadrito sólido', 'Ícono blanco en cuadrado de color'],
    ['contorno', 'Con aro', 'Rodeados por un círculo fino'],
    ['color', 'De color', 'De línea, en el color de la paleta'],
    ['degrade', 'Degradé', 'Círculo con degradé de color'],
    ['grandes', 'Grandes', 'De línea, más grandes y fáciles de tocar']] },
  btn: { title: 'Botones', opts: [
    ['redondeado', 'Redondeados', 'Esquinas suaves (los originales)'],
    ['pildora', 'Píldora', 'Totalmente redondos'],
    ['recto', 'Rectos', 'Sobrios, esquinas casi rectas'],
    ['relieve', 'Con relieve', 'Sombra suave y degradé'],
    ['contorno', 'Contorno', 'El principal con borde y sin relleno'],
    ['suave', 'Tonales', 'Relleno suave del color de la paleta'],
    ['degrade', 'Degradé', 'Píldora con degradé de color'],
    ['grandes', 'Grandes', 'Más altos y fáciles de tocar'],
    ['mayus', 'Mayúsculas', 'Texto en mayúsculas, estilo formal'],
    ['minimal', 'Mínimos', 'Los secundarios solo con texto']] },
  nav: { title: 'Barra de abajo', opts: [
    ['estilo8', 'Clásica', 'La activa se expande con su nombre'],
    ['flotante', 'Flotante', 'Separada del borde, con esquinas redondas'],
    ['centro', 'Botón central', 'El del medio, grande y destacado'],
    ['etiquetas', 'Con nombres', 'Ícono y nombre debajo, en todos'],
    ['iconos', 'Solo íconos', 'Sin nombres, más limpia'],
    ['linea', 'Línea arriba', 'Una raya marca la pestaña activa'],
    ['punto', 'Con punto', 'Un puntito debajo de la activa'],
    ['color', 'De color', 'Barra del color de la paleta'],
    ['flotante-color', 'Flotante de color', 'Separada del borde y de color'],
    ['cuadrada', 'Cuadrada', 'Pestaña activa con esquinas rectas']] },
  cards: { title: 'Tarjetas', opts: [
    ['sombra', 'Con sombra', 'Sombra suave (las originales)'],
    ['borde', 'Planas con borde', 'Sin sombra, con línea fina'],
    ['vidrio', 'Vidrio', 'Translúcidas sobre fondo de color'],
    ['redondas', 'Muy redondeadas', 'Esquinas bien suaves'],
    ['rectas', 'Rectas', 'Esquinas casi rectas'],
    ['franja', 'Franja lateral', 'Una línea de color a la izquierda'],
    ['franja-arriba', 'Franja superior', 'Una línea de color arriba'],
    ['elevadas', 'Elevadas', 'Sombra marcada, parecen flotar'],
    ['tonales', 'Tonales', 'Fondo levemente teñido de color'],
    ['contorno', 'Borde de color', 'Línea fina del color de la paleta']] },
  font: { title: 'Tipografía', opts: [
    ['sistema', 'Del sistema', 'La del celular (la original)'],
    ['nunito', 'Nunito', 'Redondeada y amigable'],
    ['poppins', 'Poppins', 'Moderna y geométrica'],
    ['inter', 'Inter', 'Clara y profesional'],
    ['roboto', 'Roboto', 'La clásica de Android'],
    ['montserrat', 'Montserrat', 'Elegante, de títulos'],
    ['lato', 'Lato', 'Cálida y legible'],
    ['opensans', 'Open Sans', 'Neutra y muy legible'],
    ['quicksand', 'Quicksand', 'Redonda y liviana'],
    ['merriweather', 'Merriweather', 'Con serifa, estilo libro']] },
  navico: { title: 'Dibujos de la barra de abajo', opts: [
    ['clasicos', 'Clásicos', 'Los primeros'],
    ['modernos', 'Modernos', 'Casa inteligente, estetoscopio'],
    ['simples', 'Simples', 'Trazos básicos y claros'],
    ['tablero', 'Tablero', 'Estilo panel de control'],
    ['comunidad', 'Comunidad', 'Más cálidos y cercanos'],
    ['rellenos', 'Rellenos', 'Sólidos, como la hoja de íconos (los elegidos)']] }
};
const FONT_URL = { nunito: 'Nunito:wght@400;600;700;800', poppins: 'Poppins:wght@400;500;600;700', inter: 'Inter:wght@400;500;600;700;800',
  roboto: 'Roboto:wght@400;500;700', montserrat: 'Montserrat:wght@400;500;600;700', lato: 'Lato:wght@400;700', opensans: 'Open+Sans:wght@400;600;700',
  quicksand: 'Quicksand:wght@400;500;600;700', merriweather: 'Merriweather:wght@400;700' };
let designSaved = { ...DESIGN_DEFAULT };
function applyDesign(d) {
  const h = document.documentElement;
  Object.keys(DESIGN_DEFAULT).forEach((k) => h.setAttribute('data-' + k, d[k] || DESIGN_DEFAULT[k]));
  const f = d.font;
  if (FONT_URL[f] && !document.getElementById('font-' + f)) {
    const l = document.createElement('link'); l.id = 'font-' + f; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${FONT_URL[f]}&display=swap`; document.head.appendChild(l);
  }
}
try { designSaved = { ...DESIGN_DEFAULT, ...JSON.parse(localStorage.getItem(DESIGN_KEY) || '{}') }; } catch { /* nada */ }
applyDesign(designSaved);

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
  if (/Error sending (confirmation|magic link|recovery)? ?email/i.test(m)) return 'No se pudo enviar el correo con el código. Avisale a la coordinación (falla en el envío de correos).';
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
    ...(tipo === 'Consejero' ? { [S.markLabel]: p.mark || '' } : {}), Provincia: p.prov, Apellido: p.last, Nombre: p.first, 'Barrio / Rama': p.ward,
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
  S.day1 = ((st.data || []).find((x) => x.key === 'session_day1') || {}).value || null;
  S.vapid = ((st.data || []).find((x) => x.key === 'vapid_public') || {}).value || null;
  if (S.vapid) pushSubscribe(false);
  const dz = (st.data || []).find((x) => x.key === 'design4');  if (dz && dz.value && !designPreviewing) { try { designSaved = { ...DESIGN_DEFAULT, ...JSON.parse(dz.value) }; localStorage.setItem(DESIGN_KEY, JSON.stringify(designSaved)); applyDesign(designSaved); } catch { /* nada */ } }
  // Agenda, avisos y mapa (si la base todavía no tiene esas tablas, la app sigue funcionando)
  const [sc, no, pl] = await Promise.all([
    sb.from('schedule').select('*').order('day').order('sort'),
    sb.from('notices').select('*').order('created_at', { ascending: false }),
    sb.from('places').select('*').order('name')
  ]);
  S.extrasOk = !sc.error && !no.error && !pl.error;
  S.schedule = sc.data || []; S.notices = no.data || []; S.places = pl.data || [];
  const rd = await sb.from('notice_reads').select('notice_id,email,read_at');
  S.reads = rd.error ? [] : rd.data || [];
  await loadCompanies();
  saveOfflineCopy();
  if (can.bishopMark(S.role)) {
    const { data } = await sb.from('bishop_marks').select('bishop_key,value');
    S.bishopMarks = Object.fromEntries((data || []).map((x) => [x.bishop_key, x.value]));
  }
  if (S.role === 'dueno') await loadAccess();
}
async function loadCompanies() {
  if (!can.companies(S.role)) { S.companies = []; S.members = {}; return; }
  const [c, m] = await Promise.all([sb.from('companies').select('*').order('name'), sb.from('company_members').select('company_id,person_id')]);
  S.companies = c.error ? [] : c.data || [];
  S.members = Object.fromEntries((m.error ? [] : m.data || []).map((x) => [x.person_id, x.company_id]));
  S.myCompanies = [];
  if (['consejero', 'coord_auxiliar'].includes(S.role)) { const r = await sb.rpc('my_company_ids'); S.myCompanies = r.data || []; }
}
const companyName = (id) => (S.companies.find((c) => c.id === id) || {}).name || '';
async function loadAccess() {
  const [u, r] = await Promise.all([
    sb.from('app_users').select('*').order('created_at'),
    sb.from('access_requests').select('*').order('created_at')
  ]);
  S.users = u.data || []; S.requests = r.data || [];
  const pr = await sb.from('profiles').select('email,terms_at');
  S.terms = Object.fromEntries((pr.error ? [] : pr.data || []).filter((x) => x.terms_at).map((x) => [x.email, x.terms_at]));
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
    if (S.role) { await loadData(); S.offline = false; await checkTerms(); UI.tab = null; UI.sub = null; startLive(); startReminders(); } // al entrar, siempre la primera pantalla (Inicio)
  } catch (e) {
    console.error(e);
    // Sin conexión: mostrar la última agenda guardada en este celular (sin datos de personas).
    if (!navigator.onLine || /Failed to fetch|NetworkError/i.test(String(e && e.message))) {
      if (loadOfflineCopy()) { S.offline = true; UI.tab = 'agenda'; startReminders(); }
    } else toast(errMsg(e));
  }
  render();
}

/* ---------- copia sin conexión de la agenda (solo horario, avisos y lugares; nada de datos personales) ---------- */
const OFF_KEY = 'pfj-agenda-offline';
function saveOfflineCopy() {
  try { localStorage.setItem(OFF_KEY, JSON.stringify({ email: S.email, role: S.role, day1: S.day1, schedule: S.schedule.map(({ updated_by, ...r }) => r), notices: S.notices.map((n) => ({ id: n.id, body: n.body, important: n.important, created_at: n.created_at })), places: S.places, at: Date.now() })); } catch { /* sin espacio */ }
}
function loadOfflineCopy() {
  try {
    const c = JSON.parse(localStorage.getItem(OFF_KEY) || 'null');
    if (!c || !c.role) return false;
    Object.assign(S, { email: S.email || c.email, role: c.role, day1: c.day1, schedule: c.schedule || [], notices: c.notices || [], places: c.places || [], extrasOk: true });
    return true;
  } catch { return false; }
}
window.addEventListener('online', () => { if (S.offline) boot(); });

/* ---------- cambios en vivo ---------- */
let liveChannel = null;
function startLive() {
  if (liveChannel) return;
  liveChannel = sb.channel('pfj-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule' }, () => liveRefresh('schedule'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, () => liveRefresh('notices'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, () => liveRefresh('incidents'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'headcounts' }, () => liveRefresh('headcounts'))
    .subscribe();
}
let liveTimer = null;
function liveRefresh(what) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    if (what === 'schedule') { const { data } = await sb.from('schedule').select('*').order('day').order('sort'); if (data) S.schedule = data; toast('La agenda se actualizó'); }
    if (what === 'notices') { const { data } = await sb.from('notices').select('*').order('created_at', { ascending: false }); if (data) { const nuevo = data.length > S.notices.length; S.notices = data; if (nuevo) { toast('Nuevo aviso de la coordinación'); notify('Nuevo aviso de la coordinación', data[0]?.body || ''); } } }
    if (what === 'incidents' && can.health(S.role)) { toast('Hay novedades en Incidentes'); notify('PFJ · Incidentes', 'Se registró o actualizó un incidente.'); }
    saveOfflineCopy();
    const formOpen = document.querySelector('#evf, #pf, #incf, #hcf, #hlf');
    if (!formOpen && (['agenda', 'inicio'].includes(UI.tab) || (UI.tab === 'mas' && ['incidentes', 'recuentos'].includes(UI.sub)))) render();
  }, 600);
}

/* ---------- recordatorios 10 minutos antes (mientras la app está abierta o en segundo plano) ---------- */
const REM_KEY = 'pfj-recordatorios';
let remTimer = null; const remSent = new Set();
function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem(REM_KEY) !== '1') return;
  const opts = { body, icon: 'icon.svg', badge: 'icon.svg', tag: title + body };
  navigator.serviceWorker?.getRegistration().then((r) => (r ? r.showNotification(title, opts) : new Notification(title, opts))).catch(() => {});
}
function startReminders() {
  clearInterval(remTimer);
  const tick = () => {
    if (localStorage.getItem(REM_KEY) !== '1') return;
    const today = todayDayNumber(); if (today === null) return;
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    const myCol = ROLE_COL[S.role];
    S.schedule.filter((r) => r.day === today && (!myCol || (r[myCol] && r[myCol] !== '—'))).forEach((r) => {
      const s = toMin(r.start_time); if (s === null) return;
      const key = `${today}|${r.id}`;
      if (s - nowMin <= 10 && s - nowMin >= 0 && !remSent.has(key)) { remSent.add(key); notify(`En ${s - nowMin} min: ${r.title}`, [r.start_time, r.place].filter(Boolean).join(' · ')); }
    });
  };
  tick(); remTimer = setInterval(tick, 60000);
}

function render() {
  const app = $('#app');
  if (!S.email) return renderLogin(app);
  if (!S.role) return renderNoRole(app);
  if (S.needsTerms) return renderTerms(app);
  renderShell(app);
}

function authCard(inner) {
  return `<div class="auth"><div class="auth-card"><img src="icon.svg" alt=""><h1>PFJ Coordinación</h1>${inner}
    <div class="auth-foot"><button type="button" class="linkbtn" data-priv>Aviso de privacidad</button></div></div></div>`;
}

/* ---------- aviso de privacidad (Ley 25.326) y compromiso de confidencialidad ---------- */
function privacyHTML() {
  const mail = esc(OWNER);
  return `<div class="legal">
    <p><b>Responsable de los datos:</b> Daiana, coordinación de PFJ 2027. Contacto: <a href="mailto:${mail}">${mail}</a>.</p>
    <p><b>Qué datos hay:</b> los de la inscripción a PFJ (nombre, edad, unidad, teléfono, correo, contactos de emergencia e información médica y alimentaria), los registros de salud, incidentes y recuentos del evento, y del personal: correo, nombre, teléfono y función.</p>
    <p><b>Para qué se usan:</b> solo para organizar PFJ 2027 y cuidar a los participantes. No se usan para otra cosa, no se venden y no se comparten con nadie fuera del personal del evento.</p>
    <p><b>Quién los ve:</b> cada persona del personal ve solo lo que necesita para su tarea. Por ejemplo, cocina ve dietas pero no datos médicos, y cada consejero ve solo a los jóvenes de su compañía. El acceso lo aprueba la coordinación y se puede quitar en cualquier momento.</p>
    <p><b>Dónde se guardan:</b> en una base de datos de Supabase con conexión cifrada, cuyos servidores pueden estar fuera de Argentina. Los códigos de ingreso se envían por Gmail.</p>
    <p><b>Cuánto tiempo:</b> los datos se borran dentro de los 30 días posteriores al fin del evento.</p>
    <p><b>Tus derechos:</b> podés pedir ver, corregir, actualizar o borrar tus datos escribiendo al correo de contacto. El acceso es gratuito cada seis meses.</p>
    <p class="note">La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.</p>
  </div>`;
}
const TERMS_HTML = `<div class="legal">
  <p>Esta app tiene datos personales de jóvenes y adultos, incluidos datos de salud. Al continuar, me comprometo a:</p>
  <ul>
    <li>Usar los datos solo para mi tarea en PFJ 2027.</li>
    <li>No copiarlos, sacarles captura, reenviarlos ni compartirlos con nadie que no tenga acceso a la app.</li>
    <li>No dejar mi sesión abierta en un celular que usen otras personas.</li>
    <li>Avisar enseguida a la coordinación si pierdo el celular o si creo que alguien vio datos que no debía.</li>
    <li>Guardar el secreto también después del evento (Ley 25.326, art. 10).</li>
  </ul></div>`;
function openPrivacy() {
  if ($('#priv-ov')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="priv-ov" class="ov" role="dialog" aria-modal="true" aria-label="Aviso de privacidad">
    <div class="ov-card"><h2 class="page" style="margin-top:0">Aviso de privacidad</h2>${privacyHTML()}
    <button class="btn btn-block btn-primary" id="priv-close">Cerrar</button></div></div>`);
  const ov = $('#priv-ov');
  ov.onclick = (e) => { if (e.target === ov || e.target.id === 'priv-close') ov.remove(); };
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-priv]')) { e.preventDefault(); openPrivacy(); } });
function renderPrivacy(main) {
  main.innerHTML = `<h2 class="page">Privacidad</h2>${privacyHTML()}
    <h3 style="margin:18px 0 6px">Compromiso de confidencialidad del personal</h3>${TERMS_HTML}`;
}
// ¿Falta aceptar el compromiso? (la dueña no lo necesita; si la base todavía no lo tiene, no se pide)
async function checkTerms() {
  S.needsTerms = false;
  if (!S.role || S.role === 'dueno' || S.offline) return;
  const { data, error } = await sb.from('profiles').select('terms_at').eq('email', S.email).maybeSingle();
  if (!error) S.needsTerms = !(data && data.terms_at);
}
function renderTerms(app) {
  app.innerHTML = `<div class="auth"><div class="auth-card auth-wide"><img src="icon.svg" alt=""><h1>Compromiso de confidencialidad</h1>
    ${TERMS_HTML}
    <label class="chk"><input type="checkbox" id="t-ok"> Leí y acepto el compromiso</label>
    <button class="btn btn-block btn-primary" id="t-go" disabled>Aceptar y entrar</button>
    <button class="btn btn-block" id="t-out">Salir</button>
    <div class="auth-foot"><button type="button" class="linkbtn" data-priv>Aviso de privacidad</button></div></div></div>`;
  $('#t-ok').onchange = (e) => { $('#t-go').disabled = !e.target.checked; };
  $('#t-out').onclick = logout;
  $('#t-go').onclick = async () => {
    $('#t-go').disabled = true;
    const { error } = await sb.from('profiles').upsert({ email: S.email, terms_at: new Date().toISOString() });
    if (error) { $('#t-go').disabled = false; return toast(errMsg(error)); }
    S.needsTerms = false; render();
  };
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
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
  clearInterval(remTimer);
  try { localStorage.removeItem(OFF_KEY); localStorage.removeItem(MAP_KEY); } catch { /* nada */ }
  // Este celular deja de recibir los avisos de esta cuenta.
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = reg && (await reg.pushManager?.getSubscription());
    if (sub) { await sb.from('push_subs').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch { /* nada */ }
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
  inicio: { label: 'Inicio', ico: 'home' },
  consejeros: { label: 'Consejeros', ico: 'users' },
  participantes: { label: 'Participantes', ico: 'mood-kid' },
  obispos: { label: 'Obispos', ico: 'mail' },
  salud: { label: 'Salud', ico: 'heartbeat' },
  agenda: { label: 'Agenda', ico: 'calendar-event' },
  mapa: { label: 'Mapa', ico: 'map-2' },
  mas: { label: 'Más', ico: 'layout-grid' },
  accesos: { label: 'Accesos', ico: 'settings' }
};

function renderShell(app) {
  const tabs = TABS_BY_ROLE[S.role] || [];
  if (!tabs.includes(UI.tab) && !(UI.tab === 'accesos' && S.role === 'dueno')) UI.tab = tabs[0];
  const label = (t) => (t === 'salud' && S.role === 'cocina' ? 'Dietas' : TAB_INFO[t].label);
  app.innerHTML = `
    <header class="topbar">
      <img src="icon.svg" alt="">
      <div class="title">PFJ Coordinación</div>
      ${S.role === 'dueno' ? '' : `<div class="user"><span>${esc(roleName(S.role))}</span></div>`}
      <button id="theme" title="${isDark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}" aria-label="${isDark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}"><i class="ti ti-${isDark() ? 'sun' : 'moon'}"></i></button>
      <button id="ref" title="Actualizar datos" aria-label="Actualizar datos"><i class="ti ti-refresh"></i></button>
      ${S.role === 'dueno' ? `<button id="acc" class="${UI.tab === 'accesos' ? 'on' : ''}" title="Accesos y ajustes" aria-label="Accesos y ajustes" style="position:relative"><i class="ti ti-settings"></i>${S.requests.length ? `<span class="dot" style="position:absolute;top:-4px;right:-4px">${S.requests.length}</span>` : ''}</button>` : ''}
      <button id="logout" title="Salir" aria-label="Salir"><i class="ti ti-logout"></i></button>
    </header>
    <nav class="tabs">${tabs.map((t, i) => `<button data-tab="${t}" class="${UI.tab === t ? 'active' : ''}${i === Math.floor(tabs.length / 2) ? ' mid' : ''}" aria-label="${label(t)}" title="${label(t)}"><i class="ti ti-${t === 'salud' && S.role === 'cocina' ? 'tools-kitchen-2' : tabIco(t)}"></i><span class="lbl">${label(t)}</span></button>`).join('')}</nav>
    ${S.role === 'dueno' && S.requests.length && UI.tab !== 'accesos' ? `<div class="reqbar">🔔 ${plural(S.requests.length, 'solicitud de acceso pendiente', 'solicitudes de acceso pendientes')} <button class="btn btn-sm" id="goreq">Revisar</button></div>` : ''}
    <main id="main"></main>`;
  $('#logout').onclick = logout;
  $('#theme').onclick = toggleTheme;
  $('#ref').onclick = () => refresh();
  if ($('#goreq')) $('#goreq').onclick = () => { UI.tab = 'accesos'; saveUI(); render(); };
  if ($('#acc')) $('#acc').onclick = () => { UI.tab = UI.tab === 'accesos' ? tabs[0] : 'accesos'; saveUI(); render(); window.scrollTo(0, 0); };
  app.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { UI.tab = b.dataset.tab; UI.sub = null; coState.ficha = null; saveUI(); render(); window.scrollTo(0, 0); }));
  const main = $('#main');
  if (UI.tab === 'accesos') return renderAccess(main);
  if (UI.tab === 'agenda') return renderAgenda(main);
  if (UI.tab === 'mapa') return renderMap(main);
  if (UI.tab === 'mas') return renderMore(main);
  if (S.offline) return renderAgenda(main);
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
  renderHomeInner(main);
  $('.stats', main)?.insertAdjacentHTML('beforebegin', nowNextCard() + remindersPanel());
}
function renderHomeInner(main) {
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
  const seeC = can.seeCons(S.role), yn = can.mark(S.role);
  main.innerHTML = `
    <h2 class="page">Resumen</h2>
    <p class="sub">Datos en línea · los cambios de todo el equipo se ven al actualizar (⟳)</p>
    <div class="stats">
      ${seeC ? `<div class="stat"><div class="k">Consejeros</div><div class="v">${C.length}</div><div class="d">${yn ? `${esc(S.markLabel)}: ${mk(C, 'Sí')} sí · ${mk(C, 'No')} no` : 'inscriptos'}</div></div>` : ''}
      <div class="stat"><div class="k">Participantes</div><div class="v">${P.length}</div><div class="d">inscriptos</div></div>
      ${showEstado ? `<div class="stat warn"><div class="k">Sin aprobar</div><div class="v">${pend}</div><div class="d">pendientes o en espera</div></div>` : ''}
      ${bishops.length ? `<div class="stat"><div class="k">Obispos avisados</div><div class="v">${bDone}/${bishops.length}</div><div class="d">con inscripciones sin aprobar</div></div>` : ''}
      ${C.some((p) => has(p.training)) ? `<div class="stat bad"><div class="k">Sin capacitación</div><div class="v">${noTraining}</div><div class="d">consejeros (protección)</div></div>` : ''}
      <div class="stat warn"><div class="k">Salud / dieta</div><div class="v">${health}</div><div class="d">personas a tener en cuenta</div></div>
    </div>
    <div class="panel"><h3>Por provincia</h3>
      <table class="t"><thead><tr><th>Provincia</th>${seeC ? '<th>Consejeros</th>' : ''}${yn ? `<th>Consejeros · ${esc(S.markLabel)} Sí</th><th>Consejeros · No</th><th>Consejeros · sin responder</th>` : ''}<th>Participantes</th><th>Total</th></tr></thead>
      <tbody>${provs.map((pr) => {
        const l = all.filter((p) => p.prov === pr), lc = l.filter((p) => p.tipo === 'Consejero'), y = mk(lc, 'Sí'), n = mk(lc, 'No');
        return `<tr><td>${esc(pr)}</td>${seeC ? `<td>${lc.length}</td>` : ''}${yn ? `<td>${y}</td><td>${n}</td><td>${lc.length - y - n}</td>` : ''}<td>${l.length - lc.length}</td><td><b>${l.length}</b></td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td>${seeC ? `<td>${C.length}</td>` : ''}${yn ? `<td>${mk(C, 'Sí')}</td><td>${mk(C, 'No')}</td><td>${C.length - mk(C, 'Sí') - mk(C, 'No')}</td>` : ''}<td>${P.length}</td><td>${all.length}</td></tr></tfoot></table>
    </div>
    <div class="toolbar tb-end">${can.export(S.role) ? '<button class="btn btn-ic" id="exp" aria-label="Exportar a Excel" title="Exportar a Excel"><i class="ti ti-file-spreadsheet"></i></button>' : ''}<button class="btn btn-ic" id="prn" aria-label="Imprimir" title="Imprimir"><i class="ti ti-printer"></i></button></div>`;
  if ($('#exp')) $('#exp').onclick = exportExcel;
  $('#prn').onclick = () => window.print();
}

/* ---------- Listas ---------- */
const listState = { q: '', filter: 'todos' };
function renderList(main, tipo) {
  const plur = tipo === 'Consejero' ? 'Consejeros' : 'Participantes';
  // La casilla Sí / No es solo para los consejeros.
  const markable = can.mark(S.role) && tipo === 'Consejero';
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
    if (e.target.closest('a, .details, .pd')) return;
    const gh = e.target.closest('.group-h');
    if (gh) { const sec = gh.parentElement; UI.open[sec.dataset.g] = sec.classList.contains('closed'); saveUI(); sec.classList.toggle('closed'); return; }
    const row = e.target.closest('.card-row');
    if (row && row.parentElement.dataset.id) { const card = row.parentElement; const d = card.querySelector(':scope > .pd, :scope > .details'); if (d) d.remove(); else card.insertAdjacentHTML('beforeend', personDetails(S.people.find((p) => p.id === card.dataset.id))); }
  };
}

function personCard(p, markable) {
  // Coordinador/a auxiliar: de los consejeros solo el nombre y, a la derecha, llamar y WhatsApp.
  if (S.role === 'coord_auxiliar' && p.tipo === 'Consejero') {
    const t = telLink(p.phone), w = waLink(p.phone);
    return `<article class="card"><div class="card-row hc-line"><div class="name">${esc(p.last)}, ${esc(p.first)}</div><div class="actions">${t ? `<a class="cl" href="${t}" aria-label="Llamar" title="Llamar"><i class="ti ti-phone"></i></a>` : ''}${w ? `<a class="cl" href="${w}" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>` : ''}</div></div></article>`;
  }
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
  if (t) a.push(`<a class="cl" href="${t}" aria-label="Llamar" title="Llamar"><i class="ti ti-phone"></i></a>`);
  if (w) a.push(`<a class="cl" href="${w}" target="_blank" rel="noopener" aria-label="WhatsApp" title="WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>`);
  if (email) a.push(`<a class="cl" href="mailto:${esc(email)}" aria-label="Correo" title="Correo"><i class="ti ti-mail"></i></a>`);
  return a.length ? `<div class="actions">${a.join('')}</div>` : '';
}
function personDetails(p) {
  // En cuadros: contacto personal, estaca y contactos de emergencia.
  const boxes = [];
  if (has(p.phone) || has(p.email)) boxes.push(`<div><div class="k">Contacto personal</div>${esc(p.phone || '')}${p.email ? '<br>' + esc(p.email) : ''}${contactLinks(p.phone, p.email)}</div>`);
  if (has(p.stake)) boxes.push(`<div><div class="k">Estaca / Distrito</div>${esc(p.stake)}${p.ward ? `<br><span class="note">${esc(p.ward)}</span>` : ''}</div>`);
  if (has(p.c1n) || has(p.c1t)) boxes.push(`<div><div class="k">Contacto de emergencia 1</div>${esc(p.c1n || '')}${p.c1t ? '<br>' + esc(p.c1t) : ''}${contactLinks(p.c1t, p.c1e)}</div>`);
  if (has(p.c2n) || has(p.c2t)) boxes.push(`<div><div class="k">Contacto de emergencia 2</div>${esc(p.c2n || '')}${p.c2t ? '<br>' + esc(p.c2t) : ''}${contactLinks(p.c2t, p.c2e)}</div>`);
  // En lista, fuera de los cuadros: información médica y alimentaria primero, y después el resto.
  const li = (k, v, hl) => (has(v) ? `<div class="dl-row"><div class="k">${k}</div><div class="${hl ? 'hl' : ''}">${esc(v)}</div></div>` : '');
  const main = [li('Información médica', p.med, p.med_flag), li('Información alimentaria', p.food, p.food_flag)].filter(Boolean);
  const more = [
    li('Nombre preferido', p.pref),
    has(p.bishop) ? li('Obispo / Presidente', `${p.bishop}${p.bishop_e ? ' · ' + p.bishop_e : ''}`) : '',
    p.tipo === 'Consejero' ? li('Capacitación de protección', p.training, p.training === 'No') : li('Miembro de la Iglesia', p.member),
    li('Fecha de nacimiento', p.birth), li('Compromiso de salida', p.commit), li('Inscripción', p.reg), li('Observaciones', p.obs, true)
  ].filter(Boolean);
  if (!boxes.length && !main.length && !more.length) return '<div class="details"><div class="note">Tu rol no tiene más datos para ver de esta persona.</div></div>';
  // "Más": la información secundaria queda plegada debajo de la médica y la alimentaria.
  const moreHtml = more.length ? `<details class="dl-more"><summary><span>Más</span><i class="ti ti-chevron-down"></i></summary>${more.join('')}</details>` : '';
  return `<div class="pd">${boxes.length ? `<div class="details boxes">${boxes.join('')}</div>` : ''}${main.length || moreHtml ? `<div class="dl">${main.join('')}${moreHtml}</div>` : ''}</div>`;
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
          ${byTipo(list, (p) => `<div class="row-item"><div class="grow"><b>${esc(p.last)}, ${esc(p.first)}</b><div class="note">${esc(p.ward || 'Sin barrio')} · ${esc(p.prov)}</div></div>${estadoBadge(p.estado)}${contactLinks(p.phone, '')}</div>`)}
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

/* Separa siempre consejeros y participantes, aunque estén en la misma pestaña. */
function byTipo(list, rowFn, wrapClass) {
  return [['Consejero', 'Consejeros', 'users'], ['Participante', 'Participantes', 'mood-kid']].map(([tipo, titulo, ico]) => {
    const l = list.filter((p) => p.tipo === tipo);
    if (!l.length) return '';
    return `<div class="tipo-h"><i class="ti ti-${ico}"></i>${titulo}<span class="n">${l.length}</span></div>
      <div class="${wrapClass || 'tipo-b'}">${l.map(rowFn).join('')}</div>`;
  }).join('');
}

/* ---------- Salud / Dietas ---------- */
function renderHealth(main) {
  // Coordinador/a auxiliar: Salud solo de los jóvenes de su compañía asignada.
  if (S.role === 'coord_auxiliar' && !S.companiesLoaded) { main.innerHTML = '<p class="note">Cargando…</p>'; loadCompanies().then(() => { S.companiesLoaded = true; renderHealth(main); }); return; }
  const auxOnly = S.role === 'coord_auxiliar';
  const people = auxOnly ? S.people.filter((p) => p.tipo === 'Participante' && (S.myCompanies || []).includes(S.members[p.id])) : S.people;
  const kitchen = S.role === 'cocina';
  const logger = can.healthLog(S.role), owner = can.owner(S.role);
  const flagged = (p) => (kitchen ? p.food_flag : p.med_flag || p.food_flag);
  const filters = kitchen ? [['todos', 'Todos']] : [['todos', 'Con indicaciones'], ['med', 'Médico'], ['food', 'Dieta'], ...(logger ? [['all', 'Todas las personas']] : [])];
  if (!filters.some(([k]) => k === healthState.filter)) healthState.filter = 'todos';
  const nFlag = people.filter(flagged).length;
  main.innerHTML = `
    <h2 class="page">${kitchen ? 'Dietas especiales' : 'Salud y alimentación'}</h2>
    <p class="sub">${plural(nFlag, 'persona', 'personas')} ${kitchen ? 'con indicaciones de alimentación.' : 'con información médica o alimentaria a tener en cuenta.'}</p>
    ${owner ? '<div id="hl-pend"></div>' : ''}
    <div class="toolbar">
      <input class="input" id="hq" type="search" placeholder="Buscar nombre, alergia, medicamento, comida…" value="${esc(healthState.q)}">
      <button class="btn btn-ic" id="prn" aria-label="Imprimir" title="Imprimir"><i class="ti ti-printer"></i></button>
    </div>
    ${filters.length > 1 ? `<div class="toolbar chips" id="hf">${filters.map(([k, l]) => `<button class="chip ${healthState.filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>` : ''}
    ${logger ? `<div class="panel" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0;flex:1"><i class="ti ti-user-plus"></i> Personas fuera de la lista</h3><button class="btn btn-sm" id="hl-add"><i class="ti ti-plus"></i> Agregar</button></div>
      <p class="note" style="margin:4px 0 0">Para registrar a alguien que no aparece en la lista (personal, visitas u otros casos).</p>
      <div id="hl-other"></div></div>` : ''}
    <div id="hlist"></div>`;

  const logRow = (h) => `<div class="hl-row ${h.delete_requested_at ? 'pend' : ''}">
      <div><b>${esc(h.kind)}</b> · ${fmtWhen(h.created_at)}${h.person_name ? ' · <b>' + esc(h.person_name) + '</b>' : ''}<br>${esc(h.note || '')} <span class="note">(${esc(h.created_by || '')})</span>
        ${h.delete_requested_at ? `<br><span class="badge pend">Eliminación pendiente</span> <span class="note">pedida por ${esc(h.delete_requested_by || '')}</span>` : ''}</div>
      <div class="hl-act">${owner ? `<button class="linkbtn" data-hledit="${h.id}" aria-label="Editar"><i class="ti ti-pencil"></i></button><button class="linkbtn" data-hldel="${h.id}" aria-label="Borrar"><i class="ti ti-trash"></i></button>`
        : !h.delete_requested_at ? `<button class="linkbtn" data-hlreq="${h.id}" title="Pedir que se borre" aria-label="Pedir que se borre"><i class="ti ti-trash"></i></button>` : ''}</div></div>`;
  const logForm = (withName) => `<form class="hlf ev-edit" style="margin:8px 0">
      ${withName ? '<label>Nombre de la persona<input class="input" name="pn" maxlength="80" required placeholder="Ej.: Juan Pérez (cocina)"></label>' : ''}
      <div class="form-inline" style="margin:0"><select class="input" name="k" style="flex:0 1 150px"><option>Medicación</option><option>Consulta</option></select>
        <input class="input" name="n" maxlength="500" placeholder="Ej.: Allegra 120 mg 8:00 · dolor de cabeza" required>
        <button class="btn btn-sm btn-primary">Registrar</button></div></form>`;

  const draw = () => {
    const q = norm(healthState.q);
    const l = people.filter((p) => (healthState.filter === 'all' ? true : healthState.filter === 'med' ? p.med_flag : healthState.filter === 'food' ? p.food_flag : flagged(p)))
      .filter((p) => !q || norm(`${p.first} ${p.last} ${p.pref || ''} ${p.ward} ${p.prov} ${p.med_flag ? p.med : ''} ${p.food_flag ? p.food : ''}`).includes(q));
    // Tarjeta de salud: encabezado, indicaciones resaltadas y, debajo, cuadros apilados (personal arriba, emergencia abajo).
    const row = (k, v, extra = '') => (has(v) ? `<div class="hc-row"><span>${k}</span><div>${esc(v)}${extra}</div></div>` : '');
    // Contacto de emergencia: nombre a la izquierda y los botones a la derecha, en la misma línea (sin mostrar el número).
    const emer = (n, t, e) => (has(n) || has(t) ? `<div class="hc-line"><b>${esc(n || 'Contacto')}</b>${contactLinks(t, e)}</div>` : '');
    $('#hlist', main).innerHTML = byTipo(sorted(l), (p) => {
      const sub = [has(p.age) ? `${p.age} años` : '', p.prov].filter(Boolean).map(esc).join(' · ');
      const info = [p.med_flag && has(p.med) ? `<div class="hc-alert"><div class="k"><i class="ti ti-first-aid-kit"></i> Médico</div>${esc(p.med)}</div>` : '',
        p.food_flag && has(p.food) ? `<div class="hc-alert"><div class="k"><i class="ti ti-tools-kitchen-2"></i> Alimentación</div>${esc(p.food)}</div>` : ''].join('');
      const pers = [row('Estaca / Distrito', p.stake), row('Unidad', p.ward)].join('');
      const em = [emer(p.c1n, p.c1t, p.c1e), emer(p.c2n, p.c2t, p.c2e)].join('');
      return `<div class="card hc">
        <div class="hc-line hc-head"><div><b>${esc(p.last)}, ${esc(p.first)}</b>${sub ? `<div class="note">${sub}</div>` : ''}</div>${contactLinks(p.phone, p.email)}</div>
        ${info ? `<div class="hc-info">${info}</div>` : ''}
        ${em ? `<div class="hc-box"><div class="hc-t"><i class="ti ti-urgent"></i> Contacto de emergencia</div>${em}</div>` : ''}
        ${pers ? `<details class="hc-box hc-fold"><summary class="hc-t"><i class="ti ti-user"></i> Información personal<i class="ti ti-chevron-down hc-chev"></i></summary>${pers}</details>` : ''}
        ${logger ? `<div class="hc-log"><button class="btn btn-sm" data-hl="${esc(p.id)}"><i class="ti ti-notes"></i> Registro de salud</button><div data-hlbox="${esc(p.id)}"></div></div>` : ''}
      </div>`;
    }, 'list') || `<div class="empty"><div class="big"><i class="ti ti-search"></i></div><p>No hay resultados${q ? ` para «${esc(healthState.q)}»` : ''}.</p></div>`;
  };
  const openPerson = async (pid, box) => {
    const { data, error } = await sb.from('health_logs').select('*').eq('person_id', pid).order('created_at', { ascending: false });
    if (dbMissing(error)) { box.innerHTML = '<p class="note">Falta activar el registro de salud.</p>'; return; }
    box.innerHTML = logForm(false) + `<div>${(data || []).map(logRow).join('') || '<p class="note">Sin registros todavía.</p>'}</div>`;
    box.querySelector('.hlf').onsubmit = async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const { error: err } = await sb.from('health_logs').insert({ person_id: pid, kind: f.k.value, note: clean(f.n.value), created_by: S.email });
      if (err) return toast(errMsg(err));
      toast('Registrado'); openPerson(pid, box);
    };
  };
  const drawOthers = async () => {
    const box = $('#hl-other', main); if (!box) return;
    const { data, error } = await sb.from('health_logs').select('*').is('person_id', null).order('created_at', { ascending: false }).limit(100);
    if (dbMissing(error) || (error && /person_name/.test(error.message))) { box.innerHTML = '<p class="note">Falta activar esta parte (SQL 10).</p>'; return; }
    box.innerHTML = (data || []).map(logRow).join('');
  };
  const drawPending = async () => {
    const box = $('#hl-pend', main); if (!box) return;
    const { data } = await sb.from('health_logs').select('*').not('delete_requested_at', 'is', null).order('delete_requested_at');
    const list = data || [];
    box.innerHTML = list.length ? `<div class="panel" style="padding:12px 16px"><h3 style="margin:0 0 8px"><i class="ti ti-trash"></i> Eliminaciones pendientes (${list.length})</h3>
      ${list.map((h) => { const p = S.people.find((x) => x.id === h.person_id); return `<div class="hl-row pend"><div><b>${esc(p ? `${p.first} ${p.last}` : h.person_name || '')}</b> · ${esc(h.kind)} · ${fmtWhen(h.created_at)}<br>${esc(h.note || '')}<br><span class="note">Pedida por ${esc(h.delete_requested_by || '')}</span></div>
        <div class="hl-act"><button class="btn btn-sm btn-danger" data-hldel="${h.id}">Aceptar</button><button class="btn btn-sm" data-hlkeep="${h.id}">Rechazar</button></div></div>`; }).join('')}</div>` : '';
  };
  draw(); drawOthers(); drawPending();

  main.onclick = async (e) => {
    const t = (sel) => e.target.closest(sel);
    let b;
    if ((b = t('[data-hl]'))) { const box = main.querySelector(`[data-hlbox="${CSS.escape(b.dataset.hl)}"]`); if (box.innerHTML) box.innerHTML = ''; else openPerson(b.dataset.hl, box); return; }
    if ((b = t('#hl-add'))) {
      const box = $('#hl-other', main);
      if (box.querySelector('.hlf')) return;
      box.insertAdjacentHTML('afterbegin', logForm(true));
      box.querySelector('.hlf').onsubmit = async (ev) => {
        ev.preventDefault(); const f = ev.target;
        const { error: err } = await sb.from('health_logs').insert({ person_id: null, person_name: clean(f.pn.value), kind: f.k.value, note: clean(f.n.value), created_by: S.email });
        if (err) return toast(errMsg(err));
        toast('Registrado'); drawOthers();
      };
      return;
    }
    const refreshAll = () => { draw(); drawOthers(); drawPending(); };
    if ((b = t('[data-hlreq]'))) {
      if (!confirm('¿Pedir que se borre este registro? La dueña tiene que aceptarlo.')) return;
      const { error: err } = await sb.rpc('request_health_delete', { log_id: +b.dataset.hlreq });
      if (err) return toast(errMsg(err));
      toast('Pedido enviado: queda pendiente hasta que la dueña lo acepte'); refreshAll(); return;
    }
    if ((b = t('[data-hldel]'))) {
      if (!confirm('¿Borrar este registro de salud? No se puede deshacer.')) return;
      const { error: err } = await sb.from('health_logs').delete().eq('id', b.dataset.hldel);
      if (err) return toast(errMsg(err));
      toast('Registro borrado'); refreshAll(); return;
    }
    if ((b = t('[data-hlkeep]'))) {
      const { error: err } = await sb.from('health_logs').update({ delete_requested_by: null, delete_requested_at: null }).eq('id', b.dataset.hlkeep);
      if (err) return toast(errMsg(err));
      toast('Se mantiene el registro'); refreshAll(); return;
    }
    if ((b = t('[data-hledit]'))) {
      const { data } = await sb.from('health_logs').select('note').eq('id', b.dataset.hledit).single();
      const v = prompt('Editar la nota del registro:', data?.note || '');
      if (v === null) return;
      const { error: err } = await sb.from('health_logs').update({ note: clean(v) }).eq('id', b.dataset.hledit);
      if (err) return toast(errMsg(err));
      toast('Registro actualizado'); refreshAll();
    }
  };
  $('#hq', main).oninput = (e) => { healthState.q = e.target.value; draw(); };
  if ($('#hf', main)) $('#hf', main).onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; e.stopPropagation(); healthState.filter = b.dataset.f; main.querySelectorAll('#hf .chip').forEach((c) => c.classList.toggle('on', c === b)); draw(); };
  $('#prn').onclick = () => window.print();
}
const healthState = { q: '', filter: 'todos' };

/* ---------- Agenda: avisos + cronograma ---------- */
const ROLE_COL = { consejero: 'cons', coord_auxiliar: 'aux', coordinador: 'coord', matrimonio_director: 'md' };
const COL_NAME = { cons: 'Consejeros', aux: 'Coord. auxiliares', coord: 'Coordinadores', md: 'Matrimonio director' };
const agendaState = { day: null, mine: false, editing: null };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function dayDate(n) {
  if (!S.day1) return null;
  const d = new Date(S.day1 + 'T12:00:00'); d.setDate(d.getDate() + (n - 1)); return d;
}
function dayLabel(n) {
  const d = dayDate(n);
  return d ? `Día ${n} · ${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}` : `Día ${n}`;
}
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };
function todayDayNumber() {
  if (!S.day1) return null;
  const d1 = new Date(S.day1 + 'T00:00:00'), now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((now - d1) / 86400000) + 1;
}

/* «Ahora y lo que sigue»: la actividad en curso y la próxima de hoy (respeta lo del rol si corresponde). */
function nowNextCard() {
  const today = todayDayNumber();
  if (today === null || !S.schedule.length) return '';
  const myCol = ROLE_COL[S.role];
  const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const list = S.schedule.filter((r) => r.day === today && toMin(r.start_time) !== null && (!myCol || (r[myCol] && r[myCol] !== '—')))
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  if (!list.length) return '';
  const cur = list.filter((r) => toMin(r.start_time) <= nowMin && nowMin < (toMin(r.end_time) ?? toMin(r.start_time) + 15));
  const next = list.find((r) => toMin(r.start_time) > nowMin);
  if (!cur.length && !next) return '';
  const item = (r, label, cls) => `<div class="nn-item ${cls}"><div class="nn-k">${label}</div><b>${esc(shortTitle(r.title))}</b><div class="note">${esc(r.start_time)}${r.end_time ? '–' + esc(r.end_time) : ''}${r.place ? ' · <i class="ti ti-map-pin"></i> ' + esc(r.place) : ''}${myCol && r[myCol] ? ' · Vos: ' + esc(r[myCol]) : ''}</div></div>`;
  return `<div class="panel nn">${cur.map((r) => item(r, 'Ahora', 'now')).join('')}${next ? item(next, `Lo que sigue · en ${toMin(next.start_time) - nowMin} min`, '') : ''}</div>`;
}
const ROLE_OPTIONS = () => Object.entries(ROLES);
/* Título de actividad prolijo: la primera parte en negrita y las demás («A | B | C») como renglones secundarios. */
function titleHtml(t) {
  const parts = String(t || '').split(/\s*\|\s*/).filter(Boolean);
  return `<div class="ev-title"><b>${esc(parts[0] || '')}</b>${parts.slice(1).map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
}
const shortTitle = (t) => String(t || '').split(/\s*\|\s*/).filter(Boolean).join(' · ');

/* Panel de recordatorios: estado de la campanita y las próximas actividades de hoy. */
function remindersPanel() {
  const today = todayDayNumber();
  const on = localStorage.getItem(REM_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted';
  const myCol = ROLE_COL[S.role];
  const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
  const next = today === null ? [] : S.schedule.filter((r) => r.day === today && (toMin(r.start_time) ?? -1) > nm && (!myCol || (r[myCol] && r[myCol] !== '—')))
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time)).slice(0, 3);
  const inMin = (r) => { const d = toMin(r.start_time) - nm; return d < 60 ? `en ${d} min` : `en ${Math.floor(d / 60)} h ${d % 60 ? (d % 60) + ' min' : ''}`; };
  return `<div class="panel rem">
    <div class="rem-h"><i class="ti ti-${on ? 'bell-ringing' : 'bell-off'}"></i><b>Recordatorios</b><span class="badge ${on ? 'ok' : ''}">${on ? 'Activados' : 'Desactivados'}</span><span style="flex:1"></span>
      <button class="btn btn-sm ${on ? '' : 'btn-primary'}" data-remtoggle>${on ? 'Desactivar' : 'Activar'}</button></div>
    ${next.length ? `<div class="rem-l">${next.map((r) => `<div><span class="rem-t">${esc(r.start_time)}</span><span class="grow">${esc(shortTitle(r.title))}${r.place ? ` <span class="note">· ${esc(r.place)}</span>` : ''}</span><span class="note">${inMin(r)}</span></div>`).join('')}</div>`
      : `<p class="note" style="margin:6px 0 0">${today === null ? 'Los recordatorios empiezan cuando arranque la conferencia.' : 'No quedan actividades por hoy.'}</p>`}
    <p class="note" style="margin:6px 0 0">${on ? 'Te avisamos 10 minutos antes' + (myCol ? ' de lo que te toca' : '') + '.' : 'Activalos para recibir un aviso 10 minutos antes de cada actividad.'}</p>
  </div>`;
}
async function toggleReminders() {
  const on = localStorage.getItem(REM_KEY) === '1' && Notification.permission === 'granted';
  if (on) { localStorage.setItem(REM_KEY, '0'); toast('Recordatorios desactivados'); return render(); }
  if (!('Notification' in window)) return toast('Este navegador no permite notificaciones');
  const p = await Notification.requestPermission();
  if (p !== 'granted') { toast('Hay que permitir las notificaciones en el navegador'); return render(); }
  localStorage.setItem(REM_KEY, '1'); startReminders(); notify('Recordatorios activados', 'Te avisamos 10 minutos antes de cada actividad.'); render();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-remtoggle]')) toggleReminders(); });

function renderAgenda(main) {
  const editor = can.editEvent(S.role) && !S.offline;
  if (!S.extrasOk) {
    main.innerHTML = `<div class="empty"><div class="big"><i class="ti ti-database-off"></i></div><p>La agenda todavía no está activada en la base de datos.${S.role === 'dueno' ? '<br>Falta ejecutar <b>04_agenda_avisos_mapa.sql</b> en Supabase.' : ''}</p></div>`;
    return;
  }
  const days = [...new Set(S.schedule.map((r) => r.day))].sort((a, b) => a - b);
  const today = todayDayNumber();
  if (agendaState.day === null || (!days.includes(agendaState.day) && days.length)) agendaState.day = days.includes(today) ? today : (days.includes(1) ? 1 : days[0] ?? 1);
  const myCol = ROLE_COL[S.role];
  main.innerHTML = `
    <h2 class="page">Agenda</h2>
    <p class="sub">${S.day1 ? `La conferencia empieza el ${dayDate(1).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}.` : 'Todavía no se cargó la fecha del Día 1.'}</p>
    ${S.offline ? '<div class="callout warn"><i class="ti ti-wifi-off"></i> Sin conexión: estás viendo la última agenda guardada en este celular. Se actualiza sola cuando vuelva la señal.</div>' : ''}
    ${nowNextCard()}
    ${remindersPanel()}
    ${(() => { const n = S.schedule.filter((r) => r.changed_at && Date.now() - new Date(r.changed_at) < 86400000).length; return n ? `<div class="callout"><i class="ti ti-refresh-alert"></i> ${plural(n, 'actividad cambió', 'actividades cambiaron')} en las últimas 24 horas (marcadas con «Cambió»).</div>` : ''; })()}
    <section id="avisos"></section>
    <div class="panel" style="padding:12px 16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <h3 style="margin:0;flex:1"><i class="ti ti-calendar-week"></i> Cronograma</h3>
        ${myCol ? `<label class="chip ${agendaState.mine ? 'on' : ''}" id="mine" style="cursor:pointer"><i class="ti ti-user"></i> Solo lo mío</label>` : ''}
        ${editor ? '<button class="btn btn-sm" id="add-ev"><i class="ti ti-plus"></i> Actividad</button>' : ''}
      </div>
      ${days.length ? `<label class="day-pick"><i class="ti ti-calendar-event"></i><select class="input" id="days" aria-label="Elegir el día">${days.map((d) => `<option value="${d}" ${agendaState.day === d ? 'selected' : ''}>${esc(dayLabel(d))}${d === today ? ' · hoy' : ''}</option>`).join('')}</select><i class="ti ti-chevron-down"></i></label>` : ''}
      <div id="ev-form"></div>
      <div id="evs"></div>
    </div>
    ${S.role === 'dueno' ? `<div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px">Ajustes de la agenda</h3>
      <form class="form-inline" id="d1f"><label class="note" style="align-self:center">Fecha del Día 1</label><input class="input" type="date" id="d1" value="${esc(S.day1 || '')}" style="flex:0 1 200px"><button class="btn">Guardar</button></form>
      <p class="note" style="margin:6px 0 8px">Cargar o reemplazar el cronograma desde un archivo de la carpeta <b>supabase</b> de tu computadora: <b>cronograma_pfj2027.json</b> (horario real con indicaciones del Área) o <b>cronograma_recomendado.json</b> (el del manual):</p>
      <label class="btn btn-sm"><i class="ti ti-upload"></i> Elegir archivo<input type="file" id="sched-file" accept=".json" hidden></label>
    </div>` : ''}`;

  const drawNotices = () => {
    const box = $('#avisos', main);
    const editor = can.postNotice(S.role) && !S.offline; // los avisos tienen su propio permiso
    const readBy = (id) => S.reads.filter((x) => x.notice_id === id);
    const iRead = (id) => readBy(id).some((x) => x.email === S.email);
    const audienceLabel = (a) => (a && a.length ? 'Para: ' + a.map((r) => roleName(r)).join(', ') : 'Para todos');
    box.innerHTML = `<div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px"><i class="ti ti-message-circle-filled"></i> Avisos de la coordinación</h3>
      ${editor ? `<form id="nf" style="display:grid;gap:8px;margin-bottom:12px">
        <textarea class="input" id="nt" rows="2" maxlength="1000" placeholder="Escribí un aviso" required></textarea>
        <details class="note"><summary>Para quién (si no elegís nada, va para todos)</summary>
          <div class="aud">${ROLE_OPTIONS().map(([k, v]) => `<label><input type="checkbox" name="aud" value="${k}"> ${esc(v)}</label>`).join('')}</div></details>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ni"> Importante</label><span style="flex:1"></span><button class="btn btn-primary btn-sm"><i class="ti ti-send"></i> Publicar</button></div>
      </form>` : ''}
      <div class="list">${S.notices.length ? S.notices.map((n) => `<div class="row-item notice ${n.important ? 'imp' : ''} ${!editor && !iRead(n.id) ? 'unread' : ''}">
        <div class="grow">${n.important ? '<span class="badge bad" style="margin-bottom:4px;display:inline-block">Importante</span><br>' : ''}${esc(n.body).replace(/\n/g, '<br>')}
          <div class="note" style="margin-top:4px">${new Date(n.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}${n.created_by ? ' · ' + esc(n.created_by) : ''} · ${esc(audienceLabel(n.audience))}</div>
          ${editor ? `<details class="note"><summary>Leído por ${readBy(n.id).length}</summary>${readBy(n.id).map((x) => esc(x.email)).join('<br>') || 'Nadie todavía'}</details>` : ''}</div>
        ${editor ? `<button class="btn btn-sm btn-danger" data-delnotice="${n.id}" aria-label="Borrar aviso"><i class="ti ti-trash"></i></button>` : ''}</div>`).join('') : '<p class="note" style="margin:0">No hay avisos por ahora.</p>'}</div></div>`;
    // Marca como leídos los avisos que esta persona acaba de ver.
    if (!S.offline) {
      const pend = S.notices.filter((n) => !iRead(n.id));
      if (pend.length) sb.from('notice_reads').upsert(pend.map((n) => ({ notice_id: n.id, email: S.email })), { onConflict: 'notice_id,email', ignoreDuplicates: true })
        .then(({ error }) => { if (!error) pend.forEach((n) => S.reads.push({ notice_id: n.id, email: S.email })); });
    }
    if (editor) {
      $('#nf', box).onsubmit = async (e) => {
        e.preventDefault();
        const body = clean($('#nt', box).value); if (!body) return;
        const aud = [...box.querySelectorAll('input[name="aud"]:checked')].map((x) => x.value);
        const { data: nn, error } = await sb.from('notices').insert({ body, important: $('#ni', box).checked, created_by: S.email, audience: aud.length ? aud : null }).select('id').single();
        if (error) return toast(errMsg(error));
        // Notificación push a los celulares (si está activada en Supabase).
        if (S.vapid) sb.functions.invoke('enviar-aviso', { body: { notice_id: nn.id } }).catch(() => {});
        const { data } = await sb.from('notices').select('*').order('created_at', { ascending: false });
        S.notices = data || []; drawNotices(); toast('Aviso publicado');
      };
      box.onclick = async (e) => {
        const b = e.target.closest('[data-delnotice]'); if (!b) return;
        if (!confirm('¿Borrar este aviso?')) return;
        const { error } = await sb.from('notices').delete().eq('id', b.dataset.delnotice);
        if (error) return toast(errMsg(error));
        S.notices = S.notices.filter((n) => String(n.id) !== b.dataset.delnotice); drawNotices();
      };
    }
  };

  const evForm = (ev) => `<form id="evf" class="ev-edit">
      <div class="ev-grid">
        <label>Día<input class="input" type="number" min="0" max="9" id="f-day" value="${ev ? ev.day : agendaState.day}" required></label>
        <label>Desde<input class="input" type="time" id="f-start" value="${esc((ev?.start_time || '').padStart(5, '0'))}"></label>
        <label>Hasta<input class="input" type="time" id="f-end" value="${esc(ev?.end_time ? ev.end_time.padStart(5, '0') : '')}"></label>
      </div>
      <label>Actividad<input class="input" id="f-title" maxlength="120" required value="${esc(ev?.title || '')}"></label>
      <label>Lugar<input class="input" id="f-place" maxlength="80" list="placelist" placeholder="Ej.: comedor, capilla, cancha" value="${esc(ev?.place || '')}"></label>
      <datalist id="placelist">${S.places.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <label>Nota<input class="input" id="f-note" maxlength="200" value="${esc(ev?.note || '')}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm"><i class="ti ti-device-floppy"></i> Guardar</button>
        <button type="button" class="btn btn-sm" id="f-cancel">Cancelar</button>
        ${ev ? '<span style="flex:1"></span><button type="button" class="btn btn-sm btn-danger" id="f-del"><i class="ti ti-trash"></i> Borrar</button>' : ''}
      </div></form>`;

  const drawEvents = () => {
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    let list = S.schedule.filter((r) => r.day === agendaState.day)
      .sort((a, b) => (toMin(a.start_time) ?? -1) - (toMin(b.start_time) ?? -1) || a.sort - b.sort);
    if (agendaState.mine && myCol) list = list.filter((r) => r[myCol] && r[myCol] !== '—');
    const dress = list.find((r) => r.dress)?.dress;
    $('#evs', main).innerHTML = (dress ? `<div class="note" style="margin-bottom:8px"><i class="ti ti-shirt"></i> Vestimenta del personal: <b>${esc(dress)}</b></div>` : '') +
      (list.length ? `<div class="list">${list.map((r) => {
        const s = toMin(r.start_time), e = toMin(r.end_time);
        const isNow = agendaState.day === today && s !== null && nowMin >= s && nowMin < (e ?? s + 15);
        const roles = Object.keys(COL_NAME).filter((k) => r[k] && r[k] !== '—');
        return `<div class="row-item ev ${isNow ? 'now' : ''}" data-ev="${r.id}">
          <div class="ev-time">${esc(r.start_time || '—')}${r.end_time ? `<br><span class="note">${esc(r.end_time)}</span>` : ''}</div>
          <div class="grow">
            ${titleHtml(r.title)}${isNow ? ' <span class="badge ok">Ahora</span>' : ''}${r.changed_at && Date.now() - new Date(r.changed_at) < 86400000 ? ' <span class="badge pend">Cambió</span>' : ''}
            ${r.place ? `<div class="note"><i class="ti ti-map-pin"></i> ${esc(r.place)}</div>` : ''}
            ${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}
            ${myCol && r[myCol] && r[myCol] !== '—' ? `<div class="badges"><span class="badge ${/^Dirigen|^Enseñan/.test(r[myCol]) ? 'pend' : ''}">Vos: ${esc(r[myCol])}</span></div>` : ''}
            ${!myCol && roles.length ? `<details class="note"><summary>Quién participa</summary>${roles.map((k) => `${COL_NAME[k]}: ${esc(r[k])}`).join('<br>')}</details>` : ''}
            ${r.guide ? `<details class="note guide"><summary>Indicaciones</summary>${esc(r.guide).replace(/\n\n/g, '<hr>').replace(/\n/g, '<br>')}</details>` : ''}
          </div>
          ${editor ? `<button class="btn btn-sm" data-edit="${r.id}" aria-label="Editar actividad"><i class="ti ti-pencil"></i></button>` : ''}
        </div>`;
      }).join('')}</div>` : `<div class="empty" style="padding:24px"><p>${S.schedule.length ? 'No hay actividades para mostrar en este día.' : 'Todavía no hay actividades cargadas.'}</p></div>`);
  };

  const openForm = (ev) => {
    agendaState.editing = ev ? ev.id : 'new';
    $('#ev-form', main).innerHTML = evForm(ev);
    const f = $('#evf', main);
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#f-cancel', f).onclick = () => { $('#ev-form', main).innerHTML = ''; agendaState.editing = null; };
    if ($('#f-del', f)) $('#f-del', f).onclick = async () => {
      if (!confirm('¿Borrar esta actividad del cronograma?')) return;
      const { error } = await sb.from('schedule').delete().eq('id', ev.id);
      if (error) return toast(errMsg(error));
      S.schedule = S.schedule.filter((x) => x.id !== ev.id); $('#ev-form', main).innerHTML = ''; drawEvents(); toast('Actividad borrada');
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const t = (v) => (v ? v.replace(/^0(\d):/, '$1:') : null);
      const row = { day: +$('#f-day', f).value, start_time: t($('#f-start', f).value), end_time: t($('#f-end', f).value), title: clean($('#f-title', f).value), place: clean($('#f-place', f).value) || null, note: clean($('#f-note', f).value) || null, updated_by: S.email, updated_at: new Date().toISOString(), changed_at: new Date().toISOString() };
      const send = (rw) => (ev ? sb.from('schedule').update(rw).eq('id', ev.id).select().single() : sb.from('schedule').insert({ ...rw, sort: 9999 }).select().single());
      let { data, error } = await send(row);
      if (error && /changed_at/.test(error.message)) { delete row.changed_at; ({ data, error } = await send(row)); } // por si falta el SQL 07
      if (error) return toast(errMsg(error));
      S.schedule = ev ? S.schedule.map((x) => (x.id === ev.id ? data : x)) : [...S.schedule, data];
      agendaState.day = data.day; $('#ev-form', main).innerHTML = ''; agendaState.editing = null;
      renderAgenda(main); toast('Guardado');
    };
  };

  drawNotices(); drawEvents();
  if ($('#days', main)) $('#days', main).onchange = (e) => { agendaState.day = +e.target.value; drawEvents(); };
  if ($('#mine', main)) $('#mine', main).onclick = () => { agendaState.mine = !agendaState.mine; $('#mine', main).classList.toggle('on', agendaState.mine); drawEvents(); };
  if ($('#add-ev', main)) $('#add-ev', main).onclick = () => openForm(null);
  $('#evs', main).onclick = (e) => { const b = e.target.closest('[data-edit]'); if (!b) return; openForm(S.schedule.find((x) => String(x.id) === b.dataset.edit)); };
  if ($('#d1f', main)) $('#d1f', main).onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#d1', main).value || null;
    const { error } = await sb.from('settings').upsert({ key: 'session_day1', value: v });
    if (error) return toast(errMsg(error));
    S.day1 = v; agendaState.day = null; renderAgenda(main); toast('Fecha guardada');
  };
  if ($('#sched-file', main)) $('#sched-file', main).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const rows = (json.filas || json).map((r, i) => ({ day: +r.day, start_time: r.start_time || null, end_time: r.end_time || null, title: String(r.title || '').slice(0, 200), place: r.place || null, note: r.note || null, dress: r.dress || null, cons: r.cons || null, aux: r.aux || null, coord: r.coord || null, md: r.md || null, guide: r.guide || null, sort: r.sort ?? i + 1, updated_by: S.email }));
      if (!rows.length || rows.some((r) => !r.title || Number.isNaN(r.day))) throw new Error('El archivo no tiene el formato esperado.');
      if (S.schedule.length && !confirm(`Se reemplazan las ${S.schedule.length} actividades actuales por ${rows.length} del archivo. ¿Continuar?`)) return;
      let r1 = await sb.from('schedule').delete().gte('id', 0); if (r1.error) throw r1.error;
      r1 = await sb.from('schedule').insert(rows); if (r1.error) throw r1.error;
      const { data } = await sb.from('schedule').select('*').order('day').order('sort');
      S.schedule = data || []; agendaState.day = null; renderAgenda(main); toast(`Cronograma cargado: ${rows.length} actividades`);
    } catch (err) { toast(errMsg(err)); }
  };
}

/* ---------- Mapa del colegio (croquis) ---------- */
const PLACE_KINDS = ['Comedor', 'Capilla / devocional', 'Dormitorio', 'Aula / clase', 'Gimnasio / salón', 'Cancha', 'Enfermería', 'Baños', 'Recepción / ingreso', 'Estacionamiento', 'Punto de encuentro', 'Otro'];
const KIND_ICON = { 'Comedor': 'tools-kitchen-2', 'Capilla / devocional': 'building-church', 'Dormitorio': 'bed', 'Aula / clase': 'school', 'Gimnasio / salón': 'building-stadium', 'Cancha': 'ball-football', 'Enfermería': 'first-aid-kit', 'Baños': 'bath', 'Recepción / ingreso': 'door-enter', 'Estacionamiento': 'parking', 'Punto de encuentro': 'flag', 'Otro': 'map-pin' };
let leafletReady = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'; css.integrity = 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'; css.crossOrigin = 'anonymous'; document.head.appendChild(css);
    const js = document.createElement('script'); js.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'; js.integrity = 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'; js.crossOrigin = 'anonymous'; js.onload = res; js.onerror = rej; document.head.appendChild(js);
  });
  return leafletReady;
}
let mapGeo = null;
// El mapa del lugar está en la base (solo lo ve quien tiene acceso). Se guarda una copia para usarlo sin conexión.
const MAP_KEY = 'pfj-mapa';
async function loadMapGeo() {
  if (!S.offline) {
    const { data, error } = await sb.from('settings').select('value').eq('key', 'map_geo').maybeSingle();
    if (!error && data && data.value) { try { localStorage.setItem(MAP_KEY, data.value); } catch { /* sin espacio */ } return JSON.parse(data.value); }
  }
  try { return JSON.parse(localStorage.getItem(MAP_KEY) || 'null'); } catch { return null; }
}
async function renderMap(main) {
  const editor = can.editEvent(S.role);
  main.innerHTML = `
    <h2 class="page">Mapa del lugar</h2>
    <p class="sub"><span id="map-lugar"></span>${editor ? ' Tocá un edificio o cualquier punto del mapa para marcar un lugar.' : ''}</p>
    ${!S.extrasOk ? `<div class="callout warn">Los lugares marcados todavía no se pueden guardar.${S.role === 'dueno' ? ' Falta ejecutar <b>04_agenda_avisos_mapa.sql</b> en Supabase.' : ''}</div>` : ''}
    <div id="map" class="map"></div>
    <div id="place-form"></div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 10px"><i class="ti ti-map-pins"></i> Lugares marcados</h3>
      <div class="list" id="places"></div>
    </div>
    <p class="note">Imagen satelital © Esri · contornos de edificios © colaboradores de OpenStreetMap.</p>`;
  try {
    await loadLeaflet();
    if (!mapGeo) mapGeo = await loadMapGeo();
  } catch { $('#map', main).innerHTML = '<div class="empty"><p>No se pudo cargar el mapa. Revisá la conexión.</p></div>'; return; }
  if (!mapGeo) { $('#map', main).innerHTML = `<div class="empty"><p>El mapa todavía no está cargado.${S.role === 'dueno' ? '<br>Falta ejecutar <b>15_seguridad_revision.sql</b> en Supabase.' : ''}</p></div>`; return; }
  $('#map-lugar', main).textContent = mapGeo.lugar ? mapGeo.lugar + '.' : '';
  const map = L.map($('#map', main), { zoomControl: true }).setView(mapGeo.centro, 18);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagen © Esri' }).addTo(map);
  const colors = { predio: '#FFD966', edificio: '#8FB0E8', cancha: '#7FD69B', pileta: '#5DCAEB' };
  const outlines = L.featureGroup().addTo(map);
  mapGeo.features.forEach((f) => {
    const poly = L.polygon(f.coords, { color: colors[f.kind] || '#fff', weight: f.kind === 'predio' ? 3 : 2, fillOpacity: f.kind === 'predio' ? 0 : 0.18, dashArray: f.kind === 'predio' ? '6 6' : null, interactive: f.kind !== 'predio' }).addTo(outlines);
    if (f.kind !== 'predio') poly.on('click', (e) => { L.DomEvent.stopPropagation(e); if (editor) openPlaceForm(poly.getBounds().getCenter(), f.kind === 'cancha' ? 'Cancha' : f.kind === 'pileta' ? 'Otro' : ''); });
  });
  const predio = mapGeo.features.find((f) => f.kind === 'predio');
  if (predio) map.fitBounds(L.polygon(predio.coords).getBounds(), { padding: [10, 10] });
  const markers = L.layerGroup().addTo(map);
  const drawPlaces = () => {
    markers.clearLayers();
    S.places.forEach((p) => {
      const icon = L.divIcon({ className: 'pin', html: `<span class="pin-dot"><i class="ti ti-${KIND_ICON[p.kind] || 'map-pin'}"></i></span><span class="pin-lbl">${esc(p.name)}</span>`, iconSize: null, iconAnchor: [14, 14] });
      L.marker([p.lat, p.lng], { icon, draggable: editor }).addTo(markers)
        .on('click', () => { if (editor) openPlaceForm(L.latLng(p.lat, p.lng), p.kind, p); })
        .on('dragend', async (e) => {
          const ll = e.target.getLatLng();
          const { error } = await sb.from('places').update({ lat: ll.lat, lng: ll.lng }).eq('id', p.id);
          if (error) return toast(errMsg(error));
          p.lat = ll.lat; p.lng = ll.lng; toast('Lugar movido');
        });
    });
    $('#places', main).innerHTML = S.places.length ? S.places.map((p) => `<div class="row-item">
        <i class="ti ti-${KIND_ICON[p.kind] || 'map-pin'}" style="font-size:20px;color:var(--accent)"></i>
        <div class="grow"><b>${esc(p.name)}</b><div class="note">${esc(p.kind || '')}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
        <button class="btn btn-sm" data-go="${p.id}" aria-label="Ver en el mapa"><i class="ti ti-focus-2"></i></button></div>`).join('')
      : `<p class="note" style="margin:0">${editor ? 'Todavía no marcaste lugares. Tocá un edificio del mapa para empezar.' : 'Todavía no hay lugares marcados.'}</p>`;
  };
  const openPlaceForm = (latlng, kind, p) => {
    if (!S.extrasOk) return toast('Primero hay que activar el mapa en la base de datos (04_agenda_avisos_mapa.sql).');
    const box = $('#place-form', main);
    box.innerHTML = `<form id="pf" class="panel ev-edit" style="padding:12px 16px">
      <h3 style="margin:0">${p ? 'Editar lugar' : 'Nuevo lugar'}</h3>
      <label>Nombre<input class="input" id="p-name" maxlength="80" required value="${esc(p?.name || '')}" placeholder="Ej.: Comedor principal"></label>
      <label>Tipo<select class="input" id="p-kind">${PLACE_KINDS.map((k) => `<option ${k === (p?.kind || kind) ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Nota<input class="input" id="p-note" maxlength="200" value="${esc(p?.note || '')}" placeholder="Ej.: planta alta, entrada por el patio"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm"><i class="ti ti-device-floppy"></i> Guardar</button><button type="button" class="btn btn-sm" id="p-cancel">Cancelar</button>${p ? '<span style="flex:1"></span><button type="button" class="btn btn-sm btn-danger" id="p-del"><i class="ti ti-trash"></i> Borrar</button>' : ''}</div>
    </form>`;
    const f = $('#pf', box); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#p-name', f).focus();
    $('#p-cancel', f).onclick = () => { box.innerHTML = ''; };
    if ($('#p-del', f)) $('#p-del', f).onclick = async () => {
      if (!confirm(`¿Borrar «${p.name}» del mapa?`)) return;
      const { error } = await sb.from('places').delete().eq('id', p.id);
      if (error) return toast(errMsg(error));
      S.places = S.places.filter((x) => x.id !== p.id); box.innerHTML = ''; drawPlaces();
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const row = { name: clean($('#p-name', f).value), kind: $('#p-kind', f).value, note: clean($('#p-note', f).value) || null };
      const q = p ? sb.from('places').update(row).eq('id', p.id).select().single() : sb.from('places').insert({ ...row, lat: latlng.lat, lng: latlng.lng, created_by: S.email }).select().single();
      const { data, error } = await q;
      if (error) return toast(errMsg(error));
      S.places = p ? S.places.map((x) => (x.id === p.id ? data : x)) : [...S.places, data];
      S.places.sort((a, b) => a.name.localeCompare(b.name)); box.innerHTML = ''; drawPlaces(); toast('Lugar guardado');
    };
  };
  if (editor) map.on('click', (e) => openPlaceForm(e.latlng, ''));
  $('#places', main).onclick = (e) => { const b = e.target.closest('[data-go]'); if (!b) return; const p = S.places.find((x) => String(x.id) === b.dataset.go); map.setView([p.lat, p.lng], 19); $('#map', main).scrollIntoView({ behavior: 'smooth' }); };
  drawPlaces();
  setTimeout(() => map.invalidateSize(), 200);
}

/* ---------- Más: menú de secciones ---------- */
/* Probador de diseño (solo la dueña): se ve al instante y se guarda para todos. */
let designPreviewing = false, designDraft = null;
function renderDesign(main) {
  if (!designDraft) designDraft = { ...designSaved };
  const changed = JSON.stringify(designDraft) !== JSON.stringify(designSaved);
  main.innerHTML = `<h2 class="page">Diseño de la app</h2>
    <p class="sub">Tocá las opciones: los cambios se ven al instante en toda la app. Cuando te guste, tocá <b>Guardar para todos</b>.</p>
    <div class="panel dz-demo" style="padding:14px 16px">
      <div class="tipo-h" style="margin:0"><i class="ti ti-eye"></i>Vista previa</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm"><i class="ti ti-check"></i> Principal</button><button class="btn btn-sm"><i class="ti ti-pencil"></i> Secundario</button><span class="chip on">Filtro activo</span><span class="chip">Filtro</span></div>
      <div class="row-item"><span class="menu-ic"><i class="ti ti-calendar-event"></i></span><div class="grow"><b>Estudio del Evangelio</b><div class="note">8:30 · Punto de encuentro</div></div><span class="badge ok">Ahora</span></div>
    </div>
    ${Object.entries(DESIGN_OPTS).map(([k, g]) => `<div class="dz-sec"><div class="menu-t">${esc(g.title)}</div><div class="dz-opts">${g.opts.map(([v, label, desc, sw]) => `
      <button class="dz-opt ${designDraft[k] === v ? 'on' : ''}" data-k="${k}" data-v="${v}">
        ${sw ? `<div class="dz-sw">${sw.map((c) => `<i style="background:${c}"></i>`).join('')}</div>` : ''}${k === 'navico' ? `<div class="dz-ics">${NAV_SETS[v].slice(0, 6).map((ic) => `<i class="ti ti-${ic}"></i>`).join('')}</div>` : ''}<b>${esc(label)}</b><span>${esc(desc)}</span></button>`).join('')}</div></div>`).join('')}
    <div class="dz-bar">
      <span class="note" style="flex:1">${changed ? 'Tenés cambios sin guardar.' : 'Así está guardado para todos.'}</span>
      <button class="btn btn-sm" id="dz-reset"><i class="ti ti-rotate"></i> Original</button>
      <button class="btn btn-sm" id="dz-undo" ${changed ? '' : 'disabled'}>Descartar</button>
      <button class="btn btn-primary btn-sm" id="dz-save" ${changed ? '' : 'disabled'}><i class="ti ti-device-floppy"></i> Guardar para todos</button>
    </div>`;
  const rerender = () => { applyDesign(designDraft); designPreviewing = JSON.stringify(designDraft) !== JSON.stringify(designSaved); render(); };
  main.onclick = async (e) => {
    const o = e.target.closest('.dz-opt');
    if (o) { designDraft[o.dataset.k] = o.dataset.v; return rerender(); }
    if (e.target.closest('#dz-reset')) { designDraft = { ...DESIGN_DEFAULT }; return rerender(); }
    if (e.target.closest('#dz-undo')) { designDraft = { ...designSaved }; return rerender(); }
    if (e.target.closest('#dz-save')) {
      const { error } = await sb.from('settings').upsert({ key: 'design4', value: JSON.stringify(designDraft) });
      if (error) return toast(errMsg(error));
      designSaved = { ...designDraft }; designPreviewing = false;
      try { localStorage.setItem(DESIGN_KEY, JSON.stringify(designSaved)); } catch { /* nada */ }
      toast('Diseño guardado: lo ven todos al abrir la app'); render();
    }
  };
}

const MORE_SECTIONS = [
  { title: 'Durante la conferencia', items: [
    { id: 'recordatorios', label: 'Recordatorios', ico: 'bell-ringing', desc: 'Próximas actividades y avisos', show: (r) => r !== 'obispo' },
    { id: 'recuentos', label: 'Recuentos', ico: 'clipboard-check', desc: 'Asistencia de cada recuento', show: (r) => can.headcount(r) },
    { id: 'incidentes', label: 'Incidentes', ico: 'alert-triangle', desc: 'Salud, conducta o seguridad', show: () => true }
  ] },
  { title: 'Organización', items: [
    { id: 'companias', label: 'Compañías', ico: 'users-group', desc: 'Participantes y consejeros por grupo', show: (r) => can.companies(r) },
    { id: 'directorio', label: 'Directorio', ico: 'address-book', desc: 'Contacto del personal', show: (r) => can.directory(r) },
    { id: 'obispos', label: 'Obispos', ico: 'mail', desc: 'Inscripciones por unidad', show: (r) => can.bishopMark(r) }
  ] },
  { title: 'Información', items: [
    { id: 'mapa', label: 'Mapa', ico: 'map-2', desc: 'Lugares del colegio', show: () => true },
    { id: 'recursos', label: 'Recursos', ico: 'books', desc: 'Manuales, videos, himnos y juegos', show: () => true }
  ] },
  { title: 'Cuenta', items: [
    { id: 'perfil', label: 'Mi perfil', ico: 'user-circle', desc: 'Nombre, teléfono y notificaciones', show: () => true },
    { id: 'privacidad', label: 'Privacidad', ico: 'shield-lock', desc: 'Cómo se cuidan los datos', show: () => true },
    { id: 'diseno', label: 'Diseño de la app', ico: 'palette', desc: 'Colores, íconos, botones y letra', show: (r) => r === 'dueno' }
  ] }
];
const MORE = MORE_SECTIONS.flatMap((s) => s.items);
function renderMore(main) {
  const items = MORE.filter((m) => m.show(S.role));
  if (UI.sub && items.some((m) => m.id === UI.sub)) {
    const m = items.find((x) => x.id === UI.sub);
    main.innerHTML = `<button class="backbtn" id="back"><i class="ti ti-chevron-left"></i> Más</button><div id="sub"></div>`;
    $('#back', main).onclick = () => { UI.sub = null; saveUI(); render(); window.scrollTo(0, 0); };
    const sub = $('#sub', main);
    if (S.offline && !['mapa', 'perfil', 'recordatorios', 'privacidad'].includes(m.id)) { sub.innerHTML = '<div class="empty"><p>Esta sección necesita conexión.</p></div>'; return; }
    return ({ companias: renderCompanies, recuentos: renderHeadcounts, incidentes: renderIncidents, directorio: renderDirectory, mapa: renderMap, obispos: renderBishops, recursos: renderResources, perfil: renderProfile, privacidad: renderPrivacy, recordatorios: renderRemindersPage, diseno: renderDesign }[m.id])(sub);
  }
  main.innerHTML = `<h2 class="page">Más</h2>` + MORE_SECTIONS.map((s) => {
    const vis = s.items.filter((m) => m.show(S.role));
    if (!vis.length) return '';
    return `<div class="menu-sec"><div class="menu-t">${esc(s.title)}</div><div class="menu">${vis.map((m) => `<button class="menu-i" data-sub="${m.id}">
      <span class="menu-ic"><i class="ti ti-${m.ico}"></i></span><span class="menu-tx"><b>${m.label}</b><span>${m.desc}</span></span><i class="ti ti-chevron-right menu-ch"></i></button>`).join('')}</div></div>`;
  }).join('');
  main.onclick = (e) => { const b = e.target.closest('[data-sub]'); if (!b) return; coState.ficha = null; UI.sub = b.dataset.sub; saveUI(); render(); window.scrollTo(0, 0); };
}

/* Pantalla de recordatorios: estado y todo lo que viene, hoy y mañana. */
function renderRemindersPage(main) {
  const today = todayDayNumber();
  const on = localStorage.getItem(REM_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted';
  const myCol = ROLE_COL[S.role];
  const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
  const mineOnly = (r) => !myCol || (r[myCol] && r[myCol] !== '—');
  const dayList = (d, fromNow) => S.schedule.filter((r) => r.day === d && toMin(r.start_time) !== null && mineOnly(r) && (!fromNow || toMin(r.start_time) >= nm - 5))
    .sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
  const row = (r, d) => { const diff = d === today ? toMin(r.start_time) - nm : null;
    return `<div class="rem-row ${diff !== null && diff >= 0 && diff <= 10 ? 'soon' : ''}"><span class="rem-t">${esc(r.start_time)}</span><span class="grow"><b>${esc(shortTitle(r.title))}</b>${r.place ? `<br><span class="note"><i class="ti ti-map-pin"></i> ${esc(r.place)}</span>` : ''}${myCol && r[myCol] ? `<br><span class="note">Vos: ${esc(r[myCol])}</span>` : ''}</span>${diff !== null && diff >= 0 ? `<span class="badge ${diff <= 10 ? 'pend' : ''}">${diff < 60 ? `en ${diff} min` : `en ${Math.floor(diff / 60)} h`}</span>` : ''}</div>`; };
  const todayL = today !== null ? dayList(today, true) : [], tomL = today !== null ? dayList(today + 1, false) : [];
  main.innerHTML = `<h2 class="page">Recordatorios</h2>
    <div class="panel rem"><div class="rem-h"><i class="ti ti-${on ? 'bell-ringing' : 'bell-off'}"></i><b>${on ? 'Activados' : 'Desactivados'}</b><span style="flex:1"></span><button class="btn btn-sm ${on ? '' : 'btn-primary'}" data-remtoggle>${on ? 'Desactivar' : 'Activar'}</button></div>
      <p class="note" style="margin:6px 0 0">${on ? `Te avisamos 10 minutos antes de cada actividad${myCol ? ' que te toca' : ''} y cuando llega un aviso nuevo.` : 'Activalos para recibir un aviso en el celular 10 minutos antes de cada actividad.'}</p></div>
    ${today === null ? '<div class="empty"><p>Los recordatorios empiezan cuando se cargue la fecha del Día 1.</p></div>' : `
    <div class="panel" style="padding:12px 16px"><h3 style="margin:0 0 8px">Hoy · ${esc(dayLabel(today))}</h3>${todayL.map((r) => row(r, today)).join('') || '<p class="note" style="margin:0">No quedan actividades por hoy.</p>'}</div>
    ${tomL.length ? `<div class="panel" style="padding:12px 16px"><h3 style="margin:0 0 8px">Mañana · ${esc(dayLabel(today + 1))}</h3>${tomL.map((r) => row(r, today + 1)).join('')}</div>` : ''}`}`;
}
const dbMissing = (err) => err && /does not exist|schema cache|Could not find/i.test(err.message || '');
const missingMsg = () => `<div class="empty"><div class="big"><i class="ti ti-database-off"></i></div><p>Esta sección todavía no está activada.${S.role === 'dueno' ? '<br>Falta ejecutar <b>07_funciones_completas.sql</b> en Supabase.' : ''}</p></div>`;
const fmtWhen = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

/* Ficha de la compañía: número, nombre, pasaje, verso cantado, metas, foto e integrantes. */
const canEditFicha = (c) => can.editEvent(S.role) || (S.role === 'consejero' && (S.myCompanies || []).includes(c.id));
async function shrinkImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.82));
}
async function renderFicha(main, cid) {
  const c = S.companies.find((x) => x.id === cid);
  if (!c) { coState.ficha = null; return renderCompanies(main); }
  const editable = canEditFicha(c);
  const [goalsRes, photoRes] = await Promise.all([
    sb.from('company_goals').select('*').eq('company_id', cid).order('created_at'),
    c.photo_path ? sb.storage.from('company-photos').createSignedUrl(c.photo_path, 3600) : Promise.resolve({ data: null })
  ]);
  if (dbMissing(goalsRes.error)) { main.innerHTML = missingMsg().replace('07_funciones_completas', '11_ficha_compania'); return; }
  const goals = goalsRes.data || [];
  const photo = photoRes.data?.signedUrl || null;
  const ms = S.people.filter((p) => S.members[p.id] === cid);
  const cons = ms.filter((p) => p.tipo === 'Consejero'), part = ms.filter((p) => p.tipo === 'Participante');
  const done = goals.filter((g) => g.done).length;
  main.innerHTML = `<button class="backbtn" id="fi-back"><i class="ti ti-chevron-left"></i> Compañías</button>
    <div class="ficha-h"><span class="ficha-n">${c.number ? 'N.º ' + esc(String(c.number)) : 'Compañía'}</span><h2 class="page" style="margin:0">${esc(c.name)}</h2>
      ${c.place ? `<span class="note"><i class="ti ti-map-pin"></i> ${esc(c.place)}</span>` : ''}</div>
    <div class="panel ficha-photo">${photo ? `<img src="${esc(photo)}" alt="Foto de la compañía ${esc(c.name)}">` : '<div class="ficha-ph"><i class="ti ti-photo"></i><span>Todavía no hay foto de la compañía</span></div>'}
      ${editable ? `<label class="btn btn-sm ficha-up"><i class="ti ti-camera"></i> ${photo ? 'Cambiar foto' : 'Subir foto'}<input type="file" id="fi-photo" accept="image/*" hidden></label>` : ''}</div>
    <div class="panel" style="padding:12px 16px" id="fi-data">
      <div style="display:flex;align-items:center;gap:8px"><h3 style="margin:0;flex:1"><i class="ti ti-id-badge-2"></i> Datos de la compañía</h3>${editable ? '<button class="btn btn-sm" id="fi-edit"><i class="ti ti-pencil"></i> Editar</button>' : ''}</div>
      <div class="ficha-f"><div class="k">Pasaje de las Escrituras</div><div>${c.scripture ? esc(c.scripture).replace(/\n/g, '<br>') : '<span class="note">Sin cargar</span>'}</div></div>
      <div class="ficha-f"><div class="k">Verso cantado</div><div class="ficha-verse">${c.verse ? esc(c.verse).replace(/\n/g, '<br>') : '<span class="note">Sin cargar</span>'}</div></div>
    </div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 8px"><i class="ti ti-target"></i> Metas de la compañía <span class="note">· ${done} de ${goals.length} cumplidas</span></h3>
      <div id="fi-goals">${goals.map((g) => `<div class="goal ${g.done ? 'done' : ''}"><label><input type="checkbox" data-goal="${g.id}" ${g.done ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>${esc(g.body)}</span></label>${editable ? `<button class="linkbtn" data-delgoal="${g.id}" aria-label="Borrar meta"><i class="ti ti-x"></i></button>` : ''}</div>`).join('') || '<p class="note" style="margin:0">Todavía no hay metas.</p>'}</div>
      ${editable ? '<form id="fi-gf" class="form-inline" style="margin:10px 0 0"><input class="input" id="fi-g" maxlength="300" placeholder="Nueva meta de la compañía" required><button class="btn btn-sm btn-primary"><i class="ti ti-plus"></i> Agregar</button></form>' : ''}
    </div>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 4px"><i class="ti ti-users-group"></i> Integrantes</h3>
      <div class="tipo-h" style="margin-top:6px"><i class="ti ti-users"></i>Consejeros<span class="n">${cons.length}</span></div>${cons.map((p) => `<div class="co-m"><span>${esc(p.last)}, ${esc(p.first)}</span></div>`).join('') || '<div class="note">—</div>'}
      <div class="tipo-h"><i class="ti ti-mood-kid"></i>Participantes<span class="n">${part.length}</span></div>${part.map((p) => `<div class="co-m"><span>${esc(p.last)}, ${esc(p.first)}</span></div>`).join('') || '<div class="note">—</div>'}
    </div>`;
  const reload = async () => { await loadCompanies(); renderFicha(main, cid); };
  $('#fi-back', main).onclick = () => { coState.ficha = null; renderCompanies(main); window.scrollTo(0, 0); };
  if (!editable) return;
  const save = (patch) => sb.rpc('save_company_ficha', { cid, num: patch.number ?? c.number ?? null, nm: patch.name ?? c.name, scr: patch.scripture ?? c.scripture ?? null, vrs: patch.verse ?? c.verse ?? null, photo: patch.photo_path ?? null, plc: patch.place ?? c.place ?? null });
  $('#fi-edit', main).onclick = () => {
    $('#fi-data', main).innerHTML = `<form id="fi-f" class="ev-edit">
      <h3 style="margin:0">Editar datos</h3>
      <div class="ev-grid" style="grid-template-columns:90px 1fr"><label>Número<input class="input" type="number" min="1" id="f-num" value="${esc(c.number ?? '')}"></label><label>Nombre<input class="input" id="f-nm" maxlength="60" required value="${esc(c.name)}"></label></div>
      <label>Punto de encuentro<input class="input" id="f-plc" maxlength="60" list="fi-places" value="${esc(c.place || '')}"></label><datalist id="fi-places">${S.places.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <label>Pasaje de las Escrituras<textarea class="input" id="f-scr" rows="2" maxlength="300" placeholder="Ej.: Alma 37:6">${esc(c.scripture || '')}</textarea></label>
      <label>Verso cantado<textarea class="input" id="f-vrs" rows="5" maxlength="2000">${esc(c.verse || '')}</textarea></label>
      <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm"><i class="ti ti-device-floppy"></i> Guardar</button><button type="button" class="btn btn-sm" id="f-cancel">Cancelar</button></div></form>`;
    $('#f-cancel', main).onclick = () => renderFicha(main, cid);
    $('#fi-f', main).onsubmit = async (e) => {
      e.preventDefault();
      const n = $('#f-num', main).value;
      const { error } = await save({ number: n ? +n : null, name: clean($('#f-nm', main).value), place: clean($('#f-plc', main).value) || null, scripture: $('#f-scr', main).value.trim() || null, verse: $('#f-vrs', main).value.trim() || null });
      if (error) return toast(errMsg(error));
      toast('Ficha guardada'); reload();
    };
  };
  $('#fi-photo', main).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    toast('Subiendo foto…');
    try {
      const blob = await shrinkImage(file);
      const path = `c${cid}/foto-${Date.now()}.jpg`;
      const up = await sb.storage.from('company-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      const { error } = await save({ photo_path: path });
      if (error) throw error;
      if (c.photo_path && c.photo_path !== path) sb.storage.from('company-photos').remove([c.photo_path]);
      toast('Foto guardada'); reload();
    } catch (err) { toast(errMsg(err)); }
  };
  $('#fi-gf', main).onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('company_goals').insert({ company_id: cid, body: clean($('#fi-g', main).value), created_by: S.email });
    if (error) return toast(errMsg(error));
    reload();
  };
  $('#fi-goals', main).onchange = async (e) => {
    const cb = e.target.closest('[data-goal]'); if (!cb) return;
    const { error } = await sb.from('company_goals').update({ done: cb.checked }).eq('id', cb.dataset.goal);
    if (error) { cb.checked = !cb.checked; return toast(errMsg(error)); }
    reload();
  };
  $('#fi-goals', main).onclick = async (e) => {
    const b = e.target.closest('[data-delgoal]'); if (!b || !confirm('¿Borrar esta meta?')) return;
    const { error } = await sb.from('company_goals').delete().eq('id', b.dataset.delgoal);
    if (error) return toast(errMsg(error));
    reload();
  };
}

/* Compañías: los coordinadores arman los grupos rápido; el resto los ve. */
const coState = { target: null, tipo: 'Participante', q: '', prov: '', onlyFree: true, sel: new Set(), ficha: null };
async function renderCompanies(main) {
  const manage = can.editEvent(S.role);
  await loadCompanies();
  if (coState.ficha) return renderFicha(main, coState.ficha);
  if (!S.companies.length && !manage) { main.innerHTML = '<h2 class="page">Compañías</h2><div class="empty"><p>Todavía no se armaron las compañías.</p></div>'; return; }
  const membersOf = (cid) => S.people.filter((p) => S.members[p.id] === cid);
  const mine = new Set(S.myCompanies || []);
  const list = S.role === 'consejero' ? S.companies.filter((c) => mine.has(c.id)) : S.companies;
  if (!coState.target || !S.companies.some((c) => c.id === coState.target)) coState.target = S.companies[0]?.id || null;
  main.innerHTML = `<h2 class="page">Compañías</h2>
    <p class="sub">${plural(S.companies.length, 'compañía', 'compañías')}.${manage ? ' Creá las compañías y después asigná a las personas de a muchas a la vez.' : ''}</p>
    ${manage ? `<form id="cof" class="form-inline"><input class="input" id="co-n" maxlength="60" placeholder="Nombre de la nueva compañía" required><input class="input" id="co-p" maxlength="60" placeholder="Punto de encuentro (opcional)" list="co-places" style="flex:1 1 180px"><datalist id="co-places">${S.places.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist><button class="btn btn-primary"><i class="ti ti-plus"></i> Crear</button></form>` : ''}
    ${manage && S.companies.length ? `<div class="panel" style="padding:12px 16px" id="assign">
      <h3 style="margin:0 0 10px"><i class="ti ti-user-plus"></i> Asignar personas</h3>
      <div class="form-inline" style="margin-bottom:8px">
        <select class="input" id="as-t" style="flex:1 1 200px">${S.companies.map((c) => `<option value="${c.id}" ${c.id === coState.target ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select class="input" id="as-prov" style="flex:0 1 180px"><option value="">Todas las provincias</option>${PROVINCES.filter((pr) => S.people.some((p) => p.prov === pr)).map((pr) => `<option ${pr === coState.prov ? 'selected' : ''}>${pr}</option>`).join('')}</select>
      </div>
      <div class="chips" id="as-tipo" style="margin-bottom:8px">
        <button type="button" class="chip ${coState.tipo === 'Participante' ? 'on' : ''}" data-t="Participante">Participantes</button>
        <button type="button" class="chip ${coState.tipo === 'Consejero' ? 'on' : ''}" data-t="Consejero">Consejeros (con «Sí»)</button>
        <label class="chip ${coState.onlyFree ? 'on' : ''}" id="as-free" style="cursor:pointer">Solo sin compañía</label>
      </div>
      <input class="input" id="as-q" type="search" placeholder="Buscar nombre o barrio…" value="${esc(coState.q)}" style="margin-bottom:8px">
      <div class="as-bar"><label><input type="checkbox" id="as-all"> Seleccionar todos</label><span id="as-n" class="note"></span><button class="btn btn-primary btn-sm" id="as-go"><i class="ti ti-arrow-right"></i> Agregar</button></div>
      <div class="as-list" id="as-list"></div>
    </div>` : ''}
    <div id="colist"></div>`;

  const drawList = () => {
    $('#colist', main).innerHTML = list.length ? list.map((c) => {
      const ms = membersOf(c.id), cons = ms.filter((p) => p.tipo === 'Consejero'), part = ms.filter((p) => p.tipo === 'Participante');
      const row = (p) => `<div class="co-m"><span>${esc(p.last)}, ${esc(p.first)} <span class="note">· ${esc(p.ward || p.prov || '')}</span></span>${manage ? `<button class="linkbtn" data-rm="${esc(p.id)}" aria-label="Quitar de la compañía"><i class="ti ti-x"></i></button>` : ''}</div>`;
      return `<section class="group ${UI.open['co' + c.id] === false ? 'closed' : ''}" data-g="co${c.id}">
        <button class="group-h"><span class="car">▾</span>${esc(c.name)}${mine.has(c.id) ? ' <span class="badge ok">Tu compañía</span>' : ''}<span class="n">${cons.length} cons. · ${part.length} part.</span></button>
        <div class="group-b"><div class="card" style="padding:10px 14px">
          ${c.place ? `<div class="note" style="margin-bottom:6px"><i class="ti ti-map-pin"></i> ${esc(c.place)}</div>` : ''}
          ${manage ? `<form class="form-inline" data-aux="${c.id}" style="margin:0 0 8px"><input class="input" name="ae" type="email" maxlength="120" placeholder="Correo del coordinador/a auxiliar" value="${esc(c.aux_email || '')}" style="flex:1 1 200px"><button class="btn btn-sm"><i class="ti ti-device-floppy"></i> Guardar</button></form>`
            : c.aux_email ? `<div class="note" style="margin-bottom:6px"><i class="ti ti-user-shield"></i> Coord. auxiliar: ${esc(c.aux_email)}</div>` : ''}
          <div class="tipo-h" style="margin-top:0"><i class="ti ti-users"></i>Consejeros<span class="n">${cons.length}</span></div>${cons.map(row).join('') || '<div class="note">—</div>'}
          <div class="tipo-h"><i class="ti ti-mood-kid"></i>Participantes<span class="n">${part.length}</span></div>${part.map(row).join('') || '<div class="note">—</div>'}
          <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-sm btn-primary" data-ficha="${c.id}"><i class="ti ti-id-badge-2"></i> Ver ficha</button>${manage ? `<button class="btn btn-sm btn-danger" data-delco="${c.id}"><i class="ti ti-trash"></i> Borrar compañía</button>` : ''}</div>
        </div></div></section>`;
    }).join('') : `<div class="empty"><p>${S.role === 'consejero' ? 'Todavía no te asignaron a una compañía.' : 'Todavía no hay compañías.'}</p></div>`;
  };

  const candidates = () => {
    const q = norm(coState.q);
    return S.people.filter((p) => p.tipo === coState.tipo && (coState.tipo !== 'Consejero' || p.mark === 'Sí'))
      .filter((p) => !coState.prov || p.prov === coState.prov)
      .filter((p) => !coState.onlyFree || !S.members[p.id])
      .filter((p) => !q || norm(`${p.first} ${p.last} ${p.ward} ${p.stake}`).includes(q))
      .sort((a, b) => a.last.localeCompare(b.last));
  };
  const drawAssign = () => {
    const box = $('#as-list', main); if (!box) return;
    const c = candidates();
    box.innerHTML = c.map((p) => `<label class="as-item"><input type="checkbox" value="${esc(p.id)}" ${coState.sel.has(p.id) ? 'checked' : ''}>
      <span><b>${esc(p.last)}, ${esc(p.first)}</b><span class="note"> · ${esc([p.sex, p.age ? p.age + ' años' : '', p.ward || p.prov].filter(Boolean).join(' · '))}${S.members[p.id] ? ' · en ' + esc(companyName(S.members[p.id])) : ''}</span></span></label>`).join('')
      || `<p class="note" style="padding:8px">${coState.tipo === 'Consejero' ? 'No hay consejeros con «Sí» para mostrar.' : 'No hay participantes para mostrar.'}</p>`;
    $('#as-n', main).textContent = coState.sel.size ? `${coState.sel.size} seleccionados` : `${c.length} en la lista`;
    $('#as-all', main).checked = c.length > 0 && c.every((p) => coState.sel.has(p.id));
  };
  drawList(); drawAssign();

  if (manage) {
    $('#cof', main).onsubmit = async (e) => {
      e.preventDefault();
      const { data, error } = await sb.from('companies').insert({ name: clean($('#co-n', main).value), place: clean($('#co-p', main).value) || null }).select().single();
      if (error) return toast(dbMissing(error) ? 'Falta activar compañías (SQL 08).' : errMsg(error));
      coState.target = data.id; toast('Compañía creada'); renderCompanies(main);
    };
    if ($('#assign', main)) {
      $('#as-t', main).onchange = (e) => { coState.target = +e.target.value; };
      $('#as-prov', main).onchange = (e) => { coState.prov = e.target.value; drawAssign(); };
      $('#as-q', main).oninput = (e) => { coState.q = e.target.value; drawAssign(); };
      $('#as-tipo', main).onclick = (e) => {
        const t = e.target.closest('[data-t]'), f = e.target.closest('#as-free');
        if (t) { coState.tipo = t.dataset.t; coState.sel.clear(); main.querySelectorAll('#as-tipo [data-t]').forEach((x) => x.classList.toggle('on', x === t)); }
        if (f) { coState.onlyFree = !coState.onlyFree; f.classList.toggle('on', coState.onlyFree); }
        drawAssign();
      };
      $('#as-list', main).onchange = (e) => { const cb = e.target; if (cb.type !== 'checkbox') return; if (cb.checked) coState.sel.add(cb.value); else coState.sel.delete(cb.value); drawAssign(); };
      $('#as-all', main).onchange = (e) => { candidates().forEach((p) => (e.target.checked ? coState.sel.add(p.id) : coState.sel.delete(p.id))); drawAssign(); };
      $('#as-go', main).onclick = async () => {
        if (!coState.sel.size) return toast('Marcá a quién querés agregar');
        const cid = +$('#as-t', main).value;
        const rows = [...coState.sel].map((pid) => ({ company_id: cid, person_id: pid }));
        const { error } = await sb.from('company_members').upsert(rows, { onConflict: 'person_id' });
        if (error) return toast(errMsg(error));
        toast(`${plural(rows.length, 'persona agregada', 'personas agregadas')} a ${companyName(cid)}`);
        coState.sel.clear(); await loadCompanies(); drawList(); drawAssign();
      };
    }
  }
  $('#colist', main).onsubmit = async (e) => {
    const f = e.target.closest('[data-aux]'); if (!f) return;
    e.preventDefault();
    const v = clean(f.ae.value).toLowerCase() || null;
    const { error } = await sb.from('companies').update({ aux_email: v }).eq('id', f.dataset.aux);
    if (error) return toast(/aux_email/.test(error.message) ? 'Falta ejecutar el SQL 13.' : errMsg(error));
    toast(v ? 'Coordinador/a auxiliar asignado/a' : 'Se quitó el coordinador/a auxiliar'); await loadCompanies(); drawList();
  };
  $('#colist', main).onclick = async (e) => {
    const gh = e.target.closest('.group-h');
    if (gh) { const sec = gh.parentElement; UI.open[sec.dataset.g] = sec.classList.contains('closed'); saveUI(); sec.classList.toggle('closed'); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { const { error } = await sb.from('company_members').delete().eq('person_id', rm.dataset.rm); if (error) return toast(errMsg(error)); await loadCompanies(); drawList(); drawAssign(); return; }
    const fi = e.target.closest('[data-ficha]');
    if (fi) { coState.ficha = +fi.dataset.ficha; renderFicha(main, coState.ficha); window.scrollTo(0, 0); return; }
    const dc = e.target.closest('[data-delco]');
    if (dc) {
      if (!confirm(`¿Borrar la compañía «${companyName(+dc.dataset.delco)}»? Las personas quedan sin compañía.`)) return;
      const { error } = await sb.from('companies').delete().eq('id', dc.dataset.delco); if (error) return toast(errMsg(error));
      await loadCompanies(); renderCompanies(main);
    }
  };
}

/* Recuentos: se elige el recuento del horario y la compañía; se marca la asistencia en la lista. */
const hcState = { sid: null, cid: null, present: new Set() };
async function renderHeadcounts(main) {
  const seeAll = can.seeAllHeadcounts(S.role);
  await loadCompanies();
  const today = todayDayNumber();
  const counts = S.schedule.filter((r) => /recuento/i.test(r.title)).sort((a, b) => a.day - b.day || (toMin(a.start_time) ?? 0) - (toMin(b.start_time) ?? 0));
  if (!counts.some((r) => String(r.id) === String(hcState.sid))) {
    const now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    const todays = counts.filter((r) => r.day === today);
    const best = todays.filter((r) => (toMin(r.start_time) ?? 0) <= nm + 30).pop() || todays[0] || counts[0];
    hcState.sid = best ? best.id : null;
  }
  const comps = S.role === 'consejero' ? S.companies.filter((c) => (S.myCompanies || []).includes(c.id)) : S.companies;
  // Listas para marcar asistencia: compañías (si hay) y, mientras tanto, otras agrupaciones.
  const groups = comps.map((c) => ({ v: 'c:' + c.id, label: c.name, cid: c.id, people: () => S.people.filter((p) => S.members[p.id] === c.id && p.tipo === 'Participante') }));
  if (S.role === 'consejero') { if (!groups.length) groups.push({ v: 'mine', label: 'Mis participantes', people: () => S.people.filter((p) => p.tipo === 'Participante') }); }
  else {
    groups.push({ v: 'all', label: 'Todos los participantes', people: () => S.people.filter((p) => p.tipo === 'Participante') });
    PROVINCES.filter((pr) => S.people.some((p) => p.prov === pr && p.tipo === 'Participante')).forEach((pr) => groups.push({ v: 'prov:' + pr, label: 'Participantes de ' + pr, people: () => S.people.filter((p) => p.prov === pr && p.tipo === 'Participante') }));
  }
  if (!groups.some((g) => g.v === hcState.grp)) hcState.grp = groups[0]?.v || null;
  const curGroup = () => groups.find((g) => g.v === hcState.grp);
  let q = sb.from('headcounts').select('*').order('created_at', { ascending: false }).limit(400);
  if (!seeAll) q = q.eq('created_by', S.email);
  const { data, error } = await q;
  if (dbMissing(error)) { main.innerHTML = missingMsg(); return; }
  const list = data || [];
  const days = [...new Set(counts.map((r) => r.day))];
  const roster = () => (curGroup() ? curGroup().people() : []).sort((a, b) => a.last.localeCompare(b.last));
  main.innerHTML = `<h2 class="page">Recuentos</h2>
    <p class="sub">Elegí el recuento y la compañía, y marcá quién está.</p>
    <form id="hcf" class="panel ev-edit" style="padding:12px 16px">
      <label>Recuento<select class="input" id="hc-s">${counts.length ? days.map((d) => `<optgroup label="${esc(dayLabel(d))}${d === today ? ' · hoy' : ''}">${counts.filter((r) => r.day === d).map((r) => `<option value="${r.id}" ${String(r.id) === String(hcState.sid) ? 'selected' : ''}>${esc(r.start_time || '')} · ${esc(r.title.replace(/\s*\|\s*/g, ' · '))}</option>`).join('')}</optgroup>`).join('') : '<option value="">No hay recuentos en el horario</option>'}</select></label>
      ${groups.length ? `<label>${comps.length ? 'Compañía' : 'Lista'}<select class="input" id="hc-c">${groups.map((g) => `<option value="${esc(g.v)}" ${g.v === hcState.grp ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>${!comps.length ? '<p class="note" style="margin:-4px 0 0">Cuando estén las compañías, vas a poder elegir tu compañía.</p>' : ''}` : ''}
      <div id="hc-roster"></div>
      <button class="btn btn-primary" style="justify-self:start" ${counts.length ? '' : 'disabled'}><i class="ti ti-check"></i> Enviar recuento</button>
    </form>
    <div class="panel" style="padding:12px 16px"><h3 style="margin:0 0 10px">${seeAll ? 'Recuentos recibidos' : 'Mis recuentos'}</h3><div id="hcl"></div></div>`;

  const drawRoster = () => {
    const box = $('#hc-roster', main), r = roster();
    if (!r.length) {
      box.innerHTML = `${comps.length ? '<p class="note" style="margin:0">Esta compañía todavía no tiene participantes cargados. Podés cargar el número a mano:</p>' : '<p class="note" style="margin:0">Cuando estén armadas las compañías, acá vas a ver la lista para marcar asistencia. Mientras tanto, cargá el número:</p>'}
        <div class="ev-grid" style="grid-template-columns:1fr 1fr;margin-top:8px"><label>Presentes<input class="input" type="number" min="0" id="hc-p" required></label><label>Esperados<input class="input" type="number" min="0" id="hc-e"></label></div>
        <label style="margin-top:8px">Faltan<input class="input" id="hc-m" maxlength="500"></label>`;
      return;
    }
    box.innerHTML = `<div class="as-bar"><b id="hc-count">${hcState.present.size} de ${r.length} presentes</b><span style="flex:1"></span><button type="button" class="btn btn-sm" id="hc-all">Todos presentes</button><button type="button" class="btn btn-sm" id="hc-none">Ninguno</button></div>
      <div class="att-prog"><i style="width:${r.length ? Math.round((hcState.present.size / r.length) * 100) : 0}%"></i></div>
      <div class="as-list att">${r.map((p) => { const on = hcState.present.has(p.id); return `<label class="att-row ${on ? 'on' : ''}"><input type="checkbox" value="${esc(p.id)}" ${on ? 'checked' : ''}><span class="att-av">${esc(((p.first || '')[0] || '') + ((p.last || '')[0] || ''))}</span><span class="att-nm"><b>${esc(p.last)}, ${esc(p.first)}</b>${p.ward ? `<small>${esc(p.ward)}</small>` : ''}</span><span class="att-st"><i class="ti ti-${on ? 'check' : 'minus'}"></i>${on ? 'Presente' : 'Falta'}</span></label>`; }).join('')}</div>`;
    $('#hc-all', box).onclick = () => { r.forEach((p) => hcState.present.add(p.id)); drawRoster(); };
    $('#hc-none', box).onclick = () => { hcState.present.clear(); drawRoster(); };
    box.querySelector('.att').onchange = (e) => { const cb = e.target; if (cb.checked) hcState.present.add(cb.value); else hcState.present.delete(cb.value); drawRoster(); };
  };
  drawRoster();
  if ($('#hc-c', main)) $('#hc-c', main).onchange = (e) => { hcState.grp = e.target.value; hcState.present.clear(); drawRoster(); };
  $('#hc-s', main).onchange = (e) => { hcState.sid = e.target.value; };

  const byAct = {};
  list.forEach((h) => { const k = h.schedule_id || 'x'; (byAct[k] = byAct[k] || []).push(h); });
  $('#hcl', main).innerHTML = Object.keys(byAct).length ? Object.entries(byAct).map(([k, hs]) => {
    const act = S.schedule.find((r) => String(r.id) === String(k));
    const sumP = hs.reduce((a, h) => a + h.present, 0), sumE = hs.reduce((a, h) => a + (h.expected || 0), 0);
    return `<div class="row-item" style="display:block"><b>${esc(act ? `${dayLabel(act.day)} · ${act.start_time || ''} · ${act.title.replace(/\s*\|\s*/g, ' · ')}` : 'Recuento')}</b>
      ${seeAll ? `<div class="badges"><span class="badge ${sumE && sumP < sumE ? 'bad' : 'ok'}">${sumP}${sumE ? ' de ' + sumE : ''} presentes</span><span class="badge">${plural(hs.length, 'compañía', 'compañías')}</span></div>` : ''}
      <div class="note" style="margin-top:6px">${hs.map((h) => `${h.company_id ? '<b>' + esc(companyName(h.company_id)) + '</b> · ' : h.label ? '<b>' + esc(h.label) + '</b> · ' : ''}${h.present}${h.expected ? '/' + h.expected : ''}${h.missing ? ' · faltan: ' + esc(h.missing) : ''} · ${esc(h.created_by || '')} · ${fmtWhen(h.created_at)}`).join('<br>')}</div></div>`;
  }).join('') : '<p class="note" style="margin:0">Todavía no hay recuentos.</p>';

  $('#hcf', main).onsubmit = async (e) => {
    e.preventDefault();
    const r = roster(), useList = r.length > 0, g = curGroup();
    const row = { schedule_id: hcState.sid ? +hcState.sid : null, company_id: g && g.cid ? g.cid : null, label: g && !g.cid ? g.label : null, created_by: S.email };
    if (useList) { row.present = r.filter((p) => hcState.present.has(p.id)).length; row.expected = r.length; row.missing = r.filter((p) => !hcState.present.has(p.id)).map((p) => `${p.first} ${p.last}`).join(', ') || null; }
    else { row.present = +$('#hc-p', main).value; row.expected = $('#hc-e', main).value ? +$('#hc-e', main).value : null; row.missing = clean($('#hc-m', main).value) || null; }
    let { error: err } = await sb.from('headcounts').insert(row);
    if (err && /company_id/.test(err.message)) { delete row.company_id; ({ error: err } = await sb.from('headcounts').insert(row)); }
    if (err) return toast(errMsg(err));
    hcState.present.clear(); toast(`Recuento enviado: ${row.present}${row.expected ? ' de ' + row.expected : ''}`); renderHeadcounts(main);
  };
}

/* Incidentes: cualquiera avisa; salud y coordinación los ven y los cierran. */
const INC_KINDS = ['Salud', 'Conducta', 'Seguridad', 'Otro'];
async function renderIncidents(main) {
  const manage = can.health(S.role);
  const { data, error } = await sb.from('incidents').select('*').order('created_at', { ascending: false }).limit(200);
  if (dbMissing(error)) { main.innerHTML = missingMsg(); return; }
  const list = data || [];
  const names = [...new Set(S.people.map((p) => `${p.first} ${p.last}`))];
  main.innerHTML = `<h2 class="page">Incidentes</h2>
    <p class="sub">${manage ? 'Coordinación, bienestar y enfermería ven todos los incidentes y los cierran.' : 'Avisá un problema: lo ve coordinación, bienestar y enfermería al instante.'}</p>
    <form id="incf" class="panel ev-edit" style="padding:12px 16px">
      <h3 style="margin:0">Avisar un incidente</h3>
      <div class="ev-grid" style="grid-template-columns:1fr auto"><label>Tipo<select class="input" id="i-k">${INC_KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label><label style="align-self:end;display:flex;gap:6px;align-items:center;padding-bottom:10px"><input type="checkbox" id="i-u"> Urgente</label></div>
      <label>Persona (opcional)<input class="input" id="i-p" list="inc-names" maxlength="80"></label><datalist id="inc-names">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <label>Lugar (opcional)<input class="input" id="i-l" list="inc-places" maxlength="80"></label><datalist id="inc-places">${S.places.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <label>Qué pasó<textarea class="input" id="i-d" rows="3" maxlength="1500" required></textarea></label>
      <button class="btn btn-primary btn-sm" style="justify-self:start"><i class="ti ti-send"></i> Enviar aviso</button>
    </form>
    <div class="panel" style="padding:12px 16px"><h3 style="margin:0 0 10px">${manage ? 'Incidentes' : 'Mis avisos'}</h3><div class="list" id="incl"></div></div>`;
  $('#incl', main).innerHTML = list.length ? list.map((i) => `<div class="row-item" style="display:block">
      <div class="badges" style="margin:0 0 4px"><span class="badge ${i.status === 'Abierto' ? 'pend' : 'ok'}">${esc(i.status)}</span><span class="badge">${esc(i.kind)}</span>${i.urgent ? '<span class="badge bad">Urgente</span>' : ''}</div>
      ${i.person ? `<b>${esc(i.person)}</b> · ` : ''}${i.place ? `<span class="note"><i class="ti ti-map-pin"></i> ${esc(i.place)}</span>` : ''}
      <div style="margin:4px 0">${esc(i.description).replace(/\n/g, '<br>')}</div>
      <div class="note">${fmtWhen(i.created_at)} · ${esc(i.created_by || '')}${i.closed_at ? ` · cerrado por ${esc(i.closed_by || '')}: ${esc(i.resolution || '')}` : ''}</div>
      ${manage && i.status === 'Abierto' ? `<div class="form-inline" style="margin:8px 0 0"><input class="input" data-res="${i.id}" placeholder="Cómo se resolvió"><button class="btn btn-sm" data-close="${i.id}"><i class="ti ti-check"></i> Cerrar</button></div>` : ''}
    </div>`).join('') : '<p class="note" style="margin:0">No hay incidentes registrados.</p>';
  $('#incf', main).onsubmit = async (e) => {
    e.preventDefault();
    const row = { kind: $('#i-k', main).value, urgent: $('#i-u', main).checked, person: clean($('#i-p', main).value) || null, place: clean($('#i-l', main).value) || null, description: clean($('#i-d', main).value), created_by: S.email };
    const { error: err } = await sb.from('incidents').insert(row);
    if (err) return toast(errMsg(err));
    toast('Aviso enviado a coordinación'); renderIncidents(main);
  };
  $('#incl', main).onclick = async (e) => {
    const b = e.target.closest('[data-close]'); if (!b) return;
    const res = clean(main.querySelector(`[data-res="${b.dataset.close}"]`).value);
    const { error: err } = await sb.from('incidents').update({ status: 'Cerrado', resolution: res || null, closed_by: S.email, closed_at: new Date().toISOString() }).eq('id', b.dataset.close);
    if (err) return toast(errMsg(err));
    toast('Incidente cerrado'); renderIncidents(main);
  };
}

/* Directorio del personal */
async function renderDirectory(main) {
  const { data, error } = await sb.rpc('get_directory');
  if (dbMissing(error)) { main.innerHTML = missingMsg(); return; }
  if (error) { main.innerHTML = `<div class="empty"><p>${esc(errMsg(error))}</p></div>`; return; }
  const list = data || [];
  main.innerHTML = `<h2 class="page">Directorio del personal</h2>
    <p class="sub">${plural(list.length, 'persona', 'personas')}. Para aparecer con tu nombre y teléfono, completá «Mi perfil».</p>
    <div class="toolbar"><input class="input" id="dq" type="search" placeholder="Buscar nombre o rol…"></div><div class="list" id="dl"></div>`;
  const draw = () => {
    const q = norm($('#dq', main).value);
    $('#dl', main).innerHTML = list.filter((p) => !q || norm(`${p.name || ''} ${p.email} ${roleName(p.role)}`).includes(q)).map((p) => `<div class="row-item">
      <div class="grow"><b>${esc(p.name || p.email)}</b><div class="note">${esc(roleName(p.role))}${p.name ? ' · ' + esc(p.email) : ''}${p.phone ? ' · ' + esc(p.phone) : ''}</div></div>
      ${contactLinks(p.phone || '', p.email)}</div>`).join('') || '<p class="note">Sin resultados.</p>';
  };
  draw(); $('#dq', main).oninput = draw;
}

/* Recursos: enlaces útiles (los cargan la dueña y los coordinadores) */
async function renderResources(main) {
  const editor = can.editEvent(S.role);
  const { data, error } = await sb.from('resources').select('*').order('category').order('title');
  if (dbMissing(error)) { main.innerHTML = missingMsg(); return; }
  const list = data || [];
  const cats = [...new Set(list.map((r) => r.category || 'Otros'))];
  main.innerHTML = `<h2 class="page">Recursos</h2><p class="sub">Enlaces a manuales oficiales, videos, himnos y juegos.</p>
    ${editor ? `<form id="rf" class="panel ev-edit" style="padding:12px 16px"><h3 style="margin:0">Agregar un enlace</h3>
      <label>Título<input class="input" id="r-t" maxlength="120" required></label>
      <label>Enlace<input class="input" id="r-u" type="url" required placeholder="https://"></label>
      <label>Categoría<input class="input" id="r-c" list="r-cats" maxlength="40" placeholder="Manuales, Videos, Himnos, Juegos…"></label><datalist id="r-cats">${['Manuales', 'Videos', 'Himnos', 'Juegos', ...cats].filter((v, i, a) => a.indexOf(v) === i).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <button class="btn btn-primary btn-sm" style="justify-self:start"><i class="ti ti-plus"></i> Agregar</button></form>` : ''}
    ${cats.length ? cats.map((c) => `<div class="tipo-h"><i class="ti ti-folder"></i>${esc(c)}</div><div class="list">${list.filter((r) => (r.category || 'Otros') === c).map((r) => `<div class="row-item">
      <i class="ti ti-link" style="font-size:20px;color:var(--accent)"></i><div class="grow"><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title)}</b></a></div>
      ${editor ? `<button class="btn btn-sm btn-danger" data-delres="${r.id}" aria-label="Borrar enlace"><i class="ti ti-trash"></i></button>` : ''}</div>`).join('')}</div>`).join('') : '<div class="empty"><p>Todavía no hay recursos cargados.</p></div>'}`;
  if (!editor) return;
  $('#rf', main).onsubmit = async (e) => {
    e.preventDefault();
    const { error: err } = await sb.from('resources').insert({ title: clean($('#r-t', main).value), url: clean($('#r-u', main).value), category: clean($('#r-c', main).value) || null, created_by: S.email });
    if (err) return toast(errMsg(err));
    renderResources(main);
  };
  main.onclick = async (e) => {
    const b = e.target.closest('[data-delres]'); if (!b || !confirm('¿Borrar este enlace?')) return;
    const { error: err } = await sb.from('resources').delete().eq('id', b.dataset.delres);
    if (err) return toast(errMsg(err));
    renderResources(main);
  };
}

/* Mi perfil: nombre, teléfono y recordatorios */
async function renderProfile(main) {
  let prof = {};
  if (!S.offline) { const { data } = await sb.from('profiles').select('*').eq('email', S.email).maybeSingle(); prof = data || {}; }
  const remOn = localStorage.getItem(REM_KEY) === '1' && 'Notification' in window && Notification.permission === 'granted';
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  main.innerHTML = `<h2 class="page">Mi perfil</h2><p class="sub">${esc(S.email)} · ${esc(roleName(S.role))}</p>
    <form id="pff" class="panel ev-edit" style="padding:12px 16px">
      <h3 style="margin:0">Mis datos para el directorio</h3>
      <label>Nombre y apellido<input class="input" id="pf-n" maxlength="80" value="${esc(prof.name || '')}"></label>
      <label>Teléfono / WhatsApp<input class="input" id="pf-t" maxlength="30" inputmode="tel" value="${esc(prof.phone || '')}" placeholder="Ej.: 381 555-1234"></label>
      <button class="btn btn-primary btn-sm" style="justify-self:start" ${S.offline ? 'disabled' : ''}><i class="ti ti-device-floppy"></i> Guardar</button>
    </form>
    <div class="panel" style="padding:12px 16px">
      <h3 style="margin:0 0 6px">Recordatorios</h3>
      <p class="note" style="margin:0 0 10px">Te avisa 10 minutos antes de cada actividad${ROLE_COL[S.role] ? ' que te toca' : ''} y cuando llega un aviso nuevo. Funciona con la app abierta o en segundo plano; los avisos de coordinación llegan aunque la app esté cerrada.</p>
      ${perm === 'unsupported' ? '<p class="note">Este navegador no permite notificaciones.</p>' : perm === 'denied' ? '<p class="note">Las notificaciones están bloqueadas: habilitalas en los ajustes del navegador para esta página.</p>'
        : `<button class="btn btn-sm ${remOn ? '' : 'btn-primary'}" id="rem">${remOn ? '<i class="ti ti-bell-off"></i> Desactivar recordatorios' : '<i class="ti ti-bell-ringing"></i> Activar recordatorios'}</button>`}
    </div>`;
  $('#pff', main).onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('profiles').upsert({ email: S.email, name: clean($('#pf-n', main).value) || null, phone: clean($('#pf-t', main).value) || null, updated_at: new Date().toISOString() });
    toast(error ? (dbMissing(error) ? 'Falta activar el directorio (SQL 07).' : errMsg(error)) : 'Datos guardados');
  };
  if ($('#rem', main)) $('#rem', main).onclick = async () => {
    if (remOn) { localStorage.setItem(REM_KEY, '0'); toast('Recordatorios desactivados'); return renderProfile(main); }
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('No se dio permiso para notificaciones'); return renderProfile(main); }
    localStorage.setItem(REM_KEY, '1'); startReminders(); pushSubscribe(true); notify('Recordatorios activados', 'Te avisamos 10 minutos antes de cada actividad.');
    renderProfile(main);
  };
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

/* ---------- Notificaciones push de los avisos ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
// ask = true: pide permiso (solo desde un botón). false: se suscribe en silencio si ya hay permiso.
async function pushSubscribe(ask) {
  try {
    if (!S.vapid || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'granted') {
      if (!ask) return Notification.permission;
      if ((await Notification.requestPermission()) !== 'granted') return 'denied';
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // Si se crearon claves nuevas, la suscripción vieja ya no sirve: se rehace.
    if (sub && sub.options.applicationServerKey && b64u(sub.options.applicationServerKey) !== S.vapid) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(S.vapid) });
    const j = sub.toJSON();
    const { error } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
    return error ? 'error' : 'granted';
  } catch { return 'error'; }
}
// Solo la dueña: genera las claves de envío. La pública queda en la app; la privada se copia a Supabase.
async function genVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const pub = b64u(await crypto.subtle.exportKey('raw', k.publicKey));
  const priv = (await crypto.subtle.exportKey('jwk', k.privateKey)).d;
  return { pub, priv };
}

async function renderAccess(main) {
  await loadAccess().catch((e) => toast(errMsg(e)));
  main.innerHTML = `
    <h2 class="page">Accesos y ajustes</h2>
    <p class="sub">Solo vos ves esta sección. Las personas piden acceso desde la pantalla de ingreso; vos elegís a quién aceptar y con qué rol.</p>
    <div class="callout">El <b>rol</b> define qué datos ve cada persona. Para <b>consejeros</b> elegí también la estaca: verán solo a los participantes de esa estaca. Los <b>obispos</b> ven a los jóvenes cuyo correo de obispo coincide con el suyo.</div>
    <div class="panel" style="padding:12px 16px" id="vp">
      <h3 style="margin:0 0 6px"><i class="ti ti-bell-filled"></i> Notificaciones push de los avisos</h3>
      <p class="note" style="margin:0 0 8px">${S.vapid ? 'Ya hay claves creadas. Si perdiste la privada, creá claves nuevas y reemplazá las dos en Supabase → Edge Functions → Secrets.' : 'Tocá el botón para crear las claves de envío. Se hace una sola vez.'}</p>
      <button class="btn btn-sm ${S.vapid ? '' : 'btn-primary'}" id="vp-gen"><i class="ti ti-key"></i> ${S.vapid ? 'Crear claves nuevas' : 'Crear claves'}</button>
      <div id="vp-out"></div>
    </div>
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
        ${S.people.length ? '<button class="btn btn-ic" id="exp" aria-label="Exportar a Excel" title="Exportar a Excel"><i class="ti ti-file-spreadsheet"></i></button>' : ''}
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
        <div class="grow"><b>${esc(x.name || x.email)}</b><div class="note">${x.name ? esc(x.email) + ' · ' : ''}desde ${new Date(x.created_at).toLocaleDateString('es-AR')} · ${S.terms && S.terms[x.email] ? `<i class="ti ti-circle-check"></i> aceptó confidencialidad el ${new Date(S.terms[x.email]).toLocaleDateString('es-AR')}` : 'todavía no aceptó confidencialidad'}</div></div>
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
  if ($('#vp-gen', main)) $('#vp-gen', main).onclick = async () => {
    if (S.vapid && !confirm('¿Crear claves nuevas? Las anteriores dejan de servir y cada persona vuelve a quedar suscripta al abrir la app.')) return;
    let pub, priv;
    try { ({ pub, priv } = await genVapid()); } catch (e) { return toast('No se pudieron crear las claves en este navegador: ' + (e?.message || e) + '. Probá desde la computadora con Chrome.'); }
    const { error } = await sb.from('settings').upsert({ key: 'vapid_public', value: pub });
    if (error) return toast('No se pudo guardar la clave pública: ' + errMsg(error));
    S.vapid = pub;
    $('#vp-gen', main).remove();
    $('#vp-out', main).innerHTML = `<div class="callout" style="margin-top:8px">Copiá estas dos claves en Supabase → Edge Functions → Secrets. <b>La privada se muestra una sola vez y no se guarda en ningún lado</b>: no la mandes por chat.</div>
      ${[['VAPID_PUBLIC_KEY', pub], ['VAPID_PRIVATE_KEY', priv]].map(([n, v]) => `<div class="note" style="margin-top:8px"><b>${n}</b></div>
      <div class="form-inline" style="margin:4px 0"><textarea class="input" readonly rows="2" style="flex:1 1 220px;font-family:monospace;font-size:12px">${v}</textarea>
      <button class="btn btn-sm" data-copy="${v}"><i class="ti ti-copy"></i> Copiar</button></div>`).join('')}`;
    $('#vp-out', main).onclick = async (e) => {
      const b = e.target.closest('[data-copy]'); if (!b) return;
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copiada'); }
      catch { const t = b.previousElementSibling; t.select(); document.execCommand('copy'); toast('Copiada'); }
    };
    pushSubscribe(true);
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
