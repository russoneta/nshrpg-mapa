// pasa el export de la captura al formato del sitio: arregla los nombres de
// pais, saca las imagenes a public/img/ y escribe un map.json liviano.
// uso: node scripts/import-data.mjs <export.json>
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('Uso: node scripts/import-data.mjs <export.json>'); process.exit(1); }
if (!existsSync(src)) { console.error('No existe el archivo: ' + src); process.exit(1); }

const d = JSON.parse(readFileSync(src, 'utf8'));

// nombres de pais
const minor = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el', 'e']);
const tc = (s) => s.split(/\s+/).filter(Boolean).map((w) => { const l = w.toLowerCase(); return minor.has(l) ? l : l.charAt(0).toUpperCase() + l.slice(1); }).join(' ');
const norm = (n) => ('País ' + tc(String(n).trim().replace(/^pa[ií]s\s*/i, ''))).trim();

// colores de cada pais
const COLORS = {
  'País del Fuego': '#7BC86C',              // verde clarito
  'País del Agua': '#2E74D0',               // azul
  'País de la Hierba': '#1E7A34',           // verde oscuro
  'País de la Tierra': '#9C5A72',           // marrón-fucsia
  'País del Rayo': '#F1C40F',               // amarillo
  'País del Viento': '#E8732A',             // anaranjado
  'País de la Nieve': '#A6DCEF',            // celeste clarito
  'País de la Lluvia': '#9AA0A6',           // gris
  'País del Remolino': '#C026A3',           // magenta
  'País de las Aguas Termales': '#8E44AD',  // violeta
  'País de la Piedra': '#56708A',           // gris pizarra
  'País de las Llaves': '#E63946',          // rojo
  'País del Arroz': '#13A089',              // jade
  'País del Té': '#8B5A2B',                 // marrón té
  'País de los Rios': '#19B3D0',            // cian
  'País de la Miel': '#E0A82E',             // ámbar miel
  'País del Oso': '#4A3528',                // marrón oscuro
  'País del Hierro': '#6C5CE7',             // índigo
  'País de la Cascada': '#00CEC9',          // turquesa
};
for (const id in (d.paises || {})) {
  d.paises[id].nombre = norm(d.paises[id].nombre);
  if (COLORS[d.paises[id].nombre]) d.paises[id].color = COLORS[d.paises[id].nombre];
}

// imagenes: limpiar SOLO las fotos de salas (archivos numericos <roomId>.<ext>).
// OJO: aca antes habia un rmSync de TODO public/img — borraba tambien los assets de diseño
// (paises/*, fondo-*.webp) y rompia el sitio en cada actualizacion de datos.
const imgDir = resolve(root, 'public/img');
mkdirSync(imgDir, { recursive: true });
for (const f of readdirSync(imgDir)) {
  if (/^\d+\.(png|jpe?g|webp|gif)$/i.test(f)) rmSync(resolve(imgDir, f), { force: true });
}

let n = 0;
for (const id in (d.rooms || {})) {
  const r = d.rooms[id];
  const m = typeof r.img === 'string' ? r.img.match(/^data:image\/(\w+);base64,(.+)$/s) : null;
  if (m) {
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    writeFileSync(resolve(imgDir, `${id}.${ext}`), Buffer.from(m[2], 'base64'));
    r.img = `${id}.${ext}`; n++;
  } else r.img = null;
}

writeFileSync(resolve(root, 'public/map.json'), JSON.stringify(d));
console.log(`✓ ${Object.keys(d.rooms || {}).length} salas · ${n} imágenes · ${Object.keys(d.paises || {}).length} países`);
console.log('  listo: public/map.json + public/img/ (ahora corre npm run build)');
