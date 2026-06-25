/**
 * Porra 2026 — Actualizador automático de resultados
 *
 * Lógica:
 * 1. Lee Firebase → encuentra el PRIMER partido sin resultado
 * 2. Recoge TODOS los partidos pendientes con la misma fecha y hora
 * 3. Busca esa fecha en football-data.org
 * 4. Por cada partido del lote: si está FINISHED → actualiza Firebase
 */

const https  = require('https');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');

const FD_API_KEY     = process.env.FD_API_KEY;
const FD_COMPETITION = 'WC'; // FIFA World Cup 2026 (id 2000)

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const ALL_MATCHES = require('./all_matches.json');

const TEAM_MAP = {
  'Mexico': 'Mexico', 'México': 'Mexico',
  'South Africa': 'Sudafrica',
  'South Korea': 'Corea del Sur', 'Korea Republic': 'Corea del Sur', 'Korea Rep.': 'Corea del Sur',
  'Czech Republic': 'Rep. Checa', 'Czechia': 'Rep. Checa', 'Czech Rep.': 'Rep. Checa',
  'Canada': 'Canada',
  'Bosnia and Herzegovina': 'Bosnia-Herz.', 'Bosnia & Herzegovina': 'Bosnia-Herz.',
  'Bosnia-Herzegovina': 'Bosnia-Herz.', 'Bosnia': 'Bosnia-Herz.',
  'Qatar': 'Qatar', 'Switzerland': 'Suiza',
  'Brazil': 'Brasil', 'Morocco': 'Marruecos', 'Haiti': 'Haiti', 'Scotland': 'Escocia',
  'United States': 'Estados Unidos', 'USA': 'Estados Unidos',
  'United States of America': 'Estados Unidos',
  'Paraguay': 'Paraguay', 'Australia': 'Australia',
  'Türkiye': 'Turquia', 'Turkey': 'Turquia', 'Turkiye': 'Turquia',
  'Germany': 'Alemania', 'Curaçao': 'Curazao', 'Curacao': 'Curazao',
  "Côte d'Ivoire": 'Costa de Marfil', 'Ivory Coast': 'Costa de Marfil',
  "Cote d'Ivoire": 'Costa de Marfil',
  'Ecuador': 'Ecuador', 'Netherlands': 'Paises Bajos',
  'Japan': 'Japon', 'Sweden': 'Suecia', 'Tunisia': 'Tunez',
  'Belgium': 'Belgica', 'Egypt': 'Egipto', 'Iran': 'Iran', 'IR Iran': 'Iran',
  'New Zealand': 'Nueva Zelanda', 'Spain': 'Espana', 'España': 'Espana',
  'Cape Verde': 'Cabo Verde', 'Saudi Arabia': 'Arabia Saudi', 'Uruguay': 'Uruguay',
  'France': 'Francia', 'Senegal': 'Senegal', 'Iraq': 'Irak', 'Norway': 'Noruega',
  'Argentina': 'Argentina', 'Algeria': 'Argelia', 'Austria': 'Austria', 'Jordan': 'Jordania',
  'Portugal': 'Portugal',
  'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo',
  'Democratic Republic of Congo': 'RD Congo',
  'Democratic Republic of the Congo': 'RD Congo',
  'Uzbekistan': 'Uzbekistan', 'Colombia': 'Colombia',
  'England': 'Inglaterra', 'Croatia': 'Croacia', 'Ghana': 'Ghana',
  'Panama': 'Panama', 'Panamá': 'Panama',
};

function mapTeam(name) {
  if (!name) return name;
  if (TEAM_MAP[name]) return TEAM_MAP[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(TEAM_MAP))
    if (k.toLowerCase() === lower) return v;
  for (const [k, v] of Object.entries(TEAM_MAP))
    if (lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) return v;
  console.warn(`  ⚠ Nombre no mapeado: "${name}" — añadir a TEAM_MAP`);
  return name;
}

function apiGet(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.football-data.org',
      path,
      headers: { 'X-Auth-Token': FD_API_KEY }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

const STAGE_MAP = {
  'ROUND_OF_16': 'd16', 'QUARTER_FINALS': 'qrt',
  'SEMI_FINALS': 'sem', 'THIRD_PLACE': 'ter', 'FINAL': 'fin',
};

async function main() {
  console.log('🔄 Porra 2026:', new Date().toISOString());

  // 1. Leer Firebase
  const stateDoc = await db.collection('estado').doc('resultados').get();
  if (!stateDoc.exists) { console.log('ℹ️ Sin estado en Firebase'); return; }
  const state      = stateDoc.data();
  const resultados = { ...(state.resultados  || {}) };
  const cuadroReal = { ...(state.cuadroReal  || {}) };

  // 2. Encontrar el primer partido sin resultado
  let firstPending = null;
  for (const m of ALL_MATCHES) {
    if (m.tipo === 'grupo') {
      const r = resultados[m.key];
      if (!r || r.l === null || r.l === undefined) { firstPending = m; break; }
    } else {
      const r = cuadroReal[m.key];
      if (r && r.eqL && (r.l === null || r.l === undefined)) { firstPending = m; break; }
    }
  }

  if (!firstPending) {
    console.log('🏆 ¡Torneo completado! Todos los partidos tienen resultado.');
    return;
  }

  // 3. Recoger TODOS los pendientes con la misma fecha y hora
  const sameFechaHora = m => m.fecha === firstPending.fecha && m.hora === firstPending.hora;

  const pendingBatch = ALL_MATCHES.filter(m => {
    if (!sameFechaHora(m)) return false;
    if (m.tipo === 'grupo') {
      const r = resultados[m.key];
      return !r || r.l === null || r.l === undefined;
    } else {
      const r = cuadroReal[m.key];
      return r && r.eqL && (r.l === null || r.l === undefined);
    }
  });

  console.log(`⏳ ${pendingBatch.length} partido(s) pendiente(s) el ${firstPending.fecha} a las ${firstPending.hora}:`);
  pendingBatch.forEach(m => {
    const label = m.tipo === 'grupo'
      ? `  Grupo ${m.g}: ${m.loc} vs ${m.vis}`
      : `  Eliminatoria: ${m.key}`;
    console.log(label);
  });

  // 4. Consultar football-data.org por esa fecha
  // Partidos a las 00:xx hora española son el día anterior en UTC (football-data.org usa UTC)
  const [day, month] = firstPending.fecha.split('/');
  const dateStr = `2026-${month}-${day}`;
  const hora = parseInt((firstPending.hora || '12:00').split(':')[0]);
  let dateFrom = dateStr;
  if (hora < 2) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() - 1);
    dateFrom = d.toISOString().slice(0, 10);
  }
  const url = `/v4/competitions/${FD_COMPETITION}/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateStr}`;
  console.log('\n📡 Consultando API:', url);

  let data;
  try { data = await apiGet(url); }
  catch(e) { console.error('❌ Error API:', e.message); process.exit(1); }

  if (data.message) { console.error('❌ API:', data.message); process.exit(1); }

  const finished = data.matches || [];
  console.log(`📋 Partidos terminados el ${dateStr}: ${finished.length}`);

  if (!finished.length) {
    console.log('⏰ Ningún partido ha terminado aún. Reintentando en la próxima ejecución.');
    return;
  }

  // Indexar partidos terminados por equipos para búsqueda rápida
  // Guardamos home y away mapeados para poder identificar cuál es loc y cuál vis
  const finishedByTeams = {};
  for (const fm of finished) {
    const home = mapTeam(fm.homeTeam.name);
    const away = mapTeam(fm.awayTeam.name);
    console.log(`  🔍 API partido: "${fm.homeTeam.name}"→"${home}" vs "${fm.awayTeam.name}"→"${away}"`);
    finishedByTeams[`${home}|${away}`] = { fm, home, away };
    finishedByTeams[`${away}|${home}`] = { fm, home, away };
  }

  // 5. Para cada partido del lote, buscar en los terminados y actualizar
  let updated = 0;

  for (const pending of pendingBatch) {
    let found = null;

    if (pending.tipo === 'grupo') {
      found = finishedByTeams[`${pending.loc}|${pending.vis}`]
           || finishedByTeams[`${pending.vis}|${pending.loc}`];
      // Fallback: búsqueda parcial por si el nombre mapeado difiere ligeramente
      if (!found) {
        const loc = pending.loc.toLowerCase();
        const vis = pending.vis.toLowerCase();
        for (const [k, v] of Object.entries(finishedByTeams)) {
          const [h, a] = k.split('|').map(s => s.toLowerCase());
          if ((h.includes(loc)||loc.includes(h)) && (a.includes(vis)||vis.includes(a))) {
            found = v;
            console.warn(`  ⚠ Match parcial: "${pending.loc}"~"${v.home}" vs "${pending.vis}"~"${v.away}"`);
            break;
          }
          if ((h.includes(vis)||vis.includes(h)) && (a.includes(loc)||loc.includes(a))) {
            found = v;
            console.warn(`  ⚠ Match parcial inv: "${pending.loc}"~"${v.away}" vs "${pending.vis}"~"${v.home}"`);
            break;
          }
        }
      }
    } else {
      const r = cuadroReal[pending.key];
      if (r && r.eqL) {
        found = finishedByTeams[`${r.eqL}|${r.eqV}`]
             || finishedByTeams[`${r.eqV}|${r.eqL}`];
      }
    }

    if (!found) {
      const label = pending.tipo === 'grupo'
        ? `${pending.loc} vs ${pending.vis}`
        : pending.key;
      console.log(`\n  ⏰ Aún no terminado: ${label}`);
      continue;
    }

    const { fm, home, away } = found;
    const homeGoals = fm.score.fullTime.home;
    const awayGoals = fm.score.fullTime.away;

    if (pending.tipo === 'grupo') {
      // Determinar cuál equipo de la API es loc y cuál vis
      // Comparar ambos sentidos para máxima robustez
      const normalOrder   = found.home === pending.loc && found.away === pending.vis;
      const invertedOrder = found.home === pending.vis && found.away === pending.loc;
      if (!normalOrder && !invertedOrder) {
        console.warn(`  ⚠ Orden incierto ${pending.key}: home="${found.home}" away="${found.away}" loc="${pending.loc}" vis="${pending.vis}" — usando home=loc`);
      }
      const locIsHome = normalOrder || !invertedOrder;
      const locGoals  = locIsHome ? homeGoals : awayGoals;
      const visGoals  = locIsHome ? awayGoals : homeGoals;
      resultados[pending.key] = { l: locGoals, v: visGoals };
      console.log(`\n  ✅ ${pending.key}: ${pending.loc} ${locGoals}-${visGoals} ${pending.vis}`);
      updated++;

    } else {
      const penHome = fm.score.penalties?.home ?? null;
      const penAway = fm.score.penalties?.away ?? null;
      // Identificar cuál equipo de la API es eqL y cuál eqV del cuadro real
      const r = cuadroReal[pending.key];
      const eqL = r?.eqL || '';
      const eqV = r?.eqV || '';
      const normalOrder   = found.home === eqL && found.away === eqV;
      const invertedOrder = found.home === eqV && found.away === eqL;
      if (!normalOrder && !invertedOrder) {
        console.warn(`  ⚠ No se pudo determinar orden para ${pending.key}: API home="${found.home}" away="${found.away}" vs cuadro eqL="${eqL}" eqV="${eqV}" — usando home=eqL`);
      }
      const locIsHome = normalOrder || (!invertedOrder);
      const locGoals  = locIsHome ? homeGoals : awayGoals;
      const visGoals  = locIsHome ? awayGoals : homeGoals;
      const locPen    = locIsHome ? penHome   : penAway;
      const visPen    = locIsHome ? penAway   : penHome;
      const winner    = locGoals > visGoals ? (locIsHome ? home : away)
                      : visGoals > locGoals ? (locIsHome ? away : home)
                      : locPen !== null ? (locPen > visPen ? (locIsHome ? home : away) : (locIsHome ? away : home))
                      : null;
      cuadroReal[pending.key] = {
        ...cuadroReal[pending.key],
        l: locGoals, v: visGoals,
        pl: locPen, pv: visPen, gan: winner
      };
      const penStr = penHome !== null ? ` (pen ${penHome}-${penAway})` : '';
      console.log(`\n  ✅ ${pending.key}: ${homeGoals}-${awayGoals}${penStr} gan=${winner}`);
      updated++;
    }
  }

  // 6. Guardar en Firebase si hay cambios
  if (updated > 0) {
    await db.collection('estado').doc('resultados').update({ resultados, cuadroReal });
    console.log(`\n✅ Firebase actualizado: ${updated} partido(s)`);

    // Build ranking from updated data
    const snapParts = await db.collection('participantes').get();
    const ranking = [];
    snapParts.forEach(doc => {
      const p = doc.data();
      let pts = 0;
      // Grupos
      Object.keys(p.grupos || {}).forEach(k => {
        const pr = p.grupos[k], r = resultados[k];
        if (!pr || !r || r.l === undefined || r.l === null) return;
        if (pr.l === r.l && pr.v === r.v) pts += 15;
        else if (Math.sign(pr.l - pr.v) === Math.sign(r.l - r.v)) pts += 5;
      });
      // Elim exact scores
      Object.keys(p.cuadro || {}).forEach(rid => {
        const pr = p.cuadro[rid], rr = cuadroReal[rid];
        if (!pr || !rr || pr.l === undefined || rr.l === undefined || rr.l === null) return;
        if (pr.l === rr.l && pr.v === rr.v) pts += 15;
        else if (Math.sign(pr.l - pr.v) === Math.sign(rr.l - rr.v)) pts += 5;
      });
      // Huecos
      const PTS_R = {d16:10, oct:15, qrt:20, sem:25, ter:30, fin:30};
      Object.keys(p.cuadro || {}).forEach(rid => {
        const pr = p.cuadro[rid], rr = cuadroReal[rid];
        if (!pr || !rr) return;
        const rk = rid.split('_')[0], h = PTS_R[rk] || 0;
        if (pr.eqL && rr.eqL && pr.eqL === rr.eqL) pts += h;
        if (pr.eqV && rr.eqV && pr.eqV === rr.eqV) pts += h;
      });
      // Specials
      const camp = (p.cuadro && p.cuadro['fin_f01'] && p.cuadro['fin_f01'].gan) || p.campeon || '';
      if (state.campeonReal && camp === state.campeonReal) pts += 35;
      if (state.balonReal && p.balon && p.balon.toLowerCase() === state.balonReal.toLowerCase()) pts += 25;
      if (state.goleadorReal && p.goleador && p.goleador.toLowerCase() === state.goleadorReal.toLowerCase()) pts += 25;
      if (state.golesReal != null && p.golesBota != null && p.golesBota === state.golesReal) pts += 30;
      ranking.push({ nombre: p.nick || p.nombre, pts });
    });
    ranking.sort((a, b) => b.pts - a.pts);
    // Assign positions handling ties
    let lastPts = null, lastPos = 0;
    ranking.forEach((item, i) => {
      if (item.pts !== lastPts) { lastPos = i + 1; lastPts = item.pts; }
      item.pos = lastPos;
    });

    // Build result string from updated matches
    const updatedMatch = pendingBatch.find(m => {
      if (m.tipo === 'grupo') return resultados[m.key];
      return cuadroReal[m.key] && cuadroReal[m.key].l != null;
    });
    let partidoLabel = '', resultadoStr = '';
    if (updatedMatch) {
      if (updatedMatch.tipo === 'grupo') {
        partidoLabel = `${updatedMatch.loc} vs ${updatedMatch.vis}`;
        const r = resultados[updatedMatch.key];
        resultadoStr = `${r.l} - ${r.v}`;
      } else {
        const r = cuadroReal[updatedMatch.key];
        partidoLabel = `${r.eqL} vs ${r.eqV}`;
        resultadoStr = `${r.l} - ${r.v}`;
      }
    }

    if (process.env.GMAIL_APP_PASSWORD && partidoLabel) {
      try {
        await enviarEmail(partidoLabel, resultadoStr, ranking);
      } catch(e) {
        console.error('⚠️ Error enviando email:', e.message);
      }
    }
  } else {
    console.log('\n⏰ Ningún partido del lote ha terminado aún.');
  }
}

main().catch(e => { console.error('❌ Error fatal:', e); process.exit(1); });

// ── EMAIL ─────────────────────────────────────────────────────────────────────
async function enviarEmail(partido, resultadoStr, ranking) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'benitocantero72@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
  });

  const N = ranking.length;
  const perCol = Math.ceil(N / 3);

  function initials(name) {
    return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
  }

  const COLORS = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#e67e22','#1abc9c','#f39c12','#e91e63','#00bcd4'];
  function color(nombre) {
    let h = 0; for (let c of nombre) h = (h*31 + c.charCodeAt(0)) & 0xffffff;
    return COLORS[Math.abs(h) % COLORS.length];
  }

  function buildColHtml(start, end) {
    return ranking.slice(start, end).map((p, i) => {
      const ri = start + i;
      const bg = ri % 2 === 0 ? '#f8f9fa' : '#ffffff';
      const medals = {0:'🥇', 1:'🥈', 2:'🥉'};
      const pos = medals[ri] || String(p.pos || ri+1);
      const bold = ri < 3 ? 'font-weight:600;' : '';
      const ini = initials(p.nombre);
      const col = color(p.nombre);
      return `<tr style="background:${bg}">
        <td style="padding:5px 6px;text-align:center;font-size:12px;color:#888;white-space:nowrap;width:28px">${pos}</td>
        <td style="padding:5px 6px;white-space:nowrap">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="width:22px;height:22px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;font-weight:600;flex-shrink:0">${ini}</div>
            <span style="font-size:11px;${bold}">${p.nombre}</span>
          </div>
        </td>
        <td style="padding:5px 6px;text-align:center;font-weight:600;color:#e8a020;font-size:13px;width:32px">${p.pts}</td>
      </tr>`;
    }).join('');
  }

  function colTable(start, end) {
    return `<table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:auto">
      <thead><tr style="background:#1E3A5F;color:#fff">
        <th style="padding:6px 8px;text-align:center;width:28px">#</th>
        <th style="padding:6px 8px;text-align:left">Participante</th>
        <th style="padding:6px 8px;text-align:center;width:32px">Pts</th>
      </tr></thead>
      <tbody>${buildColHtml(start, end)}</tbody>
    </table>`;
  }

  const fecha = new Date().toLocaleString('es-ES', {timeZone:'Europe/Madrid'});

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f0f2f5;margin:0;padding:12px">
<div style="max-width:820px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #ddd">
  <div style="background:#1E3A5F;padding:6px 14px;display:flex;align-items:center;justify-content:space-between">
    <span style="color:#e8a020;font-size:13px;font-weight:600">Porra Mundial 2026</span>
    <span style="color:#8ab4d8;font-size:11px">${fecha}</span>
  </div>
  <div style="background:#e8f5e9;border-left:3px solid #2e7d32;padding:6px 14px;display:flex;align-items:center;gap:14px">
    <span style="font-size:13px;font-weight:600;color:#1E3A5F">${partido}</span>
    <span style="font-size:15px;font-weight:700;color:#2e7d32;white-space:nowrap">${resultadoStr}</span>
  </div>
  <div style="padding:10px 10px 12px">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="width:33%;vertical-align:top;padding-right:3px">${colTable(0, perCol)}</td>
        <td style="width:33%;vertical-align:top;padding:0 3px">${colTable(perCol, perCol*2)}</td>
        <td style="width:33%;vertical-align:top;padding-left:3px">${colTable(perCol*2, N)}</td>
      </tr>
    </table>
  </div>
</div>
</body></html>`;

  await transporter.sendMail({
    from: '"Porra 2026 ⚽" <benitocantero72@gmail.com>',
    to: 'benitocantero72@gmail.com',
    subject: `⚽ ${partido} | ${resultadoStr} — Porra 2026`,
    html,
  });
  console.log('📧 Email enviado a benitocantero72@gmail.com');
}


