import React, { useState } from 'react';

export interface Opt { id: string; label: string; }

interface Props {
  edicion: boolean; setEdicion: (b: boolean) => void;
  options: Opt[];
  findRoom: (text: string) => string | null;
  onJump: (id: string) => void;
  onTrazar: (from: string, to: string) => void; onClearPath: () => void;
  pathResult: { len: number } | 'none' | null;
  onFit: () => void; onPNG: () => void; onReset: () => void;
}

export function Toolbar(p: Props) {
  const [jump, setJump] = useState('');
  const [o, setO] = useState('');
  const [d, setD] = useState('');
  const [err, setErr] = useState('');

  const doJump = (t: string) => {
    const id = p.findRoom(t);
    if (id) { p.onJump(id); setJump(''); setErr(''); } else setErr('No encontré esa sala.');
  };
  const doTrazar = () => {
    const a = p.findRoom(o), b = p.findRoom(d);
    if (a && b) { p.onTrazar(a, b); setErr(''); }
    else setErr('Escribí dos salas válidas (usá el autocompletado).');
  };
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
      <div className="hint">
        {p.edicion
          ? 'Arrastrá las salas para acomodarlas. Se muestran los IDs y las salidas sin explorar.'
          : 'Vista limpia para mostrar. Tocá «Editar» para poder mover salas.'}
      </div>
      {p.edicion && (
        <button className="btn block sm" style={{ marginTop: 8 }} onClick={p.onReset}
          title="Recalcula las posiciones automáticamente y descarta lo que moviste a mano">
          ↺ Reacomodar salas (auto)
        </button>
      )}

      <div className="divider" />
      <h2 className="sec">Trazar ruta</h2>
      <label className="fld">Origen</label>
      <input className="txt" list="rooms" placeholder="desde…" value={o}
        onChange={(e) => { setO(e.target.value); setErr(''); }} />
      <label className="fld">Destino</label>
      <input className="txt" list="rooms" placeholder="hasta…" value={d}
        onChange={(e) => { setD(e.target.value); setErr(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') doTrazar(); }} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={doTrazar}>Trazar ruta</button>
        <button className="btn" onClick={() => { setO(''); setD(''); setErr(''); p.onClearPath(); }}>Borrar ruta</button>
      </div>
      {err && <div className="hint err">{err}</div>}
      {!err && p.pathResult === 'none' && <div className="hint">No hay camino entre esas salas.</div>}
      {!err && p.pathResult && p.pathResult !== 'none' && (
        <div style={{ fontSize: 13, marginTop: 8 }}>Ruta: <b>{p.pathResult.len} salas</b> · {p.pathResult.len - 1} saltos</div>
      )}

      <div className="divider" />
      <div className="row">
        <button className="btn sm" onClick={p.onFit} title="Encuadrar todo el mapa en pantalla">Ver todo</button>
        <button className="btn sm" onClick={p.onPNG} title="Descargar el mapa como imagen PNG">Descargar PNG</button>
      </div>
    </div>
  );
}
