// ¿Esta interfaz es el menú dentro del juego? (la misma app abierta con ?overlay en una ventana encima del juego)
export const IS_OVERLAY = new URLSearchParams(location.search).has('overlay')
