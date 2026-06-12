/* eslint-disable no-console */
//
// One-shot migration: encrypt every plaintext fortellis_client_secret in the
// dealers table using the AES-256-GCM helpers in src/lib/secrets.ts.
//
// Idempotent — re-runs are no-ops because rows already in the enc:v1: format
// are skipped via isEncrypted().
//
// Usage (after `npm run build`):
//   node dist/scripts/encrypt-fortellis-secrets.js              # encrypt now
//   node dist/scripts/encrypt-fortellis-secrets.js --selftest   # crypto only
//   node dist/scripts/encrypt-fortellis-secrets.js --dry-run    # report only
//
// Or via npm: `npm run encrypt-secrets`.

import { encrypt, isEncrypted, isEncryptionConfigured, selftest } from '../lib/secrets'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import dotenv from 'dotenv'

dotenv.config()

interface DealerRow {
    id: string
    name: string
    fortellis_client_secret: string | null
}

async function main(): Promise<number> {
    const args = new Set(process.argv.slice(2))
    const isSelftest = args.has('--selftest')
    const isDryRun = args.has('--dry-run')

    // Always run the crypto self-test up front — fails fast if the key is
    // misconfigured before we touch the database.
    const st = selftest()
    if (!st.ok) {
        console.error(`[encrypt-fortellis-secrets] crypto self-test FAILED: ${st.reason}`)
        return 1
    }
    console.log('[encrypt-fortellis-secrets] crypto self-test passed')
    if (isSelftest) return 0

    if (!isEncryptionConfigured()) {
        console.error('[encrypt-fortellis-secrets] FORTELLIS_ENCRYPTION_KEY not set')
        console.error('  Generate one with: openssl rand -base64 32')
        return 1
    }
    if (!isSupabaseConfigured()) {
        console.error('[encrypt-fortellis-secrets] SUPABASE_URL / SUPABASE_*_KEY not set')
        return 1
    }

    const supabase = getSupabase()
    if (!supabase) {
        console.error('[encrypt-fortellis-secrets] failed to construct Supabase client')
        return 1
    }

    const { data, error } = await supabase
        .from('dealers')
        .select('id, name, fortellis_client_secret')
    if (error) {
        console.error(`[encrypt-fortellis-secrets] dealers SELECT failed: ${error.message}`)
        return 1
    }

    const rows = (data ?? []) as DealerRow[]
    let encrypted = 0
    let skippedAlreadyEncrypted = 0
    let skippedNoSecret = 0
    let failed = 0

    for (const row of rows) {
        const secret = row.fortellis_client_secret
        if (!secret || secret.length === 0) {
            skippedNoSecret++
            continue
        }
        if (isEncrypted(secret)) {
            skippedAlreadyEncrypted++
            continue
        }

        if (isDryRun) {
            console.log(`[encrypt-fortellis-secrets] (dry-run) would encrypt ${row.name} (${row.id})`)
            encrypted++
            continue
        }

        try {
            const ciphertext = encrypt(secret)
            const { error: updateError } = await supabase
                .from('dealers')
                .update({ fortellis_client_secret: ciphertext })
                .eq('id', row.id)
            if (updateError) throw updateError
            console.log(`[encrypt-fortellis-secrets] encrypted: ${row.name} (${row.id})`)
            encrypted++
        } catch (err) {
            failed++
            console.error(
                `[encrypt-fortellis-secrets] FAILED to encrypt ${row.name} (${row.id}): ` +
                (err instanceof Error ? err.message : String(err)),
            )
        }
    }

    console.log('')
    console.log('─── Summary ───')
    console.log(`  total rows:               ${rows.length}`)
    console.log(`  encrypted:                ${encrypted}${isDryRun ? ' (dry-run)' : ''}`)
    console.log(`  already encrypted:        ${skippedAlreadyEncrypted}`)
    console.log(`  no secret on file:        ${skippedNoSecret}`)
    console.log(`  failed:                   ${failed}`)
    return failed > 0 ? 2 : 0
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error('[encrypt-fortellis-secrets] unhandled error:', err)
        process.exit(1)
    })
