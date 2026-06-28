import { MapData, Pt } from './types';

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// una conexion cuenta si tiene direccion marcada de algun lado. las que no
// tienen direccion de ningun lado eran auto-conexiones de la captura, se ocultan.
export function realEdgeSet(data: MapData): Set<string> {
  const dir = new Map<string, boolean>();
  for (const id in data.rooms)
    for (const e of data.rooms[id].exits || []) {
      if (!e.to || !data.rooms[e.to]) continue;
      const k = edgeKey(id, e.to);
      if (!dir.has(k)) dir.set(k, false);
      if (e.dir) dir.set(k, true);
    }
  const real = new Set<string>();
  for (const [k, v] of dir) if (v) real.add(k);
  // si una sala se quedaria sin ninguna conexion (todas sin direccion), le dejo
  // esas conexiones asi no queda flotando aislada.
  const deg = new Map<string, number>();
  for (const id in data.rooms) deg.set(id, 0);
  for (const k of real) { const [a, b] = k.split('|'); deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); }
  for (const [k, v] of dir) {
    if (v) continue;
    const [a, b] = k.split('|');
    if (deg.get(a) === 0 || deg.get(b) === 0) {
      real.add(k);
      deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1);
    }
  }
  return real;
}

export function buildAdjacency(data: MapData): Map<string, string[]> {
  const real = realEdgeSet(data);
  const adj = new Map<string, string[]>();
  for (const id in data.rooms) adj.set(id, []);
  for (const id in data.rooms)
    for (const e of data.rooms[id].exits || [])
      if (e.to && data.rooms[e.to] && real.has(edgeKey(id, e.to))) adj.get(id)!.push(e.to);
  return adj;
}

// bfs entre dos salas, devuelve la ruta mas corta en saltos (o null si no hay)
export function findPath(data: MapData, from: string, to: string): string[] | null {
  if (!data.rooms[from] || !data.rooms[to]) return null;
  if (from === to) return [from];
  const adj = buildAdjacency(data);
  const prev = new Map<string, string>();
  const q = [from]; const seen = new Set([from]);
  while (q.length) {
    const x = q.shift()!;
    for (const y of adj.get(x) || []) {
      if (seen.has(y)) continue;
      seen.add(y); prev.set(y, x);
      if (y === to) {
        const path = [to]; let c = to;
        while (prev.has(c)) { c = prev.get(c)!; path.unshift(c); }
        return path;
      }
      q.push(y);
    }
  }
  return null;
}

export function frontierRooms(data: MapData): Set<string> {
  const s = new Set<string>();
  for (const id in data.rooms)
    if ((data.rooms[id].exits || []).some((e) => e.to === null)) s.add(id);
  return s;
}

// convex hull para dibujar las regiones de cada pais
export function convexHull(pts: Pt[]): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// centro de un grupo de puntos
export function centroid(pts: Pt[]): Pt {
  const c = { x: 0, y: 0 };
  for (const p of pts) { c.x += p.x; c.y += p.y; }
  return { x: c.x / pts.length, y: c.y / pts.length };
}
