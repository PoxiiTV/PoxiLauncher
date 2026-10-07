// Estilo Minecraft para toda la app: <html> lleva data-zone="minecraft" y el CSS del final de minecraft.css viste la
// app entera (el menú dentro del juego no lo lleva).

/** Pone o quita el estilo Minecraft */
export function setZone(on: boolean): void {
  if (on) document.documentElement.dataset.zone = 'minecraft'
  else delete document.documentElement.dataset.zone
}
