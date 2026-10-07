import { describe, expect, it } from 'vitest'
import { OVERLAY_HOTKEY, hotkeyLabel, isAccelerator, toAccelerator } from '../src/shared/hotkey'

const press = (code: string, key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  code,
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

describe('atajos de teclado', () => {
  it('de la pulsación al atajo de Electron, por la tecla física', () => {
    expect(toAccelerator(press('F1', 'F1', { shift: true }))).toBe('Shift+F1')
    expect(toAccelerator(press('KeyF', 'F', { ctrl: true, shift: true }))).toBe('CommandOrControl+Shift+F')
    // Con el teclado español la tecla de la Ñ o la de la º siguen siendo su tecla física
    expect(toAccelerator(press('Backquote', 'º', { alt: true }))).toBe('Alt+`')
    expect(toAccelerator(press('Home', 'Home', { shift: true }))).toBe('Shift+Home')
  })

  it('solo modificadores o una letra suelta todavía no valen; una F suelta sí', () => {
    expect(toAccelerator(press('ShiftLeft', 'Shift', { shift: true }))).toBeNull()
    expect(toAccelerator(press('KeyA', 'a'))).toBeNull()
    expect(toAccelerator(press('F9', 'F9'))).toBe('F9')
  })

  it('valida lo que llega de fuera y lo enseña en español', () => {
    expect(isAccelerator(OVERLAY_HOTKEY)).toBe(true)
    expect(isAccelerator('CommandOrControl+Shift+F')).toBe(true)
    expect(isAccelerator('Shift+F1; rm -rf')).toBe(false)
    expect(isAccelerator('Super+F1')).toBe(false)
    expect(hotkeyLabel(OVERLAY_HOTKEY)).toBe('Mayús + F1')
    expect(hotkeyLabel('CommandOrControl+Shift+F')).toBe('Ctrl + Mayús + F')
    expect(hotkeyLabel('CommandOrControl+Shift+F', 'en')).toBe('Ctrl + Shift + F')
  })
})
