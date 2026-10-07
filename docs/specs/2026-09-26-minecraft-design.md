# Minecraft (beta) — Diseño

Sección nueva dentro de PoxiLauncher para jugar a Minecraft Java con mods de Modrinth y con los amigos. Motor propio (librerías de XMCL), interfaz con estética de Minecraft adaptada de Minepanel. Se empieza de cero: no se importa nada de otros launchers.

## Objetivo

Ser el mejor launcher de Minecraft Java: todo lo que la gente pide o echa de menos (investigado en GitHub de Prism/Modrinth/XMCL, minecraftforum y comparativas 2025-2026). Modrinth App ya tiene instancias compartidas y "unirse a servidor con mods"; lo que nos diferencia es **jugar juntos de verdad** (unirse a un amigo, alojar sin abrir puertos), **que nada se rompa** (rollback, copias de mundos) y **explicar los crasheos**.

Fuera: CurseForge, importar desde otros launchers, authlib-injector (ely.by), Bedrock.

## Hoja de ruta (aprobada; Poxi prueba al final de todo)

| Fase | Contenido |
|---|---|
| 1 ✅ | Cuentas Microsoft y sin conexión, instancias vanilla, Java automático por versión, jugar, registro |
| 2 ✅ | Fabric/Quilt/Forge/NeoForge · buscador de Modrinth (mods, resource packs, shaders) con dependencias · por mod: actualizar, bajar de versión, bloquear · **foto automática antes de cada cambio + "volver a como estaba"** · etiquetas de mods que se activan/desactivan juntas · mods sueltos reconocidos por hash |
| 3 ✅ | **Copia automática de mundos al jugar** + manuales · `.mrpack` importar/exportar + **pack de servidor** (sin mods de cliente) · ajustes compartidos entre instancias (opciones, teclas, servidores) · duplicar instancia · **explicador de crasheos** |
| 4 ✅ | Pack compartido con amigos (receta en nuestro servidor, SSE) con **aviso de cambios antes de aplicar** y **rollback para todo el grupo** · **"Unirme a mi amigo"** (instala su pack exacto y entra) · presencia en amigos y Discord · skins |
| 5 ✅ | **Alojar tu mundo sin abrir puertos** (túnel por nuestro servidor) · **mundo compartido** que cualquiera del grupo puede alojar · crear un servidor para amigos desde una instancia · instancias en la nube |

**Estado:** publicado desde la 3.0.0 (rama `main`) y probado entero con amigos en la 3.3.x: packs, «Unirme», LAN (Microsoft), servidor, mundo del grupo y nube. En «En la nube» se puede quitar un pack: sales tú y, si eras el último, se borra con su mundo.

**Minecraft 26.x:** el LAN se anuncia con «Published LAN server on port N» (lo lee `lanPort` en `rules.ts`, junto a los formatos viejos). Un servidor nuevo trae la lista blanca activada: se apaga solo al crearlo (si luego la activas, se respeta). El LAN siempre va en modo online, sea cual sea la cuenta del anfitrión: solo entran cuentas Microsoft. Con cuentas sin conexión se usa el Servidor, y «Unirme» y el anfitrión lo avisan. No se usan mods para evitarlo, porque tiene que valer en todas las versiones.

**Tema Minecraft (3.1.0):** tercer tema en Ajustes: `data-zone` puesto siempre (y el tema oscuro por debajo). Las reglas del final de `minecraft.css` visten las piezas comunes (botones, paneles, campos, interruptores, barras, carátulas, avisos, ventanas, menús) y lo cuadran todo, menos las miniaturas del selector de tema y el anillo de la bienvenida. El modo sofá va sin él. Logo: `assets/mc/grass-block.png` + Minecraftia (uso personal) a 16 px.

**Fase 5, diseño** (Vite empaqueta las dependencias opcionales de `ws` como módulos vacíos y rompe los mensajes de 48 bytes o más: van como `external` en `electron.vite.config.ts`):
- Túnel (`update-server/src/tunnel.js` + `src/main/minecraft/tunnel.ts`): WebSocket por el mismo puerto (`/api/u/tunnel/host|join/:id|accept/:conn`), solo amigos del anfitrión, el latido solo anuncia túneles propios.
- Mundo abierto a LAN: la app ve "Started serving on <puerto>" en el registro, abre el túnel y lo anuncia (presencia `mc.tunnel`). "Unirme" usa el túnel (puerto local en 127.0.0.1). Mundo LAN de cuenta Microsoft = solo entran cuentas Microsoft.
- Servidor desde una instancia (carpeta `server/` de la instancia): vanilla (server.jar), Fabric (lanzador de servidor de su meta), Forge/NeoForge (`--installServer` y sus `win_args.txt`); Quilt no. EULA aceptado por el usuario; mods de servidor copiados; consola; se expone por el túnel.
- Mundo del grupo (packs): el mundo del servidor se guarda en nuestro servidor (`DATA_DIR/mcworlds`), con bloqueo mientras alguien lo aloja.
- Instancias en la nube: un pack solo tuyo; en otro PC sale para instalarlo.

**Notas de Modrinth:** su API da 502/503 a ratos: 5 reintentos, y lo no reconocido por hash se vuelve a consultar al abrir la lista. Con una versión estable solo se ofrecen actualizaciones estables. Los modpacks bajan 6 archivos a la vez.

**Notas del motor:** XMCL fijado en `@xmcl/installer` 6.1.2 + `@xmcl/core` 2.15.1 (las 6.3.x/2.16.x de npm están mal publicadas). `undici` forzado a la última 7.x por seguridad. Hay que pasarle a XMCL un agente compartido (si no, abre una conexión por archivo y Mojang las corta), y el manifiesto de Java se descarga aparte (su `fetchJavaRuntimeManifest` usa una opción que undici 7 ya no acepta).

## 1. Cuentas

**Microsoft**
- Client ID de Azure de Prism Launcher en `.env` (`MAIN_VITE_MSA_CLIENT_ID`), para uso personal. Cambiarlo es una línea.
- Inicio de sesión dentro de la app (ventana propia con partición persistente, como Nexus): nunca se abre el navegador del sistema. Flujo con código de dispositivo o redirección, lo que acepte el client ID; se confirma en la fase 1.
- Cadena: Microsoft → Xbox Live → XSTS → `api.minecraftservices.com/launcher/login` → perfil (nombre, UUID, skin).
- Si la cuenta no tiene el juego, se avisa y no se guarda.
- El token de renovación se guarda cifrado con `safeStorage` en `minecraft/accounts.bin`. Nunca sale del PC ni pasa por nuestro servidor.

**Sin conexión**
- Libres: no exigen cuenta Microsoft.
- Nombre de 3 a 16 caracteres (`A-Z a-z 0-9 _`), validado en el proceso principal.
- UUID = UUID v3 de `OfflinePlayer:<nombre>` (igual que el servidor de Minecraft), así el mismo nombre conserva su progreso.
- Aviso en pantalla: solo sirven en un jugador, en servidores con `online-mode=false` y en LAN con quien tampoco sea premium.

Varias cuentas; una marcada como activa, y se puede elegir otra al pulsar Jugar.

## 2. Instancias y arranque

- Carpeta raíz `Minecraft` dentro de la carpeta de juegos (cambiable en Ajustes). `versions`, `libraries` y `assets` se comparten; cada instancia tiene su propia carpeta (`mods`, `saves`, `config`…).
- Instalación con `@xmcl/installer`: versión, librerías y assets; Fabric y Quilt por sus APIs de meta; Forge y NeoForge con su instalador.
- Java: se descarga solo el runtime oficial de Mojang que pide cada versión (`javaVersion.component`). Nadie tiene que instalar Java.
- Arranque con `@xmcl/core`: RAM (mínima y máxima) y argumentos extra por instancia, con valores por defecto sensatos según la RAM del PC.
- Registro del juego visible (última sesión) para poder ver por qué ha fallado.
- Horas jugadas y "jugando a" igual que el resto de juegos (Discord, amigos, estadísticas).

## 3. Modrinth

- API v2 (`api.modrinth.com`) con `User-Agent` propio, como pide Modrinth. Se añade al allowlist de `net.ts`.
- Búsqueda filtrada por versión de Minecraft, loader y tipo (mods, resource packs, shaders, modpacks).
- Al instalar se añaden las dependencias obligatorias. Al quitar un mod, se avisa si otro lo necesita (como en Thunderstore).
- Actualizaciones por hash (`/version_files/update`).
- Cada descarga se verifica con su `sha512`/`sha1` antes de usarla.
- `.mrpack`: importar (crea la instancia) y exportar. Las rutas de `modrinth.index.json` y `overrides` se validan para que nada escriba fuera de la instancia.

## 4. Amigos

- "Compartir modpack": el servidor guarda solo la receta (nombre, versión de Minecraft, loader y su versión, lista de IDs de versión de Modrinth). Nada de archivos.
- "Usar el modpack de X": crea la instancia y descarga todo de Modrinth.
- Sincronización en tiempo real por SSE, como los grupos de mods: si el dueño añade o quita un mod, a los demás les aparece "hay cambios" y se aplican con un clic.
- En el primer paso no se sincronizan las carpetas de configuración (`config`); se añadirá si hace falta.
- Presencia: "Jugando a Minecraft 1.21.1 · Fabric" en amigos y Discord.
- Servidor: validación con zod, límite de tamaño de receta y de mods, rate limiting como el resto de rutas.

## 5. Interfaz (adaptada de Minepanel)

- Base: [Minepanel](https://github.com/Ketbome/minepanel) (Minepanel Community License): uso no comercial permitido y **atribución obligatoria**. Se cumple con el aviso de copyright en `THIRD-PARTY.md` y en el README. PoxiLauncher es gratis y privado, y no compite con Minepanel (un panel de servidores).
- Se reescribe en CSS normal (el proyecto no usa Tailwind), todo con el prefijo `.mc-` en `minecraft.css`, sin tocar el resto de la app.
- Paleta: negro verdoso (`#0a0e08`, `#101609`), verde esmeralda `#9dff3f`, y los acentos diamante, oro, lapislázuli, redstone y amatista.
- Piezas: `mc-panel` (panel de piedra con relieve), `mc-slot` (hueco de inventario), `mc-btn`, barra de título y fondo de cuadrícula tipo plano.
- Tipografía: Archivo y Archivo Black (`@fontsource`, OFL), sin depender de Internet.
- Iconos de objetos (cofre, pico, esmeralda…): son texturas de Mojang incluidas en Minepanel. Se usan solo en la distribución privada.
- Sonidos opcionales (CC0 de freesound, con sus créditos).
- Fuera de la sección: al entrar, la app entera cambia a la paleta Minecraft (`data-zone` en `<html>`, reglas al final de `minecraft.css`) con un barrido de bloques (`lib/zone.ts`, velocidad en `ZONE_MS`). Se anima una foto de la ventana (`window:capture`) y no una transición de vista, porque esas bloquean los clics mientras duran. Se puede apagar en Ajustes (`mcSweep`).

## Seguridad

- Todo lo que llega por IPC (nombres, IDs, rutas, RAM) se valida en el proceso principal.
- Descargas solo por HTTPS a hosts del allowlist, con el hash comprobado.
- Los tokens de Microsoft nunca se registran en los logs ni se envían a nuestro servidor.

## Qué probar

1. Cuenta Microsoft y sin conexión; vanilla 1.21.x y una antigua (1.12.2) para ver el Java de cada una.
2. Instancia Fabric: Sodium + Iris desde Modrinth; actualizar, bajar de versión, bloquear; "volver a como estaba"; etiquetas.
3. Mundos: copia al jugar y restaurar; importar un `.mrpack` de Modrinth y exportar el tuyo; provocar un crasheo (quitar una dependencia) y leer la explicación.
4. Con el amigo: compartir pack, añadir un mod, aceptar cambios, rollback de grupo; "Unirme" desde su perfil.
5. Alojar un mundo y que entre el amigo sin abrir puertos; servidor desde una instancia.
