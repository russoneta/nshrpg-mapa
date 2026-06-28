import React, { useState } from 'react';

export interface Opt { id: string; label: string; }

interface Props {
  edicion: boolean; setEdicion: (b: boolean) => void;
  options: Opt[];
  findRoom: (text: string) => string | null;
  onJump: (id: string) => void;
  originName: string | null; destName: string | null;
  onClearOrigin: () => void; onClearDest: () => void; onClearPath: () => void;
  pathResult: { len: number } | 'none' | null;
  onShowRoute: () => void;
  onFit: () => void; onPNG: () => void; onReset: () => void;
}

export function Toolbar(p: Props) {
  const [jump, setJump] = useState('');
  const doJump = (t: string) => { const id = p.findRoom(t); if (id) { p.onJump(id); setJump(''); } };
  const exact = (v: string) => p.options.some((op) => op.label === v);

  return (
    <div className="panel toolbar panel-pad">
      <datalist id="rooms">{p.options.map((op) => <option key={op.id} value={op.label} />)}</datalist>

      <h2 className="sec">Buscar / ubicar sala</h2>
      <input className="txt" list="rooms" placeholder="nombre o ID de sala…" value={jump}
        onChange={(e) => { setJump(e.target.value); if (exact(e.target.value)) doJump(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') doJump((e.target as HTMLInputElement).value); }} />

      <div className="divider" />
      <h2 className="sec">Vista</h2>
      <button className={'btn block' + (p.edicion ? ' primary' : '')} onClick={() => p.setEdicion(!p.edicion)}>
        {p.edicion ? '✓ Editando: salas desbloqueadas' : '✏️ Editar / mover salas'}
      </button>
      {p.edicion && <div className="hint">Arrastrá las salas para acomodarlas. Se muestran los IDs y las salidas sin explorar.</div>}
      {p.edicion && (
        <button className="btn block sm" style={{ marginTop: 8 }} onClick={p.onReset}
          title="Recalcula las posiciones automáticamente y descarta lo que moviste a mano">
          ↺ Reacomodar salas (auto)
        </button>
      )}

      <div className="divider" />
      <h2 className="sec">Trazar ruta</h2>
      <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>Tocá una sala en el mapa y elegila como origen o destino.</div>
      <div className="slot">
        <span className="slot-tag o">Origen</span>
        <span className="slot-name">{p.originName || <i>— elegí una sala</i>}</span>
        {p.originName && <button className="iconbtn" onClick={p.onClearOrigin} title="Quitar origen">✕</button>}
      </div>
      <div className="slot">
        <span className="slot-tag d">Destino</span>
        <span className="slot-name">{p.destName || <i>— elegí una sala</i>}</span>
        {p.destName && <button className="iconbtn" onClick={p.onClearDest} title="Quitar destino">✕</button>}
      </div>
      {p.pathResult === 'none' && <div className="hint">No hay camino entre esas salas.</div>}
      {p.pathResult && p.pathResult !== 'none' && (
        <>
          <div style={{ fontSize: 13, marginTop: 9 }}>Ruta: <b>{p.pathResult.len} salas</b> · {p.pathResult.len - 1} saltos</div>
          <button className="btn block sm primary" style={{ marginTop: 8 }} onClick={p.onShowRoute}>Ver las salas de la ruta</button>
        </>
      )}
      {(p.originName || p.destName) && (
        <button className="btn block sm" style={{ marginTop: 8 }} onClick={p.onClearPath}>Borrar ruta</button>
      )}

      <div className="divider" />
      <div className="row">
        <button className="btn sm" onClick={p.onFit} title="Encuadrar todo el mapa en pantalla">Ver todo</button>
        <button className="btn sm" onClick={p.onPNG} title="Descargar el mapa como imagen PNG">Descargar PNG</button>
      </div>
    </div>
  );
}
