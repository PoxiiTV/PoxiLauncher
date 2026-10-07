// Uso: npm run hash-password -- "tu contraseña"  →  imprime el valor para ADMIN_PASSWORD_HASH
import bcrypt from 'bcrypt'

const pass = process.argv[2]
if (!pass || pass.length < 10) {
  console.error('Pasa una contraseña de al menos 10 caracteres: npm run hash-password -- "tu contraseña"')
  process.exit(1)
}
console.log(await bcrypt.hash(pass, 12))
