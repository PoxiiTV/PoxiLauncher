import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { timingSafeEqual, createHash } from 'node:crypto'
import { config } from './config.js'

// Sesión del panel: access token (15 min) + refresh token (7 días), ambos en cookies httpOnly.
// publish.bat usa en su lugar "Authorization: Bearer <DEPLOY_TOKEN>".

const ACCESS_MS = 15 * 60 * 1000
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000

const cookieOpts = (maxAge, path = '/') => ({
  httpOnly: true,
  secure: config.SECURE_COOKIES,
  sameSite: 'strict',
  maxAge,
  path
})

function issue(res) {
  const access = jwt.sign({ typ: 'access' }, config.JWT_SECRET, { expiresIn: ACCESS_MS / 1000 })
  const refresh = jwt.sign({ typ: 'refresh' }, config.JWT_SECRET, { expiresIn: REFRESH_MS / 1000 })
  res.cookie('pg_access', access, cookieOpts(ACCESS_MS))
  res.cookie('pg_refresh', refresh, cookieOpts(REFRESH_MS, '/api/auth'))
}

export async function login(password, res) {
  const ok = await bcrypt.compare(password, config.ADMIN_PASSWORD_HASH)
  if (ok) issue(res)
  return ok
}

export function refresh(req, res) {
  try {
    const p = jwt.verify(req.cookies?.pg_refresh ?? '', config.JWT_SECRET)
    if (p.typ !== 'refresh') return false
    issue(res)
    return true
  } catch {
    return false
  }
}

export function logout(res) {
  res.clearCookie('pg_access', cookieOpts(0))
  res.clearCookie('pg_refresh', cookieOpts(0, '/api/auth'))
}

// Comparación en tiempo constante (se comparan hashes para igualar longitudes)
const sameSecret = (a, b) =>
  timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

/** Protege rutas: cookie de sesión válida o token de publicación. */
export function requireAuth(req, res, next) {
  const bearer = /^Bearer (.+)$/.exec(req.get('authorization') ?? '')?.[1]
  if (bearer && sameSecret(bearer, config.DEPLOY_TOKEN)) return next()
  try {
    const p = jwt.verify(req.cookies?.pg_access ?? '', config.JWT_SECRET)
    if (p.typ === 'access') return next()
  } catch {
    /* sesión caducada o inexistente */
  }
  res.status(401).json({ error: 'No autorizado' })
}
