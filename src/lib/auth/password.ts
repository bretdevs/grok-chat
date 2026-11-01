import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLEL = 1;
const KEY_BYTES = 32;
/** scrypt needs about 128 * cost * blockSize of memory, well under this ceiling. */
const MAX_MEMORY = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { cost: COST, blockSize: BLOCK_SIZE, parallel: PARALLEL, bytes: KEY_BYTES });
  return ["scrypt", COST, BLOCK_SIZE, PARALLEL, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Reads the parameters back out of the stored hash, so older hashes keep working. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, blockSize, parallel, salt, expected] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const want = Buffer.from(expected ?? "", "base64url");
  if (!want.length) return false;
  try {
    const got = await derive(password, Buffer.from(salt ?? "", "base64url"), {
      cost: Number(cost),
      blockSize: Number(blockSize),
      parallel: Number(parallel),
      bytes: want.length,
    });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

type Params = { cost: number; blockSize: number; parallel: number; bytes: number };

function derive(password: string, salt: Buffer, { cost, blockSize, parallel, bytes }: Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, bytes, { N: cost, r: blockSize, p: parallel, maxmem: MAX_MEMORY }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}
