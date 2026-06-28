import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { MapData, Pt, NEUTRAL, short } from './lib/types';
import { computeLayout } from './lib/layout';
import { findPath, frontierRooms, realEdgeSet } from './lib/graph';
import { MapView, Api } from './components/MapView';
import { SidePanel } from './components/SidePanel';
import { Toolbar, Opt } from './components/Toolbar';
import { Legend, CountRow } from './components/Legend';
import { RouteModal } from './components/RouteModal';

const PIN_KEY = 'nshrpg_pins';

export function App() {
  const [data, setData] = useState<MapData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, Pt>>(new Map());
  const pinned = useRef<Map<string, Pt>>(undefined as any);
  if (pinned.current === undefined) pinned.current = loadPins();

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [edicion, setEdicion] = useState(false);
  const [filterPais, setFilterPais] = useState<string | null>(null);
  const [path, setPath] = useState<string[] | null>(null);
  const [pathResult, setPathResult] = useState<{ len: number } | 'none' | null>(null);
  const [routeFrom, setRouteFrom] = useState<string | null>(null);
  const [routeTo, setRouteTo] = useState<string | null>(null);
  const [showRoute, setShowRoute] = useState(false);
  const [searchHits, setSearchHits] = useState<Set<string>>(new Set());
  const api = useRef<Api | null>(null);

  useEffect(() => {
    fetch('map.json')
      .then((r) => { if (!r.ok) throw new Error('No se pudo cargar map.json'); return r.json(); })
      .then((d: MapData) => { setData(d); setPositions(computeLayout(d, pinned.current)); })
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  const paisColor = useCallback((id: string | null) => (id && data?.paises[id] ? data.paises[id].color : NEUTRAL), [data]);
  const frontier = useMemo(() => (data ? frontierRooms(data) : new Set<string>()), [data]);
  const realEdges = useMemo(() => (data ? realEdgeSet(data) : new Set<string>()), [data]);

  const counts = useMemo<CountRow[]>(() => {
    if (!data) return [];
    const m = new Map<string, number>(); let sin = 0;
    for (const id in data.rooms) { const pid = data.rooms[id].pais; if (pid) m.set(pid, (m.get(pid) || 0) + 1); else sin++; }
    const rows: CountRow[] = [...m.entries()]
      .map(([id, n]) => ({ id, nombre: data.paises[id]?.nombre || id, color: data.paises[id]?.color || NEUTRAL, n }))
      .sort((a, b) => b.n - a.n);
    if (sin) rows.push({ id: '__sin__', nombre: 'Sin país', color: NEUTRAL, n: sin });
    return rows;
  }, [data]);

  const { options, labelToId } = useMemo(() => {
    if (!data) return { options: [] as Opt[], labelToId: new Map<string, string>() };
    const nameCount = new Map<string, number>();
    for (const id in data.rooms) nameCount.set(data.rooms[id].name, (nameCount.get(data.rooms[id].name) || 0) + 1);
    const used = new Set<string>(); const opts: Opt[] = []; const map = new Map<string, string>();
    for (const id in data.rooms) {
      const r = data.rooms[id]; let label = short(r.name);
      if ((nameCount.get(r.name) || 0) > 1) { const pn = r.pais ? data.paises[r.pais]?.nombre : 'sin país'; label = `${short(r.name)} · ${pn}`; }
      while (used.has(label)) label = `${label} #${r.roomId.slice(-4)}`;
      used.add(label); opts.push({ id: r.roomId, label }); map.set(label, r.roomId);
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return { options: opts, labelToId: map };
  }, [data]);

  // busca aunque le falten tildes, mayusculas o el "NSHRPG -"
  const findRoom = useCallback((text: string): string | null => {
    if (!data || !text) return null;
    const t = text.trim();
    if (labelToId.has(t)) return labelToId.get(t)!;
    if (data.rooms[t]) return t;                                  // roomId exacto
    if (/^\d+$/.test(t)) { for (const id in data.rooms) if (id.includes(t)) return id; return null; } // ID parcial
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^nshrpg\s*-\s*/, '').trim();
    const q = norm(t); if (!q) return null;
    let starts: string | null = null, incl: string | null = null;
    for (const id in data.rooms) {
      const n = norm(data.rooms[id].name);
      if (n === q) return id;
      if (!starts && n.startsWith(q)) starts = id;
      if (!incl && n.includes(q)) incl = id;
    }
    return starts || incl;
  }, [data, labelToId]);

  const onMoveNode = useCallback((id: string, pt: Pt, commit: boolean) => {
    setPositions((prev) => new Map(prev).set(id, pt));
    if (commit) { pinned.current.set(id, pt); savePins(pinned.current); }
  }, []);

  const onJump = useCallback((id: string) => { setSelected(id); setSearchHits(new Set([id])); api.current?.centerOn(id); }, []);
  const onSelect = useCallback((id: string | null) => setSelected(id), []);

  // la ruta se calcula sola cuando hay origen y destino
  useEffect(() => {
    if (!data || !routeFrom || !routeTo) { setPath(null); setPathResult(null); return; }
    if (routeFrom === routeTo) { setPath([routeFrom]); setPathResult({ len: 1 }); return; }
    const pth = findPath(data, routeFrom, routeTo);
    if (pth) { setPath(pth); setPathResult({ len: pth.length }); }
    else { setPath(null); setPathResult('none'); }
  }, [data, routeFrom, routeTo]);

  const markOrigin = useCallback((id: string) => setRouteFrom((p) => (p === id ? null : id)), []);
  const markDest = useCallback((id: string) => setRouteTo((p) => (p === id ? null : id)), []);
  const onClearPath = useCallback(() => { setRouteFrom(null); setRouteTo(null); setShowRoute(false); }, []);

  const onReset = useCallback(() => {
    if (!data) return;
    pinned.current = new Map(); savePins(pinned.current);
    setPositions(computeLayout(data, pinned.current));
    setTimeout(() => api.current?.fit(), 0);
  }, [data]);

  if (err) return <div className="app"><div className="parchment" /><div className="scrim">⚠ {err}</div></div>;
  if (!data) return <div className="app"><div className="parchment" /><div className="scrim">Cargando mapa…</div></div>;

  const sel = selected ? data.rooms[selected] : null;
  const nPaises = counts.filter((c) => c.id && c.id !== '__sin__').length;
  const originName = routeFrom && data.rooms[routeFrom] ? short(data.rooms[routeFrom].name) : null;
  const destName = routeTo && data.rooms[routeTo] ? short(data.rooms[routeTo].name) : null;

  return (
    <div className="app">
      <div className="parchment" />
      <MapView data={data} positions={positions} paisColor={paisColor}
        selected={selected} hovered={hovered} path={path} frontier={frontier} realEdges={realEdges}
        filterPais={filterPais} searchHits={searchHits} edicion={edicion}
        onSelect={onSelect} onHover={setHovered} onMoveNode={onMoveNode} apiRef={api} />

      <div className="panel title-banner">
        <h1>Mundo NSHRPG <span className="alpha">ALPHA</span></h1>
        <div className="sub">{Object.keys(data.rooms).length} salas · {nPaises} países · by Take</div>
      </div>

      <div className="left-rail">
        <Toolbar edicion={edicion} setEdicion={setEdicion} options={options} findRoom={findRoom}
          onJump={onJump} pathResult={pathResult}
          originName={originName} destName={destName}
          onClearOrigin={() => setRouteFrom(null)} onClearDest={() => setRouteTo(null)} onClearPath={onClearPath}
          onShowRoute={() => setShowRoute(true)}
          onFit={() => api.current?.fit()} onPNG={() => api.current?.exportPNG()} onReset={onReset} />
        <Legend counts={counts} filterPais={filterPais} setFilterPais={setFilterPais} />
      </div>

      {sel && <SidePanel data={data} room={sel} paisColor={paisColor} edicion={edicion} realEdges={realEdges}
        onSelect={onSelect} onClose={() => setSelected(null)}
        onOrigin={markOrigin} onDest={markDest}
        isOrigin={routeFrom === sel.roomId} isDest={routeTo === sel.roomId} />}

      <div className="panel helpbar">{edicion ? 'Arrastrá una sala para acomodarla · ' : ''}arrastrá el fondo para mover · rueda para zoom</div>

      {showRoute && path && (
        <RouteModal data={data} path={path}
          onPick={(id) => { setShowRoute(false); onJump(id); }}
          onClose={() => setShowRoute(false)} />
      )}
    </div>
  );
}

function loadPins(): Map<string, Pt> {
  try {
    const j = JSON.parse(localStorage.getItem(PIN_KEY) || '{}');
    const m = new Map<string, Pt>(); for (const k in j) m.set(k, j[k]); return m;
  } catch { return new Map(); }
}
function savePins(m: Map<string, Pt>) {
  const o: Record<string, Pt> = {}; for (const [k, v] of m) o[k] = v;
  try { localStorage.setItem(PIN_KEY, JSON.stringify(o)); } catch { /* ignore */ }
}
