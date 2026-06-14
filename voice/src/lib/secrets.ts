import crypto from 'crypto'

// ─── PitLane × application-layer secret encryption ──────────────────────────
//
// Envelope encryption for dealer-level credentials we store in Supabase
// (currently dealers.fortellis_client_secret; client_id can be added later
// for paranoia). The encryption key lives in the FORTELLIS_ENCRYPTION_KEY
// Railway env var — NOT in Supabase — so a Supabase service-role-key leak
// alone cannot decrypt secrets. Two-system compromise required.
//
// Encoded format:
//   enc:v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
//
// The `enc:v1:` prefix lets us:
//   1. Detect whether a value is already encrypted (idempotent migration).
//   2. Roll forward to v2 in the future without breaking v1 ciphertext.
//
// Algorithm: AES-256-GCM (authenticated encryption, no separate MAC needed).
// IV: 12 random bytes per encryption (NIST SP 800-38D recommended for GCM).
// Key: 32 bytes (256 bits) loaded from FORTELLIS_ENCRYPTION_KEY in either
// hex or base64.
//
// Generate a key with: `openssl rand -base64 32`

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH_BYTES = 12
const KEY_LENGTH_BYTES = 32
const VERSION = 'v1'
const PREFIX = 'enc:'

function loadKey(): Buffer | null {
    const raw = (process.env.FORTELLIS_ENCRYPTION_KEY ?? '').trim()
    if (!raw) return null

    let key: Buffer
    if (/^[0-9a-f]{64}$/i.test(raw)) {
        // 64-char hex string
        key = Buffer.from(raw, 'hex')
    } else {
        // Try base64 (with or without padding)
        try {
            key = Buffer.from(raw, 'base64')
        } catch {
            throw new Error('FORTELLIS_ENCRYPTION_KEY must be hex (64 chars) or base64 of a 32-byte key')
        }
    }

    if (key.length !== KEY_LENGTH_BYTES) {
        throw new Error(
            `FORTELLIS_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes ` +
            `(got ${key.length}). Generate one with: openssl rand -base64 32`,
        )
    }
    return key
}

/**
 * True when FORTELLIS_ENCRYPTION_KEY is set + decodes to a valid 32-byte key.
 * Cheap to call — used to gate features that need the key.
 */
export function isEncryptionConfigured(): boolean {
    try {
        return loadKey() !== null
    } catch {
        return false
    }
}

/**
 * Distinguishes "key not set" from "key set but invalid" — used by the
 * migration script + the optional boot-time self-test so misconfiguration
 * fails with the right error message instead of "not set".
 */
export function checkEncryptionKey(): { ok: boolean; reason?: string } {
    const raw = (process.env.FORTELLIS_ENCRYPTION_KEY ?? '').trim()
    if (!raw) return { ok: false, reason: 'FORTELLIS_ENCRYPTION_KEY not set' }
    try {
        loadKey()
        return { ok: true }
    } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
}

/**
 * True for values produced by `encrypt()`. Used by the migration script + the
 * decrypt wrapper to treat unencrypted plaintext (legacy) as a back-compat
 * passthrough.
 */
export function isEncrypted(value: string | null | undefined): boolean {
    if (!value) return false
    return value.startsWith(PREFIX)
}

/**
 * Encrypt a plaintext string. Throws when no key is configured.
 *
 * Output is safe to store as text — a single colon-separated base64 blob.
 * Each call produces a fresh IV so the same plaintext encrypts to different
 * ciphertext every time.
 */
export function encrypt(plaintext: string): string {
    if (typeof plaintext !== 'string') {
        throw new TypeError('encrypt() requires a string')
    }
    const key = loadKey()
    if (!key) {
        throw new Error('FORTELLIS_ENCRYPTION_KEY is not set — cannot encrypt')
    }

    const iv = crypto.randomBytes(IV_LENGTH_BYTES)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return [
        PREFIX + VERSION,
        iv.toString('base64'),
        tag.toString('base64'),
        ciphertext.toString('base64'),
    ].join(':')
}

/**
 * Decrypt a value produced by `encrypt()`. If the value isn't encrypted
 * (i.e. legacy plaintext row that pre-dates the migration), it's returned
 * as-is. Throws when the value LOOKS encrypted but the key is missing or
 * doesn't match.
 */
export function decrypt(value: string): string {
    if (!isEncrypted(value)) {
        // Back-compat: pre-migration plaintext rows return as-is. The
        // migration script encrypts these in place; runtime decrypt remains
        // a no-op for unencrypted values to avoid wedging the system during
        // partial migrations.
        return value
    }

    const parts = value.split(':')
    // Expected: ['enc', 'v1', '<iv>', '<tag>', '<ct>']
    if (parts.length !== 5 || `${parts[0]}:` !== PREFIX) {
        throw new Error(`Malformed encrypted value (expected 5 colon-separated parts)`)
    }
    if (parts[1] !== VERSION) {
        throw new Error(`Unsupported encryption version: ${parts[1]} (this build understands ${VERSION})`)
    }

    const key = loadKey()
    if (!key) {
        throw new Error('FORTELLIS_ENCRYPTION_KEY is not set — cannot decrypt an enc: value')
    }

    const iv = Buffer.from(parts[2], 'base64')
    const tag = Buffer.from(parts[3], 'base64')
    const ciphertext = Buffer.from(parts[4], 'base64')

    if (iv.length !== IV_LENGTH_BYTES) {
        throw new Error(`Invalid IV length: ${iv.length}, expected ${IV_LENGTH_BYTES}`)
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString('utf8')
}

/**
 * In-process self-test that round-trips a known plaintext. Used by the
 * migration script's --selftest mode and at boot if SECRETS_SELFTEST=true is
 * set, so a misconfigured key fails fast at startup rather than at the first
 * dealer lookup mid-call.
 */
export function selftest(): { ok: boolean; reason?: string } {
    try {
        const keyCheck = checkEncryptionKey()
        if (!keyCheck.ok) return keyCheck
        const samples = [
            'short',
            'a much longer secret with spaces and 1337 numbers and symbols !@#$%^&*()',
            '🔐 unicode and emoji should round-trip too 🚗',
            '',
        ]
        for (const sample of samples) {
            const ct = encrypt(sample)
            if (!isEncrypted(ct)) return { ok: false, reason: 'encrypt() output not detected as encrypted' }
            const pt = decrypt(ct)
            if (pt !== sample) return { ok: false, reason: `round-trip mismatch for sample of length ${sample.length}` }
        }
        // Tamper resistance: GCM should reject if we flip a byte.
        const ct = encrypt('tamper-target')
        const parts = ct.split(':')
        const tampered = Buffer.from(parts[4], 'base64')
        if (tampered.length > 0) tampered[0] ^= 0x01
        parts[4] = tampered.toString('base64')
        const tamperedValue = parts.join(':')
        let rejected = false
        try {
            decrypt(tamperedValue)
        } catch {
            rejected = true
        }
        if (!rejected) {
            return { ok: false, reason: 'tampered ciphertext was accepted (GCM auth tag check missing?)' }
        }
        return { ok: true }
    } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
}
