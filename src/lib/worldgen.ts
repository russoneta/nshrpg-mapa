import { MapData, Pt } from './types';

// ============================================================================
// worldgen.ts — capa de FONDO estilo mapa (mar + tierra) a partir de las
// posiciones ya calculadas. NO mueve ningun nodo: lee posiciones y devuelve
// paths SVG en coordenadas de mapa. Se calcula una sola vez (memo).
//
// Tecnica: campo de distancia (union de discos del GRAFO: nodos + aristas) sobre
// una grilla -> marching squares con orientacion GEOMETRICA (tierra a la
// izquierda -> encadenado consistente) -> suavizado Chaikin + Catmull-Rom.
// El continente y cada pais-ISLA se generan en pasadas SEPARADAS (la isla no
// recibe las aristas hacia el continente) -> se desprenden con estrecho de mar.
// ============================================================================

const PAD = 170;             // margen de mar alrededor de la tierra
const CELL = 16;             // tamaño de celda de la grilla
const R_MAIN = 115;          // radio de tierra del continente (bloque solido)
const R_ISLAND = 66;         // radio de tierra de cada pais-isla (compacto y separado)
const MOAT_CELLS = 4;        // la costa del continente se aleja esta cantidad de celdas de la tierra
                             // de las islas -> franja de mar limpia (sin peninsulas asomando)
const MIN_ISLAND_CELLS = 90; // componente mas chico que esto se descarta (sliver)
const CLIP_SHRINK_CELLS = 2; // erosion del disco de isla para el clip del continente (deja anillo de moat)
const WORLD_SEA_CELLS = 12;  // radio (en celdas) del OCEANO que rodea al mundo entero (continente +
                             // islas): aguada de agua que unifica el mapa sobre el fondo y cubre
                             // los estrechos de las islas hasta las costas vecinas
const RIPPLE_CELLS = [2, 5, 8]; // anillos de tinta concentricos alrededor de la costa (estilo mapa
                             // japones/mangaka): contornos de la tierra visible dilatada k celdas

// paises que canonicamente son ISLAS (se dibujan como masa separada en el mar)
const ISLAND_NOMBRES = new Set<string>(['País del Agua', 'País del Remolino']);

export interface Region { pid: string; d: string; bd: string; color: string; cx: number; cy: number; n: number; island: boolean; bx: number; by: number; bw: number; bh: number }
export interface Kanji { pid: string; x: number; y: number; glyph: string; n: number }
export interface World {
  seaRect: { x: number; y: number; w: number; h: number };
  land: string;        // continente + islas (relleno base sage)
  continent: string;   // solo el continente (clip de las regiones del continente)
  trimSea: string;     // penínsulas "sin sentido" (tierra sostenida solo por salas de mar) -> se dibujan como mar
  landMask: string;    // banda de TIERRA CON DUEÑO dilatada MOAT_CELLS -> clip de los bordes interiores para que ningun trazo flote lejos de la tierra real
  ocean: { d: string; x: number; y: number; w: number; h: number }; // aguada de OCEANO que rodea al mundo entero (dilate de la tierra VISIBLE, WORLD_SEA_CELLS) + bbox para las olas
  ripples: string[];   // anillos de tinta concentricos alrededor de la costa visible (RIPPLE_CELLS), del mas cercano al mas lejano
  coastVis: string;    // contorno de la tierra VISIBLE (dilate 0): la aguada de acuarela lo entinta como trazo difuminado
  waves: { x: number; y: number; s: number; a: number; fl: number; t: number; g: number }[]; // glifos de ola mangaka dispersos: centro, escala, rotacion (grados), flip, tipo (0 oleaje/1 cresta con rulo), grupo de fase 0..3
  islands: { pid: string; d: string; clipD: string; moatClip: string }[]; // cada isla: pais + path completo (d) + erosionado (clipD) + dilatado MOAT_CELLS (moatClip, disco del moat — ahora AGUJERO real via mask)
  coast: string;       // contorno completo, para el trazo de costa
  regions: Region[];   // relleno por pais
  borders: string;     // fronteras internas entre paises (lineas finas)
  kanji: Kanji[];      // etiquetas grandes por region
}

// --- kanji por pais (normalizado, sin tildes ni "País del ...") ---
const KANJI_BY_NAME: Record<string, string> = {
  'fuego': '火', 'agua': '水', 'tierra': '土', 'viento': '風', 'rayo': '雷',
  'nieve': '雪', 'piedra': '岩', 'olas': '波', 'sonido': '音', 'hierba': '草',
  'cascada': '滝', 'aguas termales': '湯', 'lluvia': '雨', 'remolino': '渦',
  'arroz': '田', 'te': '茶', 'rios': '川', 'miel': '蜜', 'oso': '熊',
  'llaves': '鍵', 'hierro': '鉄',
};
function normalizePais(nombre: string): string {
  return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^pais\s+(de la |de las |de los |del |de )?/, '').trim();
}
export function kanjiFor(nombre: string): string {
  const k = KANJI_BY_NAME[normalizePais(nombre)];
  if (k) return k;
  const cjk = nombre.match(/[　-鿿]/);
  if (cjk) return cjk[0];
  const n = normalizePais(nombre);
  return n ? n[0].toUpperCase() : '?';
}
export const KANJI = KANJI_BY_NAME;

const EMPTY: World = { seaRect: { x: 0, y: 0, w: 0, h: 0 }, land: '', continent: '', trimSea: '', landMask: '', ocean: { d: '', x: 0, y: 0, w: 0, h: 0 }, ripples: [], coastVis: '', waves: [], islands: [], coast: '', regions: [], borders: '', kanji: [] };

interface RoomPt { x: number; y: number; pais: string | null; sea: boolean }
interface Seg { ax: number; ay: number; bx: number; by: number }

// una sala "Mar" es MAR: no debe generar tierra en el continente
const isSeaRoom = (name: string, pais: string | null) => !pais && name.replace(/^NSHRPG\s*-\s*/i, '').trim().toLowerCase() === 'mar';

export function buildWorld(positions: Map<string, Pt>, data: MapData): World {
  const pts: RoomPt[] = [];
  const seaSet = new Set<string>(); // ids de salas "Mar" (mar, no tierra)
  for (const [id, p] of positions) { const r = data.rooms[id]; if (!r) continue; const sea = isSeaRoom(r.name, r.pais || null); if (sea) seaSet.add(id); pts.push({ x: p.x, y: p.y, pais: r.pais || null, sea }); }
  if (pts.length < 3) return EMPTY;

  const roomCount = new Map<string, number>();
  for (const p of pts) if (p.pais) roomCount.set(p.pais, (roomCount.get(p.pais) || 0) + 1);

  // ids de paises-isla
  const islandIds = new Set<string>();
  for (const pid in data.paises) if (ISLAND_NOMBRES.has(data.paises[pid].nombre)) islandIds.add(pid);
  const groupOf = (pais: string | null) => (pais && islandIds.has(pais) ? pais : '__main__');

  // bbox + grilla
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const x0 = minX - PAD, y0 = minY - PAD, x1 = maxX + PAD, y1 = maxY + PAD;
  const cols = Math.ceil((x1 - x0) / CELL) + 1, rows = Math.ceil((y1 - y0) / CELL) + 1;
  const cc = cols - 1, cr = rows - 1;
  const gx = (i: number) => x0 + i * CELL, gy = (j: number) => y0 + j * CELL;

  // nodos y aristas por GRUPO (aristas solo intra-grupo -> las islas se sueltan)
  const groupPts = new Map<string, RoomPt[]>();
  for (const p of pts) { const g = groupOf(p.pais); (groupPts.get(g) || groupPts.set(g, []).get(g)!).push(p); }
  const groupSegs = new Map<string, Seg[]>();
  for (const [id, p] of positions) {
    const r = data.rooms[id]; if (!r) continue;
    for (const e of r.exits || []) {
      if (!e.to || e.to <= id) continue; const q = positions.get(e.to); if (!q) continue;
      const g1 = groupOf(r.pais), g2 = groupOf(data.rooms[e.to]?.pais || null);
      if (g1 !== g2) continue; // arista entre grupos: no tiende tierra (queda mar)
      (groupSegs.get(g1) || groupSegs.set(g1, []).get(g1)!).push({ ax: p.x, ay: p.y, bx: q.x, by: q.y });
    }
  }

  // --- tierra: una pasada por grupo (continente con R_MAIN, islas con R_ISLAND) ---
  let landD = '', continentD = '';
  const cellLand = new Uint8Array(cc * cr); // union global de tierra (para regiones/fronteras/clip)
  const cellGroup: (string | null)[] = new Array(cc * cr).fill(null); // a que masa (continente/isla) pertenece cada celda
  const islandGroups = [...groupPts.keys()].filter((g) => g !== '__main__');
  const islandInfo: { pid: string; d: string; clipD: string; moatClip: string }[] = []; // pais + d + clipD + moatClip
  const islandCellMask = new Uint8Array(cc * cr);

  // 1) ISLAS primero (para saber donde hay que cavar el mar del continente).
  //    Suman aristas de cercania (MST) para que TODAS sus salas queden en una sola masa.
  for (const g of islandGroups) {
    const gp = groupPts.get(g)!;
    const segs = [...(groupSegs.get(g) || []), ...mstSegs(gp)];
    const field = computeField(gp, segs, x0, y0, cols, rows, CELL);
    const res = traceLand(field, R_ISLAND, cols, rows, cc, cr, x0, y0, CELL, 2, null, 0, true);
    // isla erosionada (para el clip del continente): al meterla en #contclip en vez de la isla
    // completa, el relleno del vecino se retrae ~CLIP_SHRINK_CELLS y reaparece el anillo de mar (moat)
    let shrunk = erode(res.cellLand, cc, cr, CLIP_SHRINK_CELLS);
    let anyShrunk = false; for (let s = 0; s < cc * cr; s++) if (shrunk[s]) { anyShrunk = true; break; }
    if (!anyShrunk) shrunk = res.cellLand; // isla muy chica: usar disco completo (no rompe, solo pierde ese moat)
    const moatMask = dilate(res.cellLand, cc, cr, MOAT_CELLS); // disco de la isla + MOAT_CELLS -> anillo de mar de ancho fijo
    landD += res.d; islandInfo.push({ pid: g, d: res.d, clipD: maskToPath(shrunk, cc, cr, gx, gy), moatClip: maskToPath(moatMask, cc, cr, gx, gy) });
    for (let s = 0; s < cc * cr; s++) if (res.cellLand[s]) { cellLand[s] = 1; cellGroup[s] = g; islandCellMask[s] = 1; }
  }

  // 2) CONTINENTE. (Se probo cavar el mar del moat en el field para separar mas las islas, pero
  //    cavar el field rompia el encadenado del marching squares y desaparecia gran parte del
  //    continente. El moat de mar alrededor de cada isla lo dibuja el overlay en MapView.)
  {
    const gp = groupPts.get('__main__')!;
    const field = computeField(gp, groupSegs.get('__main__') || [], x0, y0, cols, rows, CELL);
    const res = traceLand(field, R_MAIN, cols, rows, cc, cr, x0, y0, CELL, 3, null, 0, false);
    landD += res.d; continentD = res.d;
    for (let s = 0; s < cc * cr; s++) if (res.cellLand[s] && cellGroup[s] === null) { cellLand[s] = 1; cellGroup[s] = '__main__'; }
  }

  // --- dueño por celda = pais de la sala NO-neutral mas cercana DEL MISMO GRUPO (isla o continente).
  // Se calcula ANTES del trimSea para que el recorte no se coma territorio de ningun pais.
  const namedByGroup = new Map<string, RoomPt[]>();
  for (const [g, gp] of groupPts) namedByGroup.set(g, gp.filter((p) => p.pais));
  const cellOwner: (string | null)[] = new Array(cc * cr).fill(null);
  for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
    const s = cj * cc + ci; if (!cellLand[s]) continue;
    const g = cellGroup[s]; const rooms = g ? namedByGroup.get(g) : null;
    if (!rooms || !rooms.length) continue;
    const px = gx(ci) + CELL / 2, py = gy(cj) + CELL / 2;
    let best = Infinity, bo: string | null = null;
    for (const p of rooms) { const dx = p.x - px, dy = p.y - py, d = dx * dx + dy * dy; if (d < best) { best = d; bo = p.pais; } }
    cellOwner[s] = bo;
  }
  despeckle(cellOwner, cellLand, cc, cr, 70); // manchitas de un pais rodeadas por otro -> vecino mayoritario

  // --- recorte de RENDER: penínsulas "sin sentido" = tierra del continente sostenida SOLO por
  // salas de mar (a mas de R_MAIN de TODO pais y sus aristas pais-pais). NO toca el trazado de
  // tierra (seguro, sin fragmentar); se dibujan como MAR encima al renderizar.
  let trimD = '';
  let orphanDG: Uint8Array | null = null; // hoisted: lo usa el oceano/ripples (tierra VISIBLE = cellLand - orphanD)
  {
    // fuentes de tierra "de verdad" = todo lo del continente MENOS las salas "Mar" (paises y
    // neutrales de tierra como Bosque/Camino/Puente cuentan). Lo que quede tierra a mas de R_MAIN
    // de todo esto esta sostenido SOLO por salas de mar -> peninsula sin sentido.
    const landSrcPts = pts.filter((p) => !p.sea && groupOf(p.pais) === '__main__');
    const landSrcSegs: Seg[] = [];
    for (const [id, p] of positions) {
      const r = data.rooms[id]; if (!r || seaSet.has(id) || groupOf(r.pais) !== '__main__') continue;
      for (const e of r.exits || []) {
        if (!e.to || e.to <= id || seaSet.has(e.to)) continue; const q = positions.get(e.to); if (!q) continue;
        if (groupOf(data.rooms[e.to]?.pais || null) !== '__main__') continue;
        landSrcSegs.push({ ax: p.x, ay: p.y, bx: q.x, by: q.y });
      }
    }
    const dpf = computeField(landSrcPts, landSrcSegs, x0, y0, cols, rows, CELL); // distancia a tierra "de verdad"
    // guarda geometrica: no recortar cerca de islas (evita que el trim muerda la costa del vecino del
    // estrecho). Reemplaza la vieja guarda por-dueño (que hacia inmunes a las peninsulas espurias).
    const ISLAND_TRIM_GUARD = MOAT_CELLS; // solo el moat inmediato; no proteger penínsulas espurias lejos de la isla
    const islandNear = dilate(islandCellMask, cc, cr, ISLAND_TRIM_GUARD);
    const orphan = new Uint8Array(cc * cr);
    for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
      if (!cellLand[cj * cc + ci] || cellGroup[cj * cc + ci] !== '__main__' || islandNear[cj * cc + ci]) continue;
      if (dpf[cj * cols + ci] > R_MAIN && dpf[cj * cols + ci + 1] > R_MAIN && dpf[(cj + 1) * cols + ci] > R_MAIN && dpf[(cj + 1) * cols + ci + 1] > R_MAIN) orphan[cj * cc + ci] = 1;
    }
    const orphanD = dilate(orphan, cc, cr, 3); // margen extra: tapa el ensanche del Catmull-Rom de world.land
    orphanDG = orphanD;
    // Las celdas que el render pinta como MAR pierden su DUEÑO: (a) huerfanas + margen dilatado
    // (trimSea), y (b) el collar del moat de las islas (islandNear = dilate(isla, MOAT_CELLS), que
    // el overlay moatband tapa con mar; solo celdas del CONTINENTE — la tierra propia de la isla
    // conserva su dueño). El Voronoi se las asignaba al pais con la sala mas cercana CRUZANDO EL
    // AGUA (la tierra la generan las salas "Mar" neutrales), y entonces bd / landMask / fronteras
    // trazaban anillos alrededor de tierra invisible en pleno estrecho -> las "lineas sueltas".
    // Sin dueño, el contorno bd retrocede exactamente al borde visible del mapa.
    for (let s = 0; s < cc * cr; s++) {
      if (!cellOwner[s]) continue;
      if (orphanD[s] || (islandNear[s] && cellGroup[s] === '__main__')) cellOwner[s] = null;
    }
    const O = (a: number, b: number) => (a < 0 || b < 0 || a >= cc || b >= cr ? 0 : orphanD[b * cc + a]);
    const edges: [number, number, number, number][] = [];
    for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
      if (!orphanD[cj * cc + ci]) continue;
      if (!O(ci - 1, cj)) edges.push([ci, cj, ci, cj + 1]);
      if (!O(ci + 1, cj)) edges.push([ci + 1, cj, ci + 1, cj + 1]);
      if (!O(ci, cj - 1)) edges.push([ci, cj, ci + 1, cj]);
      if (!O(ci, cj + 1)) edges.push([ci, cj + 1, ci + 1, cj + 1]);
    }
    for (let ring of chainVertexRings(edges)) {
      ring = ring.map((v) => ({ x: gx(v.x), y: gy(v.y) }));
      ring = cleanRing(ring); if (ring.length < 3) continue;
      ring = chaikinClosed(ring, 2); trimD += catmullClosedPath(ring);
    }
  }


  // --- regiones por pais (traza el borde del conjunto de celdas del pais) ---
  const regions: Region[] = [];
  const kanji: Kanji[] = [];
  const paisCells = new Map<string, number[]>();
  for (let s = 0; s < cc * cr; s++) { const o = cellOwner[s]; if (o) (paisCells.get(o) || paisCells.set(o, []).get(o)!).push(s); }
  const moatZone = dilate(islandCellMask, cc, cr, MOAT_CELLS); // corredor de mar del estrecho: las regiones no se derraman ahi
  for (const [P, cells] of paisCells) {
    // extiendo la region hacia el MAR (no hacia otros paises): asi el relleno (recortado al
    // continente) llega a la costa sin hueco, y el borde de costa (world.continent ∩ region) la cubre.
    const dmask = new Uint8Array(cc * cr);
    for (const s of cells) dmask[s] = 1;
    // dilato hasta ALCANZAR el contorno inflado del continente (R_MAIN=115): el dilate es 4-conexo,
    // asi que en los rincones convexos/diagonales llega solo ~n*11u (no n*16u). Con 8 iters daba ~90u
    // < 115 -> rg.d se quedaba corto de la costa y la costa quedaba sin borde de color (Nieve-arriba,
    // Rayo-abajo, Fuego-SE). 11 iters ~= 124u >= 115 -> rg.d toca la costa y piece(1) la delinea.
    // Los guards de abajo (moatZone + celda de otro pais) siguen limitando: solo crece hacia MAR abierto.
    for (let it = 0; it < 11; it++) {
      const nxt = dmask.slice();
      for (let s = 0; s < cc * cr; s++) {
        if (dmask[s]) continue;
        if (moatZone[s]) continue; // no invadir islas NI su corredor de moat (evita el derrame por el estrecho)
        if (cellLand[s] && cellOwner[s] && cellOwner[s] !== P) continue; // celda de otro pais: no invadir
        const ci = s % cc, cj = (s - ci) / cc;
        if ((ci > 0 && dmask[s - 1]) || (ci < cc - 1 && dmask[s + 1]) || (cj > 0 && dmask[s - cc]) || (cj < cr - 1 && dmask[s + cc])) nxt[s] = 1;
      }
      dmask.set(nxt);
    }
    const inDP = (ci: number, cj: number) => ci >= 0 && cj >= 0 && ci < cc && cj < cr && dmask[cj * cc + ci] === 1;
    const edges: [number, number, number, number][] = [];
    let sx = 0, sy = 0;
    for (const s of cells) { const ci = s % cc, cj = (s - ci) / cc; sx += gx(ci) + CELL / 2; sy += gy(cj) + CELL / 2; }
    let bxMin = Infinity, byMin = Infinity, bxMax = -Infinity, byMax = -Infinity;
    for (let s = 0; s < cc * cr; s++) {
      if (!dmask[s]) continue; const ci = s % cc, cj = (s - ci) / cc;
      const px = gx(ci), py = gy(cj);
      if (px < bxMin) bxMin = px; if (px + CELL > bxMax) bxMax = px + CELL; if (py < byMin) byMin = py; if (py + CELL > byMax) byMax = py + CELL;
      if (!inDP(ci - 1, cj)) edges.push([ci, cj, ci, cj + 1]);
      if (!inDP(ci + 1, cj)) edges.push([ci + 1, cj, ci + 1, cj + 1]);
      if (!inDP(ci, cj - 1)) edges.push([ci, cj, ci + 1, cj]);
      if (!inDP(ci, cj + 1)) edges.push([ci, cj + 1, ci + 1, cj + 1]);
    }
    let d = '';
    for (let ring of chainVertexRings(edges)) {
      ring = ring.map((v) => ({ x: gx(v.x), y: gy(v.y) }));
      ring = cleanRing(ring);
      if (ring.length < 3) continue;
      // mismo suavizado que el continente (chaikin 3) para que la costa de la region coincida
      // con la del continente y no deje asomar la base en la orilla.
      ring = chaikinClosed(ring, 3);
      d += catmullClosedPath(ring);
    }
    if (!d) continue;
    // contorno REAL del pais desde sus celdas SIN dilatar (costa + fronteras): es el borde
    // verdadero, no depende del clip al continente ni de world.coast -> ningun pais se queda sin borde
    const omask = new Uint8Array(cc * cr);
    for (const s of cells) omask[s] = 1;
    const inOM = (ci: number, cj: number) => ci >= 0 && cj >= 0 && ci < cc && cj < cr && omask[cj * cc + ci] === 1;
    const bedges: [number, number, number, number][] = [];
    for (const s of cells) {
      const ci = s % cc, cj = (s - ci) / cc;
      if (!inOM(ci - 1, cj)) bedges.push([ci, cj, ci, cj + 1]);
      if (!inOM(ci + 1, cj)) bedges.push([ci + 1, cj, ci + 1, cj + 1]);
      if (!inOM(ci, cj - 1)) bedges.push([ci, cj, ci + 1, cj]);
      if (!inOM(ci, cj + 1)) bedges.push([ci, cj + 1, ci + 1, cj + 1]);
    }
    let bd = '';
    for (let ring of chainVertexRings(bedges)) {
      ring = ring.map((v) => ({ x: gx(v.x), y: gy(v.y) }));
      ring = cleanRing(ring);
      if (ring.length < 3) continue;
      ring = chaikinClosed(ring, 3);
      bd += catmullClosedPath(ring);
    }
    const cx = sx / cells.length, cy = sy / cells.length;
    const color = data.paises[P]?.color || '#888';
    regions.push({ pid: P, d, bd, color, cx, cy, n: roomCount.get(P) || 0, island: islandIds.has(P), bx: bxMin, by: byMin, bw: bxMax - bxMin, bh: byMax - byMin });
    kanji.push({ pid: P, x: cx, y: cy, glyph: kanjiFor(data.paises[P]?.nombre || P), n: roomCount.get(P) || 0 });
  }

  // --- fronteras internas: aristas de grilla entre dos paises distintos ---
  const bEdges: [number, number, number, number][] = [];
  for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
    if (!cellLand[cj * cc + ci]) continue;
    const o = cellOwner[cj * cc + ci];
    if (ci < cc - 1 && cellLand[cj * cc + ci + 1] && cellOwner[cj * cc + ci + 1] && cellOwner[cj * cc + ci + 1] !== o)
      bEdges.push([ci + 1, cj, ci + 1, cj + 1]);
    if (cj < cr - 1 && cellLand[(cj + 1) * cc + ci] && cellOwner[(cj + 1) * cc + ci] && cellOwner[(cj + 1) * cc + ci] !== o)
      bEdges.push([ci, cj + 1, ci + 1, cj + 1]);
  }
  let borders = '';
  for (let chain of chainVertexChains(bEdges)) {
    let ring = chain.map((v) => ({ x: gx(v.x), y: gy(v.y) }));
    if (ring.length < 2) continue;
    ring = chaikinOpen(ring, 2);
    borders += 'M' + ring.map((p) => `${r1(p.x)} ${r1(p.y)}`).join('L');
  }

  // --- banda de TIERRA CON DUEÑO (union de todas las celdas de tierra de cualquier pais) dilatada
  // MOAT_CELLS: recorta el borde bd (piece 2) para que sus excursiones al estrecho / mar abierto
  // (mas alla de ~MOAT_CELLS de tierra con dueño real) NO se dibujen. La costa (piece 1) NO lo usa.
  const ownedLandMask = new Uint8Array(cc * cr);
  for (let s = 0; s < cc * cr; s++) if (cellLand[s] && cellOwner[s]) ownedLandMask[s] = 1;
  const landMaskD = maskToPath(dilate(ownedLandMask, cc, cr, MOAT_CELLS), cc, cr, gx, gy);

  // --- OCEANO + anillos de tinta alrededor del mundo entero. Parte de la tierra VISIBLE
  // (cellLand menos las peninsulas trimmed) para que el agua y los anillos abracen la costa
  // que realmente se ve, no los fantasmas recortados.
  const visLand = new Uint8Array(cc * cr);
  for (let s = 0; s < cc * cr; s++) if (cellLand[s] && !(orphanDG && orphanDG[s])) visLand[s] = 1;
  const oceanMask = dilate(visLand, cc, cr, WORLD_SEA_CELLS);
  let oxa = Infinity, oya = Infinity, oxb = -Infinity, oyb = -Infinity;
  for (let s = 0; s < cc * cr; s++) {
    if (!oceanMask[s]) continue; const ci = s % cc, cj = (s - ci) / cc;
    const px = gx(ci), py = gy(cj);
    if (px < oxa) oxa = px; if (px + CELL > oxb) oxb = px + CELL;
    if (py < oya) oya = py; if (py + CELL > oyb) oyb = py + CELL;
  }
  const ocean = { d: maskToPath(oceanMask, cc, cr, gx, gy), x: oxa, y: oya, w: oxb - oxa, h: oyb - oya };
  const ripples = RIPPLE_CELLS.map((k) => maskToPath(dilate(visLand, cc, cr, k), cc, cr, gx, gy));

  // --- COSTA VISIBLE (dilate 0): contorno exacto de la tierra que se ve. La aguada de
  // acuarela se dibuja COMO TRAZO difuminado de este contorno -> cada costa entinta su
  // propio borde y nada puede fusionarse en blobs (a diferencia de los anillos dilatados,
  // que en los estrechos se unian en una malla).
  const coastVis = maskToPath(visLand, cc, cr, gx, gy);

  // --- OLAS mangaka: glifos de ola dispersos por la banda de oceano. Deterministas (hash
  // por celda -> estables entre renders/HMR), MAS DENSOS cerca de la costa, con separacion
  // minima. No forman malla: son trazos sueltos.
  const noGlyph = dilate(visLand, cc, cr, 2);   // franja limpia pegada a la costa (ahi vive la aguada; cubre los moats)
  const bandNear = dilate(visLand, cc, cr, 6);  // hasta 6 celdas de tierra: denso
  const bandMid = dilate(visLand, cc, cr, 9);   // hasta 9 celdas: medio (mas alla: ralo)
  const rnd = (ci: number, cj: number, k: number) =>
    (((((ci + 7) * 73856093) ^ ((cj + 11) * 19349663) ^ (k * 83492791)) >>> 0) % 1000) / 1000;
  const waves: World['waves'] = [];
  const taken = new Uint8Array(cc * cr);
  const SP = 4; // separacion minima entre glifos, en celdas (Chebyshev): 64u
  for (let cj = 0; cj < cr && waves.length < 420; cj++) for (let ci = 0; ci < cc; ci++) {
    const s = cj * cc + ci;
    if (!oceanMask[s] || noGlyph[s]) continue;                    // solo agua abierta
    const p = bandNear[s] ? 0.085 : bandMid[s] ? 0.05 : 0.025;    // densidad por distancia a costa
    if (rnd(ci, cj, 1) >= p) continue;
    let free = true;
    for (let dj = -SP; dj <= SP && free; dj++) for (let di = -SP; di <= SP; di++) {
      const ni = ci + di, nj = cj + dj;
      if (ni >= 0 && nj >= 0 && ni < cc && nj < cr && taken[nj * cc + ni]) { free = false; break; }
    }
    if (!free) continue;
    taken[s] = 1;
    waves.push({
      x: r1(gx(ci) + CELL / 2 + (rnd(ci, cj, 2) - 0.5) * 20),
      y: r1(gy(cj) + CELL / 2 + (rnd(ci, cj, 3) - 0.5) * 20),
      s: Math.round((1.1 + rnd(ci, cj, 4) * 0.7) * 100) / 100,   // escala 1.1..1.8 (legible al zoom por defecto)
      a: Math.round((rnd(ci, cj, 5) - 0.5) * 16),                // rotacion -8..8 grados
      fl: rnd(ci, cj, 7) < 0.35 ? -1 : 1,                        // flip horizontal ocasional
      t: rnd(ci, cj, 6) < 0.12 ? 1 : 0,                          // ~12%: cresta ukiyo-e con rulo
      g: (ci * 7 + cj * 13) % 4,                                 // grupo de fase 0..3 (mezcla espacial)
    });
  }

  return {
    seaRect: { x: x0 - 4000, y: y0 - 4000, w: (x1 - x0) + 8000, h: (y1 - y0) + 8000 },
    land: landD, continent: continentD, trimSea: trimD, landMask: landMaskD, ocean, ripples, coastVis, waves, islands: islandInfo, coast: landD, regions, borders, kanji,
  };
}

// ---------------------------------------------------------------------------
// campo de distancia (a nodos Y aristas de un grupo)
// ---------------------------------------------------------------------------
function computeField(pts: RoomPt[], segs: Seg[], x0: number, y0: number, cols: number, rows: number, cell: number): Float32Array {
  const field = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const py = y0 + j * cell;
    for (let i = 0; i < cols; i++) {
      const px = x0 + i * cell; let best = Infinity;
      for (const p of pts) { const dx = p.x - px, dy = p.y - py, d = dx * dx + dy * dy; if (d < best) best = d; }
      for (const s of segs) { const d = distSegSq(px, py, s.ax, s.ay, s.bx, s.by); if (d < best) best = d; }
      field[j * cols + i] = Math.sqrt(best);
    }
  }
  return field;
}

// ---------------------------------------------------------------------------
// marching squares (orientacion geometrica) -> path de tierra + mascara conservada
// ---------------------------------------------------------------------------
function traceLand(field: Float32Array, iso: number, cols: number, rows: number, cc: number, cr: number, x0: number, y0: number, cell: number, contIters: number, protect: Uint8Array | null, open: number, solid: boolean): { d: string; cellLand: Uint8Array } {
  const gx = (i: number) => x0 + i * cell, gy = (j: number) => y0 + j * cell;
  const fAt = (i: number, j: number) => field[j * cols + i];
  const inside = (i: number, j: number) => fAt(i, j) < iso;

  const cellLandAll = new Uint8Array(cc * cr);
  for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++)
    if (inside(ci, cj) || inside(ci + 1, cj) || inside(ci, cj + 1) || inside(ci + 1, cj + 1)) cellLandAll[cj * cc + ci] = 1;

  // apertura morfologica: saca protrusiones/peninsulas finas de la costa (< 2*open celdas de ancho).
  // cavo el field donde el opening quito tierra, asi tambien se van del contorno (no solo de la mascara).
  if (open > 0) {
    const opened = dilate(erode(cellLandAll, cc, cr, open), cc, cr, open);
    for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) if (cellLandAll[cj * cc + ci] && !opened[cj * cc + ci]) {
      field[cj * cols + ci] = 1e6; field[cj * cols + ci + 1] = 1e6; field[(cj + 1) * cols + ci] = 1e6; field[(cj + 1) * cols + ci + 1] = 1e6;
    }
    for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++)
      cellLandAll[cj * cc + ci] = (inside(ci, cj) || inside(ci + 1, cj) || inside(ci, cj + 1) || inside(ci + 1, cj + 1)) ? 1 : 0;
  }

  // rellenar HOYOS interiores (atolones -> islas solidas): el mar alcanzable desde
  // el borde de la grilla es mar real; el que NO se alcanza es un hoyo -> pasa a tierra.
  {
    const outside = new Uint8Array(cc * cr); const st: number[] = [];
    const trySea = (ci: number, cj: number) => { if (ci < 0 || cj < 0 || ci >= cc || cj >= cr) return; const k = cj * cc + ci; if (!cellLandAll[k] && !outside[k]) { outside[k] = 1; st.push(k); } };
    for (let ci = 0; ci < cc; ci++) { trySea(ci, 0); trySea(ci, cr - 1); }
    for (let cj = 0; cj < cr; cj++) { trySea(0, cj); trySea(cc - 1, cj); }
    while (st.length) { const cur = st.pop()!; const ci = cur % cc, cj = (cur - ci) / cc; trySea(ci - 1, cj); trySea(ci + 1, cj); trySea(ci, cj - 1); trySea(ci, cj + 1); }
    // los hoyos se rellenan salvo los que son moat protegido (mar intencional alrededor de islas)
    for (let s = 0; s < cc * cr; s++) if (!cellLandAll[s] && !outside[s] && !(protect && protect[s])) cellLandAll[s] = 1;
  }

  // componentes 4-conn
  const comp = new Int32Array(cc * cr).fill(-1);
  const sizes: number[] = []; const stack: number[] = []; let nc = 0;
  for (let s = 0; s < cc * cr; s++) {
    if (!cellLandAll[s] || comp[s] !== -1) continue;
    comp[s] = nc; let sz = 0; stack.push(s);
    while (stack.length) {
      const cur = stack.pop()!; sz++; const ci = cur % cc, cj = (cur - ci) / cc;
      if (ci > 0 && cellLandAll[cj * cc + ci - 1] && comp[cj * cc + ci - 1] === -1) { comp[cj * cc + ci - 1] = nc; stack.push(cj * cc + ci - 1); }
      if (ci < cc - 1 && cellLandAll[cj * cc + ci + 1] && comp[cj * cc + ci + 1] === -1) { comp[cj * cc + ci + 1] = nc; stack.push(cj * cc + ci + 1); }
      if (cj > 0 && cellLandAll[(cj - 1) * cc + ci] && comp[(cj - 1) * cc + ci] === -1) { comp[(cj - 1) * cc + ci] = nc; stack.push((cj - 1) * cc + ci); }
      if (cj < cr - 1 && cellLandAll[(cj + 1) * cc + ci] && comp[(cj + 1) * cc + ci] === -1) { comp[(cj + 1) * cc + ci] = nc; stack.push((cj + 1) * cc + ci); }
    }
    sizes.push(sz); nc++;
  }
  let contComp = 0; for (let c = 1; c < nc; c++) if (sizes[c] > sizes[contComp]) contComp = c;
  const keep = (c: number) => c === contComp || sizes[c] >= MIN_ISLAND_CELLS;

  // interpolacion de cruce
  const interp = (fa: number, fb: number) => { let t = (iso - fa) / (fb - fa); if (!isFinite(t)) t = 0.5; return t < 0 ? 0 : t > 1 ? 1 : t; };
  const eTop = (ci: number, cj: number): Pt => ({ x: gx(ci) + interp(fAt(ci, cj), fAt(ci + 1, cj)) * cell, y: gy(cj) });
  const eBot = (ci: number, cj: number): Pt => ({ x: gx(ci) + interp(fAt(ci, cj + 1), fAt(ci + 1, cj + 1)) * cell, y: gy(cj + 1) });
  const eLef = (ci: number, cj: number): Pt => ({ x: gx(ci), y: gy(cj) + interp(fAt(ci, cj), fAt(ci, cj + 1)) * cell });
  const eRig = (ci: number, cj: number): Pt => ({ x: gx(ci + 1), y: gy(cj) + interp(fAt(ci + 1, cj), fAt(ci + 1, cj + 1)) * cell });

  const segsByComp = new Map<number, [Pt, Pt][]>();
  const push = (c: number, a: Pt, b: Pt) => { (segsByComp.get(c) || segsByComp.set(c, []).get(c)!).push([a, b]); };
  for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
    if (!cellLandAll[cj * cc + ci]) continue;
    const c = comp[cj * cc + ci];
    const TL = inside(ci, cj) ? 1 : 0, TR = inside(ci + 1, cj) ? 1 : 0, BR = inside(ci + 1, cj + 1) ? 1 : 0, BL = inside(ci, cj + 1) ? 1 : 0;
    const idx = TL | (TR << 1) | (BR << 2) | (BL << 3);
    if (idx === 0 || idx === 15) continue;
    const T = eTop(ci, cj), B = eBot(ci, cj), L = eLef(ci, cj), R = eRig(ci, cj);
    let pairs: [Pt, Pt][];
    switch (idx) {
      case 1: case 14: pairs = [[L, T]]; break;
      case 2: case 13: pairs = [[T, R]]; break;
      case 3: case 12: pairs = [[L, R]]; break;
      case 4: case 11: pairs = [[R, B]]; break;
      case 6: case 9: pairs = [[T, B]]; break;
      case 7: case 8: pairs = [[L, B]]; break;
      case 5: { const ce = (fAt(ci, cj) + fAt(ci + 1, cj) + fAt(ci + 1, cj + 1) + fAt(ci, cj + 1)) / 4; pairs = ce < iso ? [[T, R], [L, B]] : [[L, T], [R, B]]; break; }
      case 10: { const ce = (fAt(ci, cj) + fAt(ci + 1, cj) + fAt(ci + 1, cj + 1) + fAt(ci, cj + 1)) / 4; pairs = ce < iso ? [[L, T], [R, B]] : [[T, R], [L, B]]; break; }
      default: pairs = [];
    }
    // oriento cada segmento: la esquina de tierra mas cercana a la IZQUIERDA (consistente global)
    const inC: Pt[] = [];
    if (TL) inC.push({ x: gx(ci), y: gy(cj) });
    if (TR) inC.push({ x: gx(ci + 1), y: gy(cj) });
    if (BR) inC.push({ x: gx(ci + 1), y: gy(cj + 1) });
    if (BL) inC.push({ x: gx(ci), y: gy(cj + 1) });
    for (const [A, Z] of pairs) {
      const mx = (A.x + Z.x) / 2, my = (A.y + Z.y) / 2;
      let cxr = inC[0].x, cyr = inC[0].y, bd = Infinity;
      for (const co of inC) { const d = (co.x - mx) * (co.x - mx) + (co.y - my) * (co.y - my); if (d < bd) { bd = d; cxr = co.x; cyr = co.y; } }
      const crv = (Z.x - A.x) * (cyr - A.y) - (Z.y - A.y) * (cxr - A.x);
      if (crv < 0) push(c, A, Z); else push(c, Z, A);
    }
  }

  let d = '';
  const keptMask = new Uint8Array(cc * cr);
  for (let s = 0; s < cc * cr; s++) if (cellLandAll[s] && keep(comp[s])) keptMask[s] = 1;
  for (const [c, segs] of segsByComp) {
    if (!keep(c)) continue;
    const iters = c === contComp ? contIters : 2;
    const rings = chainDirected(segs).map(cleanRing).filter((r) => r.length >= 3);
    // ISLAS (solid): solo el anillo exterior (mayor area) -> solidas sin lagunas.
    // CONTINENTE (!solid): TODOS los anillos -> no se pierden fragmentos del contorno.
    const chosen = solid ? (rings.length ? [rings.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a))] : []) : rings;
    for (let ring of chosen) {
      ring = decimate(ring, cell * 0.35);
      ring = chaikinClosed(ring, iters);
      d += catmullClosedPath(ring);
    }
  }
  return { d, cellLand: keptMask };
}

// ---------------------------------------------------------------------------
// helpers de geometria (todo hand-rolled, sin dependencias)
// ---------------------------------------------------------------------------
const r1 = (v: number) => Math.round(v * 10) / 10;
const keyPt = (p: Pt) => `${Math.round(p.x * 100)}_${Math.round(p.y * 100)}`;

function signedArea(r: Pt[]): number { let a = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i].x * r[j].y - r[j].x * r[i].y; } return a / 2; }

// dilata una mascara de celdas k pasos (4-conn) -> zona de guarda alrededor
function dilate(mask: Uint8Array, cc: number, cr: number, k: number): Uint8Array {
  let cur = mask;
  for (let it = 0; it < k; it++) {
    const out = new Uint8Array(cc * cr);
    for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
      const s = cj * cc + ci;
      if (cur[s] || (ci > 0 && cur[s - 1]) || (ci < cc - 1 && cur[s + 1]) || (cj > 0 && cur[s - cc]) || (cj < cr - 1 && cur[s + cc])) out[s] = 1;
    }
    cur = out;
  }
  return cur;
}

// erosiona k pasos (celda sobrevive solo si sus 4 vecinos son tierra) -> saca la capa externa
function erode(mask: Uint8Array, cc: number, cr: number, k: number): Uint8Array {
  let cur = mask;
  for (let it = 0; it < k; it++) {
    const out = new Uint8Array(cc * cr);
    for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
      const s = cj * cc + ci;
      if (cur[s] && ci > 0 && cur[s - 1] && ci < cc - 1 && cur[s + 1] && cj > 0 && cur[s - cc] && cj < cr - 1 && cur[s + cc]) out[s] = 1;
    }
    cur = out;
  }
  return cur;
}

// convierte una mascara de celdas en un path SVG suave (mismo pipeline que usa el orphan/regiones)
function maskToPath(mask: Uint8Array, cc: number, cr: number, gx: (i: number) => number, gy: (j: number) => number): string {
  const M = (a: number, b: number) => (a < 0 || b < 0 || a >= cc || b >= cr ? 0 : mask[b * cc + a]);
  const edges: [number, number, number, number][] = [];
  for (let cj = 0; cj < cr; cj++) for (let ci = 0; ci < cc; ci++) {
    if (!mask[cj * cc + ci]) continue;
    if (!M(ci - 1, cj)) edges.push([ci, cj, ci, cj + 1]);
    if (!M(ci + 1, cj)) edges.push([ci + 1, cj, ci + 1, cj + 1]);
    if (!M(ci, cj - 1)) edges.push([ci, cj, ci + 1, cj]);
    if (!M(ci, cj + 1)) edges.push([ci, cj + 1, ci + 1, cj + 1]);
  }
  let d = '';
  for (let ring of chainVertexRings(edges)) {
    ring = ring.map((v) => ({ x: gx(v.x), y: gy(v.y) }));
    ring = cleanRing(ring); if (ring.length < 3) continue;
    ring = chaikinClosed(ring, 2); d += catmullClosedPath(ring);
  }
  return d;
}

// reasigna manchitas (componentes chicos de un pais rodeados por otro) al vecino mayoritario.
// conserva SIEMPRE el componente mas grande de cada pais.
function despeckle(cellOwner: (string | null)[], cellLand: Uint8Array, cc: number, cr: number, minCells: number): void {
  const comp = new Int32Array(cc * cr).fill(-1);
  const parts: { owner: string; cells: number[] }[] = [];
  for (let s = 0; s < cc * cr; s++) {
    if (!cellLand[s] || comp[s] !== -1 || !cellOwner[s]) continue;
    const owner = cellOwner[s]!; const stack = [s]; comp[s] = parts.length; const cells: number[] = [];
    while (stack.length) {
      const cur = stack.pop()!; cells.push(cur); const ci = cur % cc, cj = (cur - ci) / cc;
      const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
      for (const [ni, nj] of nb) { if (ni < 0 || nj < 0 || ni >= cc || nj >= cr) continue; const k = nj * cc + ni; if (cellLand[k] && comp[k] === -1 && cellOwner[k] === owner) { comp[k] = parts.length; stack.push(k); } }
    }
    parts.push({ owner, cells });
  }
  const largest = new Map<string, number>(); // owner -> index del componente mas grande
  parts.forEach((p, i) => { const cur = largest.get(p.owner); if (cur === undefined || p.cells.length > parts[cur].cells.length) largest.set(p.owner, i); });
  parts.forEach((p, i) => {
    if (largest.get(p.owner) === i || p.cells.length >= minCells) return; // el mas grande o suficientemente grande: se queda
    const votes = new Map<string, number>();
    for (const s of p.cells) { const ci = s % cc, cj = (s - ci) / cc;
      const nb = [[ci - 1, cj], [ci + 1, cj], [ci, cj - 1], [ci, cj + 1]];
      for (const [ni, nj] of nb) { if (ni < 0 || nj < 0 || ni >= cc || nj >= cr) continue; const k = nj * cc + ni; const o = cellLand[k] ? cellOwner[k] : null; if (o && o !== p.owner) votes.set(o, (votes.get(o) || 0) + 1); } }
    let best: string | null = null, bv = 0;
    for (const [o, v] of votes) if (v > bv) { bv = v; best = o; }
    if (best) for (const s of p.cells) cellOwner[s] = best;
  });
}

// arbol de expansion minima (Prim) sobre un grupo de salas -> segmentos que las conectan a todas
function mstSegs(pts: RoomPt[]): Seg[] {
  const n = pts.length; if (n < 2) return [];
  const inT = new Array(n).fill(false), dist = new Array(n).fill(Infinity), par = new Array(n).fill(-1);
  dist[0] = 0; const out: Seg[] = [];
  for (let it = 0; it < n; it++) {
    let u = -1, bd = Infinity; for (let i = 0; i < n; i++) if (!inT[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0) break; inT[u] = true;
    if (par[u] >= 0) out.push({ ax: pts[u].x, ay: pts[u].y, bx: pts[par[u]].x, by: pts[par[u]].y });
    for (let v = 0; v < n; v++) { if (inT[v]) continue; const dx = pts[u].x - pts[v].x, dy = pts[u].y - pts[v].y, d = dx * dx + dy * dy; if (d < dist[v]) { dist[v] = d; par[v] = u; } }
  }
  return out;
}

function distSegSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return wx * wx + wy * wy;
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) { const dx = px - bx, dy = py - by; return dx * dx + dy * dy; }
  const t = c1 / c2, dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

// une segmentos DIRIGIDOS [from,to] en anillos. Con orientacion consistente,
// cada vertice es inicio de a lo sumo un segmento -> recorrido inequivoco.
function chainDirected(segs: [Pt, Pt][]): Pt[][] {
  const startMap = new Map<string, number[]>();
  segs.forEach((s, i) => { const k = keyPt(s[0]); const a = startMap.get(k); if (a) a.push(i); else startMap.set(k, [i]); });
  const used = new Array(segs.length).fill(false);
  const rings: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const ring: Pt[] = []; let idx: number | undefined = i;
    while (idx !== undefined && !used[idx]) {
      used[idx] = true; ring.push(segs[idx][0]);
      const list = startMap.get(keyPt(segs[idx][1]));
      idx = list ? list.find((j) => !used[j]) : undefined;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// une aristas de grilla (coords enteras) en anillos cerrados / cadenas abiertas
function chainVertexRings(edges: [number, number, number, number][]): Pt[][] { return chainVertex(edges, true); }
function chainVertexChains(edges: [number, number, number, number][]): Pt[][] { return chainVertex(edges, false); }
function chainVertex(edges: [number, number, number, number][], closed: boolean): Pt[][] {
  const k = (i: number, j: number) => i * 100000 + j;
  const E = edges.map(([i1, j1, i2, j2]) => ({ a: k(i1, j1), b: k(i2, j2), used: false }));
  const byKey = new Map<number, number[]>();
  E.forEach((e, idx) => { (byKey.get(e.a) || byKey.set(e.a, []).get(e.a)!).push(idx); (byKey.get(e.b) || byKey.set(e.b, []).get(e.b)!).push(idx); });
  const out: Pt[][] = [];
  const un = (kk: number): Pt => ({ x: Math.floor(kk / 100000), y: kk % 100000 });
  for (let i = 0; i < E.length; i++) {
    if (E[i].used) continue;
    E[i].used = true; const startK = E[i].a; const path: number[] = [startK]; let cur = E[i].b;
    for (let guard = 0; guard < E.length + 2; guard++) {
      path.push(cur);
      if (cur === startK) break;
      const cand = (byKey.get(cur) || []).find((ei) => !E[ei].used);
      if (cand === undefined) break;
      E[cand].used = true; cur = E[cand].a === cur ? E[cand].b : E[cand].a;
    }
    if (path.length >= (closed ? 3 : 2)) out.push(path.map(un));
  }
  return out;
}

function cleanRing(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) { const l = out[out.length - 1]; if (!l || keyPt(l) !== keyPt(p)) out.push(p); }
  if (out.length > 1 && keyPt(out[0]) === keyPt(out[out.length - 1])) out.pop();
  return out;
}

function decimate(pts: Pt[], eps: number): Pt[] {
  const n = pts.length; if (n < 6) return pts;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const dx = c.x - a.x, dy = c.y - a.y, len = Math.hypot(dx, dy) || 1;
    const dist = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / len;
    if (dist >= eps) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

function chaikinClosed(pts: Pt[], iters: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iters; it++) {
    const n = cur.length; if (n < 3) break; const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const p = cur[i], q = cur[(i + 1) % n];
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    cur = out;
  }
  return cur;
}
function chaikinOpen(pts: Pt[], iters: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iters; it++) {
    if (cur.length < 3) break; const out: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i], q = cur[i + 1];
      out.push({ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 });
      out.push({ x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 });
    }
    out.push(cur[cur.length - 1]); cur = out;
  }
  return cur;
}

// Catmull-Rom cerrado (uniforme) -> path de beziers cubicas
function catmullClosedPath(pts: Pt[]): string {
  const n = pts.length; if (n < 3) return '';
  const P = (k: number) => pts[((k % n) + n) % n];
  let d = `M${r1(P(0).x)} ${r1(P(0).y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2.x)} ${r1(p2.y)}`;
  }
  return d + 'Z';
}
