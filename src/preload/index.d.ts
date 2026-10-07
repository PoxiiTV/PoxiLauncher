export {}

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (event: string, cb: (data: unknown) => void) => () => void
    }
  }
}
