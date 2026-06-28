import React from 'react';
import { MapData, short } from '../lib/types';

interface Props {
  data: MapData;
  path: string[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export function RouteModal({ data, path, onPick, onClose }: Props) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="route-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rm-head">
          <h2>Salas de la ruta</h2>
          <button className="iconbtn" onClick={onClose} title="Cerrar">✕</button>
        </div>

        <div className="rm-breadcrumb">
          <b>Recorrido:</b>{' '}
          {path.map((id, i) => (
            <span key={id} className="rm-step">{i > 0 ? ' › ' : ''}{i + 1}. {short(data.rooms[id].name)}</span>
          ))}
        </div>

        <div className="rm-grid">
          {path.map((id, i) => {
            const r = data.rooms[id];
            return (
              <div key={id} className="rm-card" onClick={() => onPick(id)} title={'Ir a ' + short(r.name)}>
                {r.img
                  ? <img src={`img/${r.img}`} alt={short(r.name)} loading="lazy" />
                  : <div className="ph">sin foto</div>}
                <div className="rm-card-title"><span className="rm-num">{i + 1}</span>{short(r.name)}</div>
                <div className="rm-card-sub">paso {i + 1} de {path.length}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
