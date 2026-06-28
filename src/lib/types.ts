export type Dir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface Exit {
  label: string;
  to: string | null; // roomId destino, o null = frontier (sin explorar)
  dir: Dir | null;
}

export interface Room {
  roomId: string;
  name: string;
  pais: string | null;
  x: number | null;
  y: number | null;
  img: string | null; // nombre de archivo en /img/ (ej "4552282.png"), o null
  notas: string;
  ee: boolean; // easter egg (solo modo Edición)
  exits: Exit[];
}

export interface Pais {
  id: string;
  nombre: string;
  color: string;
}

export interface MapData {
  version: number;
  rooms: Record<string, Room>;
  paises: Record<string, Pais>;
}

export interface Pt { x: number; y: number; }

export const DIR_VEC: Record<Dir, Pt> = {
  N: { x: 0, y: -1 }, NE: { x: 0.7, y: -0.7 }, E: { x: 1, y: 0 }, SE: { x: 0.7, y: 0.7 },
  S: { x: 0, y: 1 }, SW: { x: -0.7, y: 0.7 }, W: { x: -1, y: 0 }, NW: { x: -0.7, y: -0.7 },
};

export const DIR_ARROW: Record<Dir, string> = {
  N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖',
};

export const NEUTRAL = '#8a7d63'; // salas sin pais

// saca el "NSHRPG - " del nombre para mostrarlo mas corto
export const short = (name: string) => name.replace(/^NSHRPG\s*[-–]\s*/i, '').trim() || name;
