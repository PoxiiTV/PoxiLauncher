import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, shell: {} }))
const { planShortcuts } = await import('../src/main/system/shortcuts')

const EXE = 'C:\\Program Files\\PoxiLauncher\\PoxiLauncher.exe'

describe('accesos del menú Inicio (icono y nombre en la barra de tareas)', () => {
  it('quita el acceso que dejó Electron con nuestro identificador', () => {
    const plan = planShortcuts(
      [
        { path: 'Electron.lnk', target: 'F:\\PoxiLauncher\\node_modules\\electron\\dist\\electron.exe', aumid: 'com.poxi.poxilauncher' },
        { path: 'Otra.lnk', target: 'C:\\otra.exe', aumid: 'com.otra.app' }
      ],
      'com.poxi.poxilauncher',
      EXE
    )
    expect(plan.remove).toEqual(['Electron.lnk'])
    expect(plan.create).toBe(true)
  })

  it('respeta el acceso bueno (aunque cambien mayúsculas de la ruta)', () => {
    const plan = planShortcuts([{ path: 'PoxiLauncher.lnk', target: EXE.toLowerCase(), aumid: 'com.poxi.poxilauncher' }], 'com.poxi.poxilauncher', EXE)
    expect(plan).toEqual({ remove: [], create: false })
  })

  it('portable: el acceso a una carpeta temporal ya borrada se cambia por uno al .exe de verdad', () => {
    const real = 'D:\\Juegos\\PoxiLauncher-Portable-1.5.1.exe'
    const plan = planShortcuts(
      [{ path: 'PoxiLauncher.lnk', target: 'C:\\Users\\x\\AppData\\Local\\Temp\\3Jo\\PoxiLauncher.exe', aumid: 'com.poxi.poxilauncher.portable' }],
      'com.poxi.poxilauncher.portable',
      real
    )
    expect(plan).toEqual({ remove: ['PoxiLauncher.lnk'], create: true })
  })
})
