import { MapData, Pt, DIR_VEC } from './types';

const SP = 138;       // separacion del layout original (direcciones)
const ROOM_SP = 66;   // separacion interna al agrupar un pais
const CANON_PULL = 0.25; // empujon LEVE de cada pais hacia su lugar canonico (0 = nada)

// direccion canonica de cada pais respecto al de Fuego (centro), segun el mapa de Naruto
const CANON: Record<string, [number, number]> = {
  'País del Rayo': [0.7, -0.7], 'País del Agua': [1, 0], 'País del Viento': [-0.7, 0.7],
  'País de la Tierra': [-0.7, -0.7], 'País de la Lluvia': [-1, 0], 'País del Remolino': [1, 0],
  'País de la Hierba': [-0.8, -0.5], 'País de la Cascada': [0, -1], 'País de las Aguas Termales': [0.7, -0.7],
  'País de la Piedra': [-0.7, -0.7], 'País del Arroz': [0.2, -1], 'País del Té': [0, 1],
  'País de los Rios': [-0.9, 0.3],
  // Nieve queda sin ancla -> fija en su posicion de captura (decision de Take)
};

// Layout: usa el layout ORIGINAL por direcciones (no lo toca), pero junta las
// salas de cada pais en el lugar donde ya quedaron, con sus direcciones internas.
// Despues encoge todo uniforme (mantiene la disposicion, achica huecos) y separa
// solo lo minimo donde dos paises se encimen. No reubica ni recalcula nada.
export function computeLayout(data: MapData, pinned: Map<string, Pt>): Map<string, Pt> {
  const rooms = Object.values(data.rooms);
  const pos = new Map<string, Pt>();
  if (!rooms.length) return pos;

  const base = directedLayout(data);
  const cluster = assignClusters(data);
  const keys = [...new Set(cluster.values())];
  const members = new Map<string, string[]>();
  for (const [id, c] of cluster) (members.get(c) || members.set(c, []).get(c)!).push(id);

  const center = new Map<string, Pt>();
  const local = new Map<string, Map<string, Pt>>();
  const radius = new Map<string, number>();
  for (const c of keys) {
    const ids = members.get(c)!;
    let cx = 0, cy = 0; for (const id of ids) { const p = base.get(id)!; cx += p.x; cy += p.y; }
    center.set(c, { x: cx / ids.length, y: cy / ids.length });
    const lo = localLayout(data, cluster, c, ids);
    local.set(c, lo);
    let r = ROOM_SP * 0.7; for (const p of lo.values()) r = Math.max(r, Math.hypot(p.x, p.y));
    radius.set(c, r + ROOM_SP * 0.5);
  }

  // empujon LEVE de cada pais hacia su lugar canonico (solo traslada el cluster:
  // las direcciones INTERNAS de cada pais quedan intactas, solo cambian un toque las de entre paises)
  if (CANON_PULL > 0) {
    const fuegoId = keys.find((c) => data.paises[c]?.nombre === 'País del Fuego');
    if (fuegoId) {
      const fc = center.get(fuegoId)!;
      let R = 0, nn = 0; for (const c of keys) { if (c === fuegoId) continue; const p = center.get(c)!; R += Math.hypot(p.x - fc.x, p.y - fc.y); nn++; }
      R = nn ? R / nn : 400;
      for (const c of keys) {
        const canon = CANON[data.paises[c]?.nombre || ''];
        if (!canon) continue;
        const ax = fc.x + canon[0] * R, ay = fc.y + canon[1] * R, p = center.get(c)!;
        p.x = p.x * (1 - CANON_PULL) + ax * CANON_PULL;
        p.y = p.y * (1 - CANON_PULL) + ay * CANON_PULL;
      }
    }
  }

  // los paises SIN ancla canonica quedan FIJOS donde los puso tu captura;
  // el anti-solape solo mueve a los anclados para hacerles lugar.
  const fixed = (c: string) => !CANON[data.paises[c]?.nombre || ''];
  for (let it = 0; it < 130; it++) {
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const A = center.get(keys[i])!, B = center.get(keys[j])!;
      const dx = A.x - B.x, dy = A.y - B.y, d = Math.hypot(dx, dy) || 0.1;
      const mn = radius.get(keys[i])! + radius.get(keys[j])! + 16;
      if (d < mn) {
        const fi = fixed(keys[i]), fj = fixed(keys[j]);
        if (fi && fj) continue; // dos fijos: no se tocan
        const f = (mn - d) / d * (fi || fj ? 1 : 0.5);
        if (!fi) { A.x += dx * f; A.y += dy * f; }
        if (!fj) { B.x -= dx * f; B.y -= dy * f; }
      }
    }
  }

  for (const c of keys) {
    const ct = center.get(c)!, lo = local.get(c)!;
    for (const [id, p] of lo) pos.set(id, { x: ct.x + p.x, y: ct.y + p.y });
  }

  for (const [id, p] of pinned) if (data.rooms[id]) pos.set(id, { x: p.x, y: p.y });
  return pos;
}

// -- layout original por direcciones (BFS desde raiz fija + relajacion), sin pins --
function directedLayout(data: MapData): Map<string, Pt> {
  const rooms = Object.values(data.rooms);
  const pos = new Map<string, Pt>();
  const has = (id: string) => !!data.rooms[id];
  const ids = rooms.map((r) => r.roomId).sort((a, b) => +a - +b);
  pos.set(ids[0], { x: 0, y: 0 });
  const queue = [ids[0]];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi], p = pos.get(id)!, r = data.rooms[id]; let k = 0;
    for (const e of r.exits || []) {
      if (!e.to || !has(e.to) || pos.has(e.to)) continue;
      const v = e.dir ? DIR_VEC[e.dir] : { x: (k++ - 1) * 0.5, y: 1 };
      pos.set(e.to, { x: p.x + v.x * SP, y: p.y + v.y * SP }); queue.push(e.to);
    }
  }
  let u = 0; for (const r of rooms) if (!pos.has(r.roomId)) pos.set(r.roomId, { x: (u++ - 4) * SP, y: -SP * 7 });
  const allIds = [...pos.keys()], MIN = SP * 0.62;
  const edges: [string, string, Pt][] = [];
  for (const r of rooms) for (const e of r.exits || []) if (e.to && has(e.to) && e.dir) edges.push([r.roomId, e.to, DIR_VEC[e.dir]]);
  for (let it = 0; it < 90; it++) {
    for (const [a, b, v] of edges) {
      const pa = pos.get(a)!, pb = pos.get(b)!;
      const ex = pa.x + v.x * SP - pb.x, ey = pa.y + v.y * SP - pb.y;
      pb.x += ex * 0.1; pb.y += ey * 0.1; pa.x -= ex * 0.1; pa.y -= ey * 0.1;
    }
    for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) {
      const a = pos.get(allIds[i])!, b = pos.get(allIds[j])!;
      let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 0.02) { dx = Math.cos(i * 1.7 + j); dy = Math.sin(i * 1.7 + j); d2 = 1; }
      if (d2 < MIN * MIN) { const d = Math.sqrt(d2), f = (MIN - d) * 0.3 / d; a.x += dx * f; a.y += dy * f; b.x -= dx * f; b.y -= dy * f; }
    }
  }
  return pos;
}

// -- cada sala -> su pais; neutrales al pais vecino mayoritario --
function assignClusters(data: MapData): Map<string, string> {
  const cluster = new Map<string, string>();
  for (const id in data.rooms) { const p = data.rooms[id].pais; if (p) cluster.set(id, p); }
  const neutrals = Object.keys(data.rooms).filter((id) => !data.rooms[id].pais);
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const id of neutrals) {
      if (cluster.has(id)) continue;
      const votes = new Map<string, number>();
      for (const e of data.rooms[id].exits || []) if (e.to && cluster.has(e.to)) votes.set(cluster.get(e.to)!, (votes.get(cluster.get(e.to)!) || 0) + 1);
      if (votes.size) { let best = '', bv = -1; for (const [k, v] of votes) if (v > bv) { bv = v; best = k; } cluster.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  for (const id of neutrals) if (!cluster.has(id)) cluster.set(id, 'n_' + id);
  return cluster;
}

// -- layout local de un pais (direcciones internas), centrado en 0 --
function localLayout(data: MapData, cluster: Map<string, string>, c: string, ids: string[]): Map<string, Pt> {
  const local = new Map<string, Pt>();
  const seed = ids.slice().sort((a, b) => +a - +b)[0];
  local.set(seed, { x: 0, y: 0 });
  const q = [seed];
  for (let qi = 0; qi < q.length; qi++) {
    const id = q[qi], lp = local.get(id)!; let k = 0;
    for (const e of data.rooms[id].exits || []) {
      if (!e.to || cluster.get(e.to) !== c || local.has(e.to)) continue;
      const v = e.dir ? DIR_VEC[e.dir] : { x: (k++ - 1) * 0.5, y: 1 };
      local.set(e.to, { x: lp.x + v.x * ROOM_SP, y: lp.y + v.y * ROOM_SP }); q.push(e.to);
    }
  }
  let ui = 0; for (const id of ids) if (!local.has(id)) local.set(id, { x: (ui++ - 1) * ROOM_SP, y: -ROOM_SP });
  const lids = [...local.keys()];
  for (let it = 0; it < 70; it++) {
    for (const id of lids) for (const e of data.rooms[id].exits || []) {
      if (!e.to || cluster.get(e.to) !== c || !e.dir) continue;
      const pa = local.get(id)!, pb = local.get(e.to)!, v = DIR_VEC[e.dir];
      const ex = pa.x + v.x * ROOM_SP - pb.x, ey = pa.y + v.y * ROOM_SP - pb.y;
      pb.x += ex * 0.1; pb.y += ey * 0.1; pa.x -= ex * 0.1; pa.y -= ey * 0.1;
    }
    for (let i = 0; i < lids.length; i++) for (let j = i + 1; j < lids.length; j++) {
      const A = local.get(lids[i])!, B = local.get(lids[j])!;
      let dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy; const mn = ROOM_SP * 0.92;
      if (d2 < 0.02) { dx = Math.cos(i * 1.7 + j); dy = Math.sin(i * 1.7 + j); d2 = 1; } // coincidentes: separar en direccion fija
      if (d2 < mn * mn) { const d = Math.sqrt(d2), f = (mn - d) * 0.4 / d; A.x += dx * f; A.y += dy * f; B.x -= dx * f; B.y -= dy * f; }
    }
  }
  let cx = 0, cy = 0; for (const p of local.values()) { cx += p.x; cy += p.y; } cx /= local.size; cy /= local.size;
  for (const p of local.values()) { p.x -= cx; p.y -= cy; }
  return local;
}
