import type { Handlers, PushEvent } from '@shared/ipc'

export function invoke<K extends keyof Handlers>(
  channel: K,
  ...args: Parameters<Handlers[K]>
): Promise<Awaited<ReturnType<Handlers[K]>>> {
  return window.api.invoke(channel, ...args) as Promise<Awaited<ReturnType<Handlers[K]>>>
}

export function on<K extends keyof PushEvent>(event: K, cb: (data: PushEvent[K]) => void): () => void {
  return window.api.on(event, cb as (d: unknown) => void)
}
