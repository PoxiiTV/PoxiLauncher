import { z } from 'zod'

// Toda la configuración sale del .env (nunca valores secretos en el código).
const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATA_DIR: z.string().min(1).default('./data'),
  /** Hash bcrypt de la contraseña del panel (npm run hash-password -- "tu contraseña") */
  ADMIN_PASSWORD_HASH: z.string().regex(/^\$2[aby]\$\d{2}\$/, 'ADMIN_PASSWORD_HASH debe ser un hash bcrypt'),
  /** Secreto para firmar las sesiones (mínimo 32 caracteres aleatorios) */
  JWT_SECRET: z.string().min(32),
  /** Token para publicar desde publish.bat (mínimo 32 caracteres aleatorios) */
  DEPLOY_TOKEN: z.string().min(32),
  /** Clave de KLIPY (GIFs y stickers del chat). Sin ella, el chat no tiene buscador de GIFs */
  KLIPY_API_KEY: z.string().regex(/^[\w-]{10,200}$/).optional(),
  /** Tamaño máximo del mundo compartido de cada pack de Minecraft (MB) */
  MAX_WORLD_MB: z.coerce.number().int().min(10).max(4096).default(500),
  /** true en producción (HTTPS vía Cloudflare): cookies solo por HTTPS */
  SECURE_COOKIES: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true')
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  // Solo el nombre de la variable, nunca su valor
  console.error('Configuración inválida en .env:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  process.exit(1)
}

export const config = parsed.data
