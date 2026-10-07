// Ayudante de Windows para el menú dentro del juego (un PowerShell abierto mientras juegas): qué ventana hay delante y
// si ocupa toda la pantalla, si el juego se ha minimizado, y pasar un juego de pantalla completa exclusiva a ventana
// sin bordes (Alt+Intro, el cambio de pantalla completa de DirectX, y luego estirarlo sin bordes). No toca el juego por
// dentro: solo su ventana, como haría el propio usuario.
import { spawn, type ChildProcess } from 'node:child_process'

const SCRIPT = `
[Console]::InputEncoding = [Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Threading; using System.Drawing; using System.Drawing.Imaging;
public static class P {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RECT mon; public RECT work; public int flags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI mi);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetLong(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetLong(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int s);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  // Vigilar una tecla (el atajo de las capturas): avisa al pulsarla y al soltarla («ev down» / «ev up»). Así funciona
  // hasta con F12, que Windows no deja registrar como atajo (la reserva para el depurador), y se sabe cuánto se mantiene.
  // Los modificadores (1 Ctrl, 2 Mayús, 4 Alt) tienen que ser justo esos
  static volatile int wvk = 0, wmods = 0; static Thread wt;
  public static void Watch(int vk, int mods) {
    wvk = vk; wmods = mods;
    if (wt == null) {
      wt = new Thread(Loop); wt.IsBackground = true; wt.Start();
      // La primera captura tardaba ~0,8 s (.NET preparándose): se hace una de mentira ya
      ThreadPool.QueueUserWorkItem(_ => { try { using (var bm = new Bitmap(8, 8)) { using (var g = Graphics.FromImage(bm)) g.CopyFromScreen(0, 0, 0, 0, new Size(8, 8)); bm.Save(new System.IO.MemoryStream(), ImageFormat.Png); } } catch { } });
    }
  }
  // Captura de la pantalla donde está el ratón (GDI: ~0,2 s, frente a ~1 s o más de Chromium). En píxeles reales (sin el
  // escalado de Windows). Si sale negra (pantalla completa exclusiva: ahí GDI no ve el juego), dice «black»
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(PT p, uint f);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static string Shot(string file) {
    IntPtr old = SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      PT p; GetCursorPos(out p);
      var mi = new MI(); mi.cb = Marshal.SizeOf(mi);
      if (!GetMonitorInfo(MonitorFromPoint(p, 2), ref mi)) return "err";
      int w = mi.mon.R - mi.mon.L, h = mi.mon.B - mi.mon.T;
      using (var b = new Bitmap(w, h, PixelFormat.Format32bppRgb)) {
        using (var g = Graphics.FromImage(b)) g.CopyFromScreen(mi.mon.L, mi.mon.T, 0, 0, new Size(w, h));
        bool dark = true;
        for (int y = 1; y < 16 && dark; y++) for (int x = 1; x < 16 && dark; x++) { var c = b.GetPixel(x * w / 16, y * h / 16); if (c.R + c.G + c.B > 24) dark = false; }
        if (dark) return "black";
        b.Save(file, ImageFormat.Png);
      }
      return w + " " + h;
    } finally { SetThreadDpiAwarenessContext(old); }
  }
  static void Loop() {
    bool was = false;
    while (true) {
      Thread.Sleep(25);
      int vk = wvk, m = wmods;
      bool d = vk != 0 && Down(vk) && Down(0x11) == ((m & 1) != 0) && Down(0x10) == ((m & 2) != 0) && Down(0x12) == ((m & 4) != 0);
      if (d != was) { was = d; Console.Out.WriteLine(d ? "ev down" : "ev up"); Console.Out.Flush(); }
    }
  }
  static bool Mon(IntPtr h, out RECT m) { var mi = new MI(); mi.cb = Marshal.SizeOf(mi); bool ok = GetMonitorInfo(MonitorFromWindow(h, 2), ref mi); m = mi.mon; return ok; }
  public static bool Full(IntPtr h) { RECT r, m; return IsWindow(h) && GetWindowRect(h, out r) && Mon(h, out m) && r.L <= m.L && r.T <= m.T && r.R >= m.R && r.B >= m.B; }
  public static string Fg() { IntPtr h = GetForegroundWindow(); return h.ToInt64() + " " + (Full(h) ? 1 : 0); }
  public static int State() { int s = 0; SHQueryUserNotificationState(out s); return s; }
  public static bool Iconic(long h) { return IsIconic(new IntPtr(h)); }
  // Pulsar Alt deja traer la ventana delante aunque no seamos nosotros los de delante
  static void Front(IntPtr h) { if (IsIconic(h)) ShowWindow(h, 9); keybd_event(0x12, 0, 0, UIntPtr.Zero); SetForegroundWindow(h); keybd_event(0x12, 0, 2, UIntPtr.Zero); Thread.Sleep(150); }
  public static void AltEnter(long v) { IntPtr h = new IntPtr(v); Front(h); keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x0D, 0, 0, UIntPtr.Zero); Thread.Sleep(30); keybd_event(0x0D, 0, 2, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); }
  public static void Borderless(long v) {
    IntPtr h = new IntPtr(v); RECT m; if (!Mon(h, out m)) return;
    long st = GetLong(h, -16).ToInt64() & ~(0x00C00000L | 0x00040000L | 0x00020000L | 0x00010000L | 0x00080000L);
    SetLong(h, -16, new IntPtr(st));
    SetWindowPos(h, IntPtr.Zero, m.L, m.T, m.R - m.L, m.B - m.T, 0x0020 | 0x0004 | 0x0040);
  }
  public static void Restore(long v) { Front(new IntPtr(v)); }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  // Para diagnosticar: tamaño, pantalla, estilo, clase y si está minimizada
  public static string Info(long v) {
    IntPtr h = new IntPtr(v); RECT r, m; GetWindowRect(h, out r); Mon(h, out m);
    var c = new System.Text.StringBuilder(128); GetClassName(h, c, 128);
    return "ventana " + r.L + "," + r.T + " " + (r.R - r.L) + "x" + (r.B - r.T) + " pantalla " + m.L + "," + m.T + " " + (m.R - m.L) + "x" + (m.B - m.T) +
      " estilo " + GetLong(h, -16).ToInt64().ToString("X") + " clase " + c + " minimizada " + (IsIconic(h) ? 1 : 0) + " windows " + State();
  }
}
'@
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $l = [Console]::In.ReadLine(); if ($l -eq $null) { break }
  $p = $l.Split(' '); $r = 'ok'
  try {
    switch ($p[0]) {
      'fg' { $r = [P]::Fg() }
      'state' { $r = [P]::State() }
      'iconic' { $r = [int][P]::Iconic([long]$p[1]) }
      'full' { $r = [int][P]::Full([IntPtr][long]$p[1]) }
      'altenter' { [P]::AltEnter([long]$p[1]) }
      'borderless' { [P]::Borderless([long]$p[1]) }
      'restore' { [P]::Restore([long]$p[1]) }
      'info' { $r = [P]::Info([long]$p[1]) }
      'watch' { [P]::Watch([int]$p[1], [int]$p[2]) }
      'shot' { $r = [P]::Shot($l.Substring(5)) }
      default { $r = '?' }
    }
  } catch { $r = 'err' }
  [Console]::Out.WriteLine([string]$r); [Console]::Out.Flush()
}
`

let proc: ChildProcess | null = null
let onKey: ((down: boolean) => void) | null = null
let ready: Promise<boolean> | null = null
let buf = ''
const waiting: ((line: string) => void)[] = []

/** Arranca el ayudante (una vez por partida: tarda un momento en prepararse, luego contesta al instante) */
export function startWin32(): void {
  if (proc) return
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore']
  })
  proc = p
  let onReady: (ok: boolean) => void = () => undefined
  ready = new Promise((r) => (onReady = r))
  p.stdout?.on('data', (d: Buffer) => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line === 'ready') onReady(true)
      else if (line.startsWith('ev ')) onKey?.(line === 'ev down')
      else waiting.shift()?.(line)
    }
  })
  const gone = (): void => {
    if (proc === p) proc = null
    onReady(false)
    for (const w of waiting.splice(0)) w('err')
  }
  p.on('exit', gone)
  p.on('error', gone)
}

export function stopWin32(): void {
  proc?.kill()
  proc = null
  ready = null
  buf = ''
  for (const w of waiting.splice(0)) w('err')
}

/** Una orden al ayudante y su respuesta (cadena vacía si no está) */
async function ask(cmd: string): Promise<string> {
  if (!proc || !(await ready)) return ''
  return new Promise((resolve) => {
    const waiter = (line: string): void => {
      clearTimeout(t)
      resolve(line)
    }
    // Sin respuesta en 5 s: se deja de esperar, y su hueco en la cola se queda para la respuesta tardía (así no
    // descuadra las de las preguntas siguientes)
    const t = setTimeout(() => {
      const i = waiting.indexOf(waiter)
      if (i >= 0) waiting[i] = () => undefined
      resolve('')
    }, 5000)
    waiting.push(waiter)
    proc?.stdin?.write(`${cmd}\n`)
  })
}

/** La ventana de delante y si ocupa toda su pantalla */
export async function foreground(): Promise<{ hwnd: string; full: boolean } | null> {
  const [hwnd, full] = (await ask('fg')).split(' ')
  return hwnd && /^\d+$/.test(hwnd) ? { hwnd, full: full === '1' } : null
}
export const exclusiveNow = async (): Promise<boolean> => (await ask('state')) === '3'
export const isMinimized = async (hwnd: string): Promise<boolean> => (await ask(`iconic ${hwnd}`)) === '1'
/** Alt+Intro al juego (lo trae delante primero si estaba minimizado) */
export const altEnter = (hwnd: string): Promise<string> => ask(`altenter ${hwnd}`)
export const makeBorderless = (hwnd: string): Promise<string> => ask(`borderless ${hwnd}`)
export const bringBack = (hwnd: string): Promise<string> => ask(`restore ${hwnd}`)
/** Vigilar una tecla (código de Windows y modificadores: 1 Ctrl, 2 Mayús, 4 Alt): `cb` al pulsarla y al soltarla.
 * Con vk 0 se deja de vigilar */
export function watchKey(vk: number, mods: number, cb: ((down: boolean) => void) | null): Promise<string> {
  onKey = cb
  return ask(`watch ${vk} ${mods}`)
}
/** Captura rápida de la pantalla donde está el ratón a ese PNG: su tamaño, o null si no se pudo (o salió negra) */
export async function quickShot(file: string): Promise<{ w: number; h: number } | null> {
  const m = /^(\d+) (\d+)$/.exec(await ask(`shot ${file}`))
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}
/** Para el registro de diagnóstico */
export const windowInfo = (hwnd: string): Promise<string> => ask(`info ${hwnd}`)
