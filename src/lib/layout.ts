import { MapData, Pt, DIR_VEC } from './types';

const SP = 138; // separacion base entre salas

// ubica las salas segun la direccion de cada salida (S abajo, N arriba, etc).
// bfs desde una raiz fija y despues relajacion. las que movi a mano quedan fijas.
export function computeLayout(data: MapData, pinned: Map<string, Pt>): Map<string, Pt> {
  const rooms = Object.values(data.rooms);
  const pos = new Map<string, Pt>();
  if (!rooms.length) return pos;
  const has = (id: string) => !!data.rooms[id];

  for (const [id, p] of pinned) if (has(id)) pos.set(id, { x: p.x, y: p.y });

  const ids = rooms.map((r) => r.roomId).sort((a, b) => +a - +b);
  if (!pos.size) pos.set(ids[0], { x: 0, y: 0 });

  // BFS dirigido desde las semillas ya ubicadas
  const queue = [...pos.keys()];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]; const p = pos.get(id)!; const r = data.rooms[id]; let k = 0;
    for (const e of r.exits || []) {
      if (!e.to || !has(e.to) || pos.has(e.to)) continue;
      const v = e.dir ? DIR_VEC[e.dir] : { x: (k++ - 1) * 0.5, y: 1 };
      pos.set(e.to, { x: p.x + v.x * SP, y: p.y + v.y * SP });
      queue.push(e.to);
    }
  }
  // las que no tienen camino dirigido van arriba, aparte
  let u = 0;
  for (const r of rooms) if (!pos.has(r.roomId)) pos.set(r.roomId, { x: (u++ - 4) * SP, y: -SP * 7 });

  // relaja: cada salida tira hacia su lado y las salas no se enciman
  const allIds = [...pos.keys()];
  const MIN = SP * 0.62;
  const edges: [string, string, Pt][] = [];
  for (const r of rooms) for (const e of r.exits || []) {
    if (e.to && has(e.to) && e.dir) edges.push([r.roomId, e.to, DIR_VEC[e.dir]]);
  }
  const fixed = (id: string) => pinned.has(id);
  for (let it = 0; it < 90; it++) {
    for (const [a, b, v] of edges) {
      const pa = pos.get(a)!, pb = pos.get(b)!;
      const ex = pa.x + v.x * SP - pb.x, ey = pa.y + v.y * SP - pb.y;
      if (!fixed(b)) { pb.x += ex * 0.1; pb.y += ey * 0.1; }
      if (!fixed(a)) { pa.x -= ex * 0.1; pa.y -= ey * 0.1; }
    }
    for (let i = 0; i < allIds.length; i++) for (let j = i + 1; j < allIds.length; j++) {
      const a = pos.get(allIds[i])!, b = pos.get(allIds[j])!;
      const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < MIN * MIN) {
        const d = Math.sqrt(d2) || 0.1, f = (MIN - d) * 0.3 / d;
        if (!fixed(allIds[i])) { a.x += dx * f; a.y += dy * f; }
        if (!fixed(allIds[j])) { b.x -= dx * f; b.y -= dy * f; }
      }
    }
  }
  return pos;
}
