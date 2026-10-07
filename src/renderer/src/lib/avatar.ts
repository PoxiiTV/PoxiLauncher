import { useEffect, useState } from 'react'
import { invoke } from '../api'

// Fotos de perfil: el proceso principal las guarda en disco por versión; aquí se recuerdan en memoria para que
// cada una se pida una sola vez aunque salga en muchos sitios (barra lateral, amigos, su perfil…).

const cache = new Map<string, Promise<string | null>>()

export function useAvatar(userId?: string, version?: string | null): string | undefined {
  const key = userId && version ? `${userId}-${version}` : ''
  const [src, setSrc] = useState<string | undefined>()
  useEffect(() => {
    setSrc(undefined)
    if (!key) return
    let alive = true
    let p = cache.get(key)
    if (!p) {
      p = invoke('account:avatar', userId!, version!).catch(() => null)
      cache.set(key, p)
    }
    void p.then((url) => {
      // Si no se pudo traer, que se vuelva a intentar más adelante
      if (!url) cache.delete(key)
      if (alive) setSrc(url ?? undefined)
    })
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return src
}
