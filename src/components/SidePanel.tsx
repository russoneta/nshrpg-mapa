import React, { useState, useEffect } from 'react';
import { MapData, Room, DIR_ARROW, short } from '../lib/types';
import { edgeKey } from '../lib/graph';

interface Props {
  data: MapData;
  room: Room;
  paisColor: (id: string | null) => string;
  edicion: boolean;
  realEdges: Set<string>;
  onSelect: (id: string) => void;
  onClose: () => void;
  onOrigin: (id: string) => void;
  onDest: (id: string) => void;
  isOrigin: boolean;
  isDest: boolean;
}

export function SidePanel({ data, room, paisColor, edicion, realEdges, onSelect, onClose, onOrigin, onDest, isOrigin, isDest }: Props) {
  const pais = room.pais ? data.paises[room.pais] : null;
  const [imgErr, setImgErr] = useState(false);
  useEffect(() => setImgErr(false), [room.roomId]);

  // solo conexiones con direccion; las "sin explorar" solo cuando edito
  const exits = (room.exits || []).filter((e) => (e.to ? realEdges.has(edgeKey(room.roomId, e.to)) : edicion));

  return (
    <div className="panel sidepanel">
      <div className="panel-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="sp-name">{short(room.name)}</h2>
          <div className="sp-pais">
            <span className="dot" style={{ background: paisColor(room.pais), width: 11, height: 11 }} />
            {pais ? pais.nombre : 'Sin país'}
          </div>
        </div>
        <button className="iconbtn" onClick={onClose} title="Cerrar">✕</button>
      </div>

      <div className="panel-pad row" style={{ paddingTop: 0, paddingBottom: 11 }}>
        <button className={'btn sm' + (isOrigin ? ' primary' : '')} onClick={() => onOrigin(room.roomId)}>
          {isOrigin ? '✓ Origen' : 'Marcar origen'}
        </button>
        <button className={'btn sm' + (isDest ? ' primary' : '')} onClick={() => onDest(room.roomId)}>
          {isDest ? '✓ Destino' : 'Marcar destino'}
        </button>
      </div>

      <div className="sp-scroll panel-pad" style={{ paddingTop: 0 }}>
        {room.img && !imgErr
          ? <img className="sp-img" src={`img/${room.img}`} alt={room.name} loading="lazy" onError={() => setImgErr(true)} />
          : <div className="sp-img placeholder">sin foto</div>}

        <div className="divider" />
        <h2 className="sec">Conexiones ({exits.length})</h2>
        {exits.length === 0 && <div className="muted" style={{ fontSize: 13 }}>—</div>}
        {exits.map((e, i) => {
          const to = e.to ? data.rooms[e.to] : null;
          if (e.to && to)
            return (
              <div key={i} className="exit-row" onClick={() => onSelect(e.to!)} title={'Ir a ' + short(to.name)}>
                <span className="exit-arrow">{e.dir ? DIR_ARROW[e.dir] : '•'}</span>
                <span className="exit-to">{short(to.name)}</span>
              </div>
            );
          return (
            <div key={i} className="exit-row frontier">
              <span className="exit-arrow">{e.dir ? DIR_ARROW[e.dir] : '•'}</span>
              <span className="exit-to">{e.label || 'salida'} · <span style={{ opacity: 0.75 }}>sin explorar</span></span>
            </div>
          );
        })}

        {room.notas && (
          <>
            <div className="divider" />
            <h2 className="sec">Notas</h2>
            <div className="notas">{room.notas}</div>
          </>
        )}

        {edicion && room.ee && <div><span className="ee-badge">★ Easter egg</span></div>}
        {edicion && (
          <>
            <div className="divider" />
            <div className="rid">roomId {room.roomId}</div>
          </>
        )}
      </div>
    </div>
  );
}
