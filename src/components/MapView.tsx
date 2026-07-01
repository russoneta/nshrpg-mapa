import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { MapData, Pt, short } from '../lib/types';
import { centroid, edgeKey } from '../lib/graph';
import { buildWorld } from '../lib/worldgen';

export interface Api { fit: () => void; exportPNG: () => void; centerOn: (id: string) => void; }
interface Props {
  data: MapData;
  positions: Map<string, Pt>;
  paisColor: (id: string | null) => string;
  selected: string | null;
  hovered: string | null;
  path: string[] | null;
  frontier: Set<string>;
  realEdges: Set<string>;
  filterPais: string | null;
  searchHits: Set<string>;
  edicion: boolean;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onMoveNode: (id: string, pt: Pt, commit: boolean) => void;
  apiRef: React.MutableRefObject<Api | null>;
}

const INK = '#2e2718';
const GOLD = '#9a7b34';
// paleta del mapa (mar/tierra) — apagada, cartografica
const SEA = '#9fb2bd', LAND = '#c3cdae', COAST = '#7f8894', BORDER = '#8f97a0', LABEL_INK = '#3c4a52';
const REGION_OP = 0.55; // opacidad del color de pais sobre la tierra (apagado, no chillon)
const MOAT_W = 46;      // ancho (en unidades de mapa) del mar que rodea cada isla
const IMG_ON = 0.95, IMG_TINT = 0.34; // opacidad de la imagen de fondo del pais y del tinte de su color encima

// imagen de fondo por pais (archivo en public/img/paises/). Los que no estan usan color plano.
const PAIS_IMG: Record<string, string> = {
  'pais-del-fuego': 'pais-del-fuego.jpeg', 'pais-del-agua': 'pais-del-agua.webp', 'pais-del-rayo': 'pais-del-rayo.webp',
  'pais-de-la-lluvia': 'pais-de-la-lluvia.webp', 'pais-del-viento': 'pais-del-viento.webp', 'pais-de-la-tierra': 'pais-de-la-tierra.jpg',
  'pais-del-remolino': 'pais-del-remolino.webp', 'pais-de-la-nieve': 'pais-de-la-nieve.webp', 'pais-de-la-hierba': 'pais-de-la-hierba.webp',
  'pais-de-la-cascada': 'pais-de-la-cascada.webp', 'pais-de-las-llaves': 'pais-de-las-llaves.webp', 'pais-del-oso': 'pais-del-oso.webp',
  'pais-de-los-rios': 'pais-de-los-rios.jpeg', 'pais-del-hierro': 'pais-del-hierro.webp', 'pais-de-la-miel': 'pais-de-la-miel.jpeg',
  'pais-de-la-piedra': 'pais-de-la-piedra.jpeg', 'pais-del-arroz': 'pais-del-arroz.webp',
  'pais-de-las-aguas-termales': 'pais-de-las-aguas-termales.webp', 'pais-del-te': 'pais-del-te.webp',
};

export function MapView(props: Props) {
  const { data, positions, paisColor, selected, hovered, path, frontier, realEdges, filterPais, searchHits, edicion, onSelect, onHover, onMoveNode, apiRef } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<any>(null);
  const fitted = useRef(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 0.7 });
  const [grabbing, setGrabbing] = useState(false);

  const pathSet = useMemo(() => new Set(path || []), [path]);
  const pathEdges = useMemo(() => {
    const s = new Set<string>();
    if (path) for (let i = 0; i < path.length - 1; i++) { const a = path[i], b = path[i + 1]; s.add(a < b ? `${a}|${b}` : `${b}|${a}`); }
    return s;
  }, [path]);

  const edges = useMemo(() => {
    const seen = new Set<string>(); const out: [string, string][] = [];
    for (const id in data.rooms) for (const e of data.rooms[id].exits || []) {
      if (!e.to || !data.rooms[e.to]) continue;
      const key = edgeKey(id, e.to);
      if (!realEdges.has(key) || seen.has(key)) continue;
      seen.add(key); out.push([id, e.to]);
    }
    return out;
  }, [data, realEdges]);

  const world = useMemo(() => buildWorld(positions, data), [positions, data]);

  const fit = useCallback(() => {
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const pts = [...positions.values()]; if (!pts.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const pad = 90, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const k = Math.min(rect.width / w, rect.height / h, 1.4);
    if (!isFinite(k) || k <= 0) return;
    setView({ k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k });
  }, [positions]);

  const exportPNG = useCallback(() => {
    const xml = buildExportSVG(data, positions, paisColor);
    const img = new Image();
    img.onload = () => {
      const SC = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * SC; canvas.height = img.height * SC;
      const ctx = canvas.getContext('2d')!; ctx.scale(SC, SC); ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob); const a = document.createElement('a');
        a.href = url; a.download = 'mapa-nshrpg.png'; a.click(); URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }, [data, positions, paisColor]);

  const centerOn = useCallback((id: string) => {
    const p = positions.get(id); const svg = svgRef.current; if (!p || !svg) return;
    const rect = svg.getBoundingClientRect();
    setView((v) => { const k = Math.max(v.k, 1); return { k, x: rect.width / 2 - p.x * k, y: rect.height / 2 - p.y * k }; });
  }, [positions]);

  useEffect(() => { apiRef.current = { fit, exportPNG, centerOn }; }, [fit, exportPNG, centerOn, apiRef]);
  useEffect(() => {
    if (fitted.current || !positions.size) return;
    let raf = 0;
    const tryFit = () => {
      const svg = svgRef.current;
      if (svg && svg.clientWidth > 1 && svg.clientHeight > 1) { fitted.current = true; fit(); }
      else raf = requestAnimationFrame(tryFit);
    };
    raf = requestAnimationFrame(tryFit);
    return () => cancelAnimationFrame(raf);
  }, [positions, fit]);

  // wheel zoom (non-passive)
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 100; // líneas/páginas → px
      // zoom proporcional al movimiento (acompaña al trackpad) con tope por evento
      const factor = Math.min(2, Math.max(0.5, Math.exp(-dy * 0.005)));
      setView((v) => {
        const k = Math.min(4, Math.max(0.12, v.k * factor));
        const wx = (cx - v.x) / v.k, wy = (cy - v.y) / v.k;
        return { k, x: cx - wx * k, y: cy - wy * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDownBg = (e: React.PointerEvent) => {
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId); setGrabbing(true);
  };
  const onPointerDownNode = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (edicion) {
      drag.current = { type: 'node', id, sx: e.clientX, sy: e.clientY, moved: false, orig: { ...positions.get(id)! } };
    } else {
      // sin editar, arrastrar mueve el mapa y un click selecciona la sala
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false, sel: id };
      setGrabbing(true);
    }
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.type === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else onMoveNode(d.id, { x: d.orig.x + dx / view.k, y: d.orig.y + dy / view.k }, false);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; setGrabbing(false); if (!d) return;
    if (d.type === 'node') {
      if (d.moved) { const dx = e.clientX - d.sx, dy = e.clientY - d.sy; onMoveNode(d.id, { x: d.orig.x + dx / view.k, y: d.orig.y + dy / view.k }, true); }
      else onSelect(d.id);
    } else if (d.type === 'pan' && !d.moved) onSelect(d.sel ?? null);
  };

  // muestro solo las etiquetas que no se pisan con un nodo ni con otra ya puesta.
  // las resaltadas (seleccion, ruta, hover, busqueda) van siempre.
  const labelSet = useMemo(() => {
    const show = new Set<string>();
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const hits = (b: { x: number; y: number; w: number; h: number }) => {
      for (const o of placed) if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) return true;
      return false;
    };
    const rooms = Object.values(data.rooms);
    for (const r of rooms) { const p = positions.get(r.roomId); if (!p) continue; const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y; placed.push({ x: sx - 12, y: sy - 12, w: 24, h: 24 }); }
    const pr = (r: { roomId: string }) => (selected === r.roomId || pathSet.has(r.roomId) || hovered === r.roomId || searchHits.has(r.roomId) ? 0 : 1);
    const ordered = rooms.slice().sort((a, b) => pr(a) - pr(b));
    for (const r of ordered) {
      const p = positions.get(r.roomId); if (!p) continue;
      const hl = pr(r) === 0;
      if (!hl && view.k < 0.4) continue;
      const name = short(r.name);
      const w = name.length * (hl ? 6.6 : 5.9) + 8, h = 15;
      const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y + 22;
      const box = { x: sx - w / 2, y: sy - h / 2, w, h };
      if (hl || !hits(box)) { placed.push(box); show.add(r.roomId); }
    }
    return show;
  }, [data, positions, view, selected, hovered, pathSet, searchHits]);

  const matchPais = (pais: string | null) => (!filterPais ? true : filterPais === '__sin__' ? pais === null : pais === filterPais);
  const dimmed = (id: string) => !matchPais(data.rooms[id]?.pais ?? null);

  // relleno de una region: imagen de fondo (clipeada a la region) + tinte de su color (acento).
  // Sin imagen -> color plano.
  const renderRegion = (rg: { pid: string; d: string; color: string; bx: number; by: number; bw: number; bh: number }) => {
    const on = matchPais(rg.pid);
    const f = PAIS_IMG[rg.pid];
    if (!f) return <path key={'rg' + rg.pid} d={rg.d} fill={rg.color} fillOpacity={on ? REGION_OP : 0.12} stroke="none" style={{ pointerEvents: 'none' }} />;
    return (
      <g key={'rg' + rg.pid} clipPath={`url(#rgclip-${rg.pid})`} style={{ pointerEvents: 'none' }}>
        <image href={`img/paises/${f}`} x={rg.bx} y={rg.by} width={rg.bw} height={rg.bh} preserveAspectRatio="xMidYMid slice" opacity={on ? IMG_ON : 0.28} />
        <path d={rg.d} fill={rg.color} fillOpacity={on ? IMG_TINT : 0.1} stroke="none" />
      </g>
    );
  };

  return (
    <svg ref={svgRef} className={'map-svg' + (grabbing ? ' grabbing' : '')}
      onPointerDown={onPointerDownBg} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {/* --- capa de mundo: mar + tierra + regiones por pais + fronteras + costa + kanji --- */}
        <defs>
          <clipPath id="contclip"><path d={world.continent} /></clipPath>
          {world.regions.map((rg) => (PAIS_IMG[rg.pid] ? <clipPath key={'rc' + rg.pid} id={'rgclip-' + rg.pid}><path d={rg.d} /></clipPath> : null))}
        </defs>
        <rect x={world.seaRect.x} y={world.seaRect.y} width={world.seaRect.w} height={world.seaRect.h} fill={SEA} />
        <path d={world.land} fill={LAND} stroke="none" />
        {/* regiones del CONTINENTE (solo paises del continente, clipeadas al continente) */}
        <g clipPath="url(#contclip)">
          {world.regions.filter((rg) => !rg.island).map(renderRegion)}
        </g>
        <path d={world.borders} fill="none" stroke={BORDER} strokeWidth={1} strokeOpacity={0.7}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <path d={world.coast} fill="none" stroke={COAST} strokeWidth={1.2}
          strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {/* recorte: penínsulas sin sentido (sostenidas solo por salas de mar) se pintan como MAR */}
        {world.trimSea && <path d={world.trimSea} fill={SEA} stroke="none" />}
        {/* moat de MAR alrededor de cada isla + isla redibujada encima (solo SU region) */}
        {world.islands.map(({ pid, d }, i) => (
          <g key={'moat' + i}>
            <path d={d} fill="none" stroke={SEA} strokeWidth={MOAT_W * 2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={d} fill={LAND} stroke="none" />
            <clipPath id={'islclip' + i}><path d={d} /></clipPath>
            <g clipPath={`url(#islclip${i})`}>
              {world.regions.filter((rg) => rg.pid === pid).map(renderRegion)}
            </g>
            <path d={d} fill="none" stroke={COAST} strokeWidth={1.2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {world.kanji.map((k) => {
          const fs = Math.min(172, 52 + k.n * 3.6), on = matchPais(k.pid);
          return (
            <text key={'k' + k.pid} x={k.x} y={k.y} textAnchor="middle" dominantBaseline="central"
              fontFamily="'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP','Noto Sans JP',serif"
              fontSize={fs} fontWeight={700}
              fill={LABEL_INK} fillOpacity={on ? 0.5 : 0.14}
              paintOrder="stroke" stroke="#f3efe4" strokeOpacity={on ? 0.5 : 0.14} strokeWidth={fs * 0.05}
              style={{ pointerEvents: 'none' }}>{k.glyph}</text>
          );
        })}
        {/* aristas */}
        {edges.map(([a, b]) => {
          const pa = positions.get(a), pb = positions.get(b); if (!pa || !pb) return null;
          const onPath = pathEdges.has(a < b ? `${a}|${b}` : `${b}|${a}`);
          const dim = filterPais && dimmed(a) && dimmed(b);
          return <line key={a + b} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke={onPath ? GOLD : INK} strokeOpacity={onPath ? 1 : dim ? 0.12 : 0.32}
            strokeWidth={onPath ? 4 : 1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke"
            strokeDasharray={onPath ? '1 7' : undefined} className={onPath ? 'flow' : undefined} />;
        })}
        {/* nodos (tamaño constante en pantalla) */}
        {Object.values(data.rooms).map((r) => {
          const p = positions.get(r.roomId); if (!p) return null;
          const color = paisColor(r.pais);
          const sel = selected === r.roomId, onP = pathSet.has(r.roomId), hov = hovered === r.roomId, hit = searchHits.has(r.roomId);
          const isFront = edicion && frontier.has(r.roomId);
          const ring = sel ? GOLD : onP ? GOLD : hit ? GOLD : hov ? INK : null;
          const big = sel || onP || hov || hit || (!!filterPais && matchPais(r.pais));
          const op = filterPais && dimmed(r.roomId) ? 0.3 : 1;
          return (
            <g key={r.roomId} transform={`translate(${p.x} ${p.y}) scale(${1 / view.k})`} style={{ opacity: op, cursor: edicion ? 'grab' : 'pointer' }}
              onPointerDown={(e) => onPointerDownNode(e, r.roomId)}
              onPointerEnter={() => onHover(r.roomId)} onPointerLeave={() => onHover(null)}>
              {isFront && <circle r={18} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="2 3" opacity={0.8} />}
              {ring && <circle r={sel || onP ? 18 : 16} fill="none" stroke={ring} strokeWidth={sel ? 3 : 2.2} />}
              <circle r={sel || onP ? 12 : 9.5} fill={color} stroke={INK} strokeWidth={1.6} />
              {r.ee && edicion && <circle r={3} cx={8} cy={-8} fill="#6e40c9" stroke="#fff" strokeWidth={1} />}
              {labelSet.has(r.roomId) && (
                <text y={24} textAnchor="middle" fontFamily="Spectral, serif" fontSize={big ? 12.5 : 11}
                  fontWeight={big ? 600 : 400} fill={INK} paintOrder="stroke" stroke="rgba(243,235,215,0.92)" strokeWidth={3}
                  style={{ pointerEvents: 'none' }}>{short(r.name)}</text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// arma un svg suelto del mapa completo para bajarlo como png
function buildExportSVG(data: MapData, positions: Map<string, Pt>, paisColor: (id: string | null) => string): string {
  const pts = [...positions.values()];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const pad = 140; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const W = Math.round(maxX - minX), H = Math.round(maxY - minY);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX} ${minY} ${W} ${H}">`;
  s += `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#e7d8b4"/>`;
  // territorios
  const by = new Map<string, Pt[]>();
  for (const id in data.rooms) { const r = data.rooms[id]; if (!r.pais) continue; const p = positions.get(id); if (p) (by.get(r.pais) || by.set(r.pais, []).get(r.pais)!).push(p); }
  for (const id in data.rooms) { const r = data.rooms[id]; if (!r.pais) continue; const p = positions.get(id); if (p) s += `<circle cx="${p.x}" cy="${p.y}" r="92" fill="${paisColor(r.pais)}" fill-opacity="0.1"/>`; }
  for (const [pid, ps] of by) {
    const col = paisColor(pid), c = centroid(ps);
    const fs = Math.min(33, 18 + ps.length * 1.0);
    const nm = esc((data.paises[pid]?.nombre || '').replace(/^País (de la |de las |de los |del |de )?/, '').toUpperCase());
    s += `<text x="${c.x}" y="${c.y}" text-anchor="middle" dominant-baseline="middle" font-family="Georgia, serif" font-weight="600" font-size="${fs}" fill="${col}" fill-opacity="0.42" paint-order="stroke" stroke="#e7d8b4" stroke-width="${(fs * 0.1).toFixed(1)}" letter-spacing="${(fs * 0.13).toFixed(1)}">${nm}</text>`;
  }
  // aristas
  const seen = new Set<string>();
  for (const id in data.rooms) for (const e of data.rooms[id].exits || []) {
    if (!e.to || !data.rooms[e.to]) continue; const key = id < e.to ? `${id}|${e.to}` : `${e.to}|${id}`; if (seen.has(key)) continue; seen.add(key);
    const a = positions.get(id)!, b = positions.get(e.to)!; s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#2e2718" stroke-opacity="0.32" stroke-width="1.6"/>`;
  }
  // nodos
  for (const id in data.rooms) {
    const r = data.rooms[id], p = positions.get(id)!; const col = paisColor(r.pais);
    s += `<circle cx="${p.x}" cy="${p.y}" r="8" fill="${col}" stroke="#2e2718" stroke-width="1.4"/>`;
    s += `<text x="${p.x}" y="${p.y + 19}" text-anchor="middle" font-family="Georgia, serif" font-size="10.5" fill="#2e2718" paint-order="stroke" stroke="#e7d8b4" stroke-width="3">${esc(short(r.name))}</text>`;
  }
  s += `<text x="${minX + 30}" y="${maxY - 28}" font-family="Georgia, serif" font-size="26" fill="#2e2718" fill-opacity="0.6">Mapa del Mundo NSHRPG · ALPHA · by Take</text>`;
  s += '</svg>';
  return s;
}
