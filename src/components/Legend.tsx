import React from 'react';

export interface CountRow { id: string | null; nombre: string; color: string; n: number; }

interface Props {
  counts: CountRow[];
  filterPais: string | null;
  setFilterPais: (id: string | null) => void;
}

export function Legend({ counts, filterPais, setFilterPais }: Props) {
  return (
    <div className="panel legend panel-pad">
      <h2 className="sec">Países · {counts.filter((c) => c.id && c.id !== '__sin__').length}</h2>
      <div className="legend-list">
        {counts.map((c) => {
          const key = c.id ?? '__none__';
          const active = filterPais === c.id;
          const dim = filterPais !== null && !active;
          return (
            <div key={key} className={'legend-row' + (active ? ' on' : '') + (dim ? ' dim' : '')}
              onClick={() => setFilterPais(active ? null : c.id)}>
              <span className="dot" style={{ background: c.color }} />
              <span className="nm">{c.nombre}</span>
              <span className="ct">{c.n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
