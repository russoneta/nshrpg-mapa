# Mapa del Mundo NSHRPG

Mapa interactivo del RPG de hobba.tv. Junté las salas con sus conexiones y la
dirección de cada port, y quedó un mapa que se puede recorrer.

Online: https://russoneta.github.io/nshrpg-mapa/

## Correr en local

    npm install
    npm run dev

Queda en http://localhost:5173

## Actualizar las salas

Cuando capturo más salas exporto el JSON desde el script de captura y corro:

    npm run data ruta/al/export.json

Eso rehace `public/map.json` y mete las imágenes en `public/img`. Después
`npm run build`, o directamente push que se sube solo.

## Cómo está armado

Las posiciones de las salas salen de las direcciones que marqué al capturar
(arriba, abajo, izquierda, derecha). El layout está en `src/lib/layout.ts` y las
rutas entre salas en `src/lib/graph.ts`.

Solo se muestran las conexiones con una dirección marcada. Las que quedaron sin
dirección eran auto-conexiones de la captura y las dejé afuera.

Hecho con Vite y React.
