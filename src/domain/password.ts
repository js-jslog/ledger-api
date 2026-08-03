import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number },
) => Promise<Buffer>

/**
 * The brief's Node-performance point made concrete: hashing is the one CPU-bound
 * thing in this service, so it uses the async API. `crypto.scrypt` hands the work to
 * libuv's threadpool, so it does not block the event loop — unlike `scryptSync`.
 *
 * Threadpool default size is 4 (UV_THREADPOOL_SIZE). That is the real capacity limit
 * on the login endpoint, not the event loop, and it is a better answer than "Node is
 * fast enough".
 */
const PARAMS = { N: 2 ** 14, r: 8, p: 1 }
const KEYLEN = 32

export const hashPassword = async (plain: string): Promise<string> => {
  const salt = randomBytes(16)
  const key = await scryptAsync(plain, salt, KEYLEN, PARAMS)
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export const verifyPassword = async (plain: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string]
  const expected = Buffer.from(keyB64, 'base64')
  const actual = await scryptAsync(plain, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  })
  return timingSafeEqual(expected, actual)
}
