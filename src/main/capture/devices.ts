// Pantallas y salidas de audio para los clips, preguntando a Windows (un PowerShell que compila un poco de C#):
//  · «list»: las pantallas en el mismo orden en que las numera FFmpeg (DXGI, la gráfica principal) con su posición, y los
//    dispositivos de salida de audio con su nombre.
//  · «loop <id>»: lo que suena en ese dispositivo (WASAPI «loopback»), en float de 32 bits estéreo, por la salida
//    estándar. La primera línea dice la frecuencia («fmt 48000»). Si no suena nada, Windows no manda nada: se rellena
//    con silencio para que el sonido del clip no se descuadre con la imagen.
// (Chromium solo da el audio del dispositivo predeterminado: para elegir otro hace falta esto.)
import { spawn, type ChildProcess } from 'node:child_process'

const SCRIPT = `
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Text; using System.Threading; using System.Diagnostics;
using System.Runtime.InteropServices;

// ——— DXGI: las pantallas de la gráfica principal (las que ve ddagrab), en su orden ———
[ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDXGIFactory1 {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
  [PreserveSig] int EnumAdapters1(uint i, out IDXGIAdapter1 a);
}
[ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDXGIAdapter1 {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  [PreserveSig] int EnumOutputs(uint i, out IDXGIOutput o);
}
[ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDXGIOutput {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  [PreserveSig] int GetDesc(out OutputDesc d);
}
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
struct OutputDesc { [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name; public int L, T, R, B; public int Attached; public int Rotation; public IntPtr Monitor; }

// ——— Audio (MMDevice + WASAPI) ———
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { [PreserveSig] int GetCount(out uint n); [PreserveSig] int Item(uint i, out IMMDevice d); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore s);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { [PreserveSig] int GetCount(out uint n); [PreserveSig] int GetAt(uint i, out PKey k); [PreserveSig] int GetValue(ref PKey k, out PropVar v); }
[StructLayout(LayoutKind.Sequential)] struct PKey { public Guid Fmt; public int Pid; }
[StructLayout(LayoutKind.Sequential)] struct PropVar { public short Vt; public short R1, R2, R3; public IntPtr P; public IntPtr P2; }
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  [PreserveSig] int Initialize(int share, int flags, long dur, long period, IntPtr fmt, IntPtr session);
  [PreserveSig] int GetBufferSize(out uint n);
  [PreserveSig] int GetStreamLatency(out long l);
  [PreserveSig] int GetCurrentPadding(out uint n);
  [PreserveSig] int IsFormatSupported(int share, IntPtr fmt, out IntPtr closest);
  [PreserveSig] int GetMixFormat(out IntPtr fmt);
  [PreserveSig] int GetDevicePeriod(out long def, out long min);
  [PreserveSig] int Start();
  [PreserveSig] int Stop();
  [PreserveSig] int Reset();
  [PreserveSig] int SetEventHandle(IntPtr h);
  [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}
[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient {
  [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out long pos, out long qpc);
  [PreserveSig] int ReleaseBuffer(uint frames);
  [PreserveSig] int GetNextPacketSize(out uint n);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

public static class D {
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object f);
  static string Esc(string s) { return (s ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\""); }

  public static string List() {
    var sb = new StringBuilder("{\\"screens\\":[");
    try {
      Guid g = typeof(IDXGIFactory1).GUID; object fo; CreateDXGIFactory1(ref g, out fo);
      var f = (IDXGIFactory1)fo; IDXGIAdapter1 a;
      if (f.EnumAdapters1(0, out a) == 0) {
        IDXGIOutput o;
        for (uint i = 0; a.EnumOutputs(i, out o) == 0; i++) {
          OutputDesc d; o.GetDesc(out d);
          if (i > 0) sb.Append(',');
          sb.Append("{\\"idx\\":" + i + ",\\"name\\":\\"" + Esc(d.Name) + "\\",\\"x\\":" + d.L + ",\\"y\\":" + d.T + ",\\"w\\":" + (d.R - d.L) + ",\\"h\\":" + (d.B - d.T) + "}");
        }
      }
    } catch { }
    sb.Append("],\\"audio\\":[");
    try {
      var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      string def = ""; IMMDevice dd;
      if (e.GetDefaultAudioEndpoint(0, 1, out dd) == 0) dd.GetId(out def);
      IMMDeviceCollection c; e.EnumAudioEndpoints(0, 1, out c); uint n; c.GetCount(out n);
      var name = new PKey { Fmt = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), Pid = 14 };
      for (uint i = 0; i < n; i++) {
        IMMDevice d; c.Item(i, out d); string id; d.GetId(out id);
        IPropertyStore ps; d.OpenPropertyStore(0, out ps); PropVar v; ps.GetValue(ref name, out v);
        string label = v.Vt == 31 ? Marshal.PtrToStringUni(v.P) : id;
        if (i > 0) sb.Append(',');
        sb.Append("{\\"id\\":\\"" + Esc(id) + "\\",\\"name\\":\\"" + Esc(label) + "\\",\\"default\\":" + (id == def ? "true" : "false") + "}");
      }
    } catch { }
    return sb.Append("]}").ToString();
  }

  // Lo que suena en ese dispositivo, en float estéreo, por la salida estándar (hasta que se cierre)
  public static void Loop(string id) {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev; if (e.GetDevice(id, out dev) != 0) { Console.Out.WriteLine("err"); return; }
    Guid iac = typeof(IAudioClient).GUID; object co; dev.Activate(ref iac, 1, IntPtr.Zero, out co);
    var ac = (IAudioClient)co; IntPtr fmt; ac.GetMixFormat(out fmt);
    int ch = Marshal.ReadInt16(fmt, 2), rate = Marshal.ReadInt32(fmt, 4), bits = Marshal.ReadInt16(fmt, 14), tag = Marshal.ReadInt16(fmt, 0) & 0xffff;
    bool isFloat = tag == 3 || (tag == 0xFFFE && Marshal.ReadInt32(fmt, 24) == 3);
    if (ac.Initialize(0, 0x00020000, 10000000, 0, fmt, IntPtr.Zero) != 0) { Console.Out.WriteLine("err"); return; }
    Guid icc = typeof(IAudioCaptureClient).GUID; object cco; ac.GetService(ref icc, out cco); var cc = (IAudioCaptureClient)cco;
    var outp = Console.OpenStandardOutput();
    var head = Encoding.ASCII.GetBytes("fmt " + rate + "\\n"); outp.Write(head, 0, head.Length); outp.Flush();
    ac.Start();
    var sw = Stopwatch.StartNew(); long written = 0; int bpf = ch * bits / 8; byte[] buf = new byte[0];
    while (true) {
      Thread.Sleep(10);
      uint size; while (cc.GetNextPacketSize(out size) == 0 && size > 0) {
        IntPtr data; uint frames, flags; long p1, p2;
        if (cc.GetBuffer(out data, out frames, out flags, out p1, out p2) != 0) break;
        int need = (int)frames * 8; if (buf.Length < need) buf = new byte[need];
        if ((flags & 2) != 0) Array.Clear(buf, 0, need);
        else {
          var raw = new byte[frames * bpf]; Marshal.Copy(data, raw, 0, raw.Length);
          for (int f = 0; f < frames; f++) for (int k = 0; k < 2; k++) {
            int c = k < ch ? k : 0, o = f * bpf + c * bits / 8; float s;
            if (isFloat && bits == 32) s = BitConverter.ToSingle(raw, o);
            else if (bits == 16) s = BitConverter.ToInt16(raw, o) / 32768f;
            else if (bits == 32) s = BitConverter.ToInt32(raw, o) / 2147483648f;
            else s = 0;
            Buffer.BlockCopy(BitConverter.GetBytes(s), 0, buf, f * 8 + k * 4, 4);
          }
        }
        cc.ReleaseBuffer(frames);
        outp.Write(buf, 0, need); written += frames;
      }
      // Sin sonido no llega nada: silencio hasta la hora (con un poco de margen para no pisar lo que esté llegando)
      long due = (long)(sw.Elapsed.TotalSeconds * rate) - rate / 50;
      if (due > written) { int pad = (int)(due - written); var z = new byte[pad * 8]; outp.Write(z, 0, z.Length); written += pad; }
      outp.Flush();
    }
  }
}
'@
$l = [Console]::In.ReadLine()
if ($l -eq 'list') { [Console]::Out.WriteLine([D]::List()) }
elseif ($l.StartsWith('loop ')) { [D]::Loop($l.Substring(5)) }
`

export interface ClipScreen {
  /** Número de FFmpeg (ddagrab output_idx) */
  idx: number
  /** Nombre de Windows («\\\\.\\DISPLAY2»): es lo que se guarda (el número cambia si conectas o quitas pantallas) */
  name: string
  x: number
  y: number
  w: number
  h: number
}
export interface AudioOut {
  id: string
  name: string
  default: boolean
}

const run = (): ChildProcess =>
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })

/** Pantallas y salidas de audio (vacío si Windows no contesta en 20 s) */
export function listDevices(): Promise<{ screens: ClipScreen[]; audio: AudioOut[] }> {
  return new Promise((resolve) => {
    const p = run()
    let out = ''
    const done = (): void => {
      clearTimeout(t)
      try {
        const j = JSON.parse(out.trim().split('\n').pop() ?? '') as { screens?: ClipScreen[]; audio?: AudioOut[] }
        resolve({ screens: j.screens ?? [], audio: j.audio ?? [] })
      } catch {
        resolve({ screens: [], audio: [] })
      }
    }
    const t = setTimeout(() => {
      p.kill()
      done()
    }, 20_000)
    p.stdout?.on('data', (d: Buffer) => (out += d.toString('utf8')))
    p.on('exit', done)
    p.on('error', done)
    p.stdin?.end('list\n')
  })
}

/** Grabar lo que suena en ese dispositivo: `onPcm` con float estéreo a `rate` Hz (la primera vez, tras «fmt»). null si
 * no se pudo arrancar. Se para con kill() */
export function loopback(id: string, onFormat: (rate: number) => void, onPcm: (b: Buffer) => void, onEnd: () => void): ChildProcess {
  const p = run()
  let head = true
  let pending = Buffer.alloc(0)
  p.stdout?.on('data', (d: Buffer) => {
    if (!head) return onPcm(d)
    pending = Buffer.concat([pending, d])
    const nl = pending.indexOf(10)
    if (nl < 0) return
    const m = /^fmt (\d+)/.exec(pending.subarray(0, nl).toString('ascii'))
    head = false
    if (!m) {
      p.kill()
      return
    }
    onFormat(Number(m[1]))
    const rest = pending.subarray(nl + 1)
    if (rest.length) onPcm(rest)
  })
  p.on('exit', onEnd)
  p.on('error', onEnd)
  p.stdin?.write(`loop ${id}\n`)
  return p
}
