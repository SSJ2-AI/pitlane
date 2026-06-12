# PitLane Compliance — Honest Engineering Analysis

**Status:** Internal. Engineering opinion, not legal advice — get a privacy lawyer to sign off on the story you tell enterprise dealer groups.

This doc exists because the "PitLane is just a wrapper around CDK + ElevenLabs, so we don't really store PII" framing has surfaced more than once. The framing is partially right and partially wrong, and the parts where it's wrong are the ones that drive real compliance obligations. This is the honest read.

---

## 1. What PitLane Supabase actually stores

Grounded in `supabase/migrations/0001_aria_intelligence_layer.sql`, `0002_sms_layer.sql`, and `0003_multi_tenancy.sql`.

### First-party PII PitLane creates and stores (does NOT exist in CDK)

| Table.column | Type | Why it's PII |
|---|---|---|
| `call_logs.caller_phone` | text (E.164) | Direct identifier |
| `call_logs.transcript` | jsonb | Verbatim conversation contents — see §2 |
| `call_logs.summary` | jsonb | GPT-generated narrative referencing the caller by name + vehicle |
| `sms_log.to_phone` | text | Direct identifier |
| `sms_log.message` | text | Full plaintext SMS body, includes name + vehicle + appointment |
| `loaner_requests.notes` | text | Free-form, often derived from `summary.summary_text` |

### Opaque pass-through fields (the "wrapper" claim holds for these)

| Table.column | Why it isn't PII alone |
|---|---|
| `appointments.customer_id`, `vehicle_id` | Opaque CDK identifiers. Useless without joining to CDK's customer table. |
| `upsells.customer_id`, `vehicle_id` | Same |
| `cdk_sync_queue.payload` (jsonb) | Contains `customer_id` but not name/phone/email — we only sync operational columns |
| `sms_consent.customer_id`, `opted_in` | Identifier + boolean |
| `appointments.service_type`, `advisor`, `date`, `time` | Operational, not personal |

### Secret material (not PII but high-impact if leaked)

| Table.column | Risk |
|---|---|
| `dealers.fortellis_client_secret` | Per-dealer OAuth secret. Plaintext in DB today. See §3. |
| `dealers.fortellis_client_id` | Less critical alone but part of the OAuth pair |

### Bottom line on §1

The transcripts and SMS message bodies are **first-party customer PII that PitLane originates, stores, and processes**. They don't exist anywhere in CDK. The "I'm just a wrapper" framing is wrong about these two fields. Every compliance decision flows from accepting that.

---

## 2. Is the transcript "sensitive PII" or "just a CRM note"?

Push back: it's not a CRM note. It's a phone-call-recording-equivalent transcript. Three reasons it's a different compliance category:

**Volume + verbatim-ness.** A CRM note is an advisor's *summary* of what the customer said ("customer wants brakes done by Friday, mentioned loaner"). A transcript is the literal words the customer spoke, in full. Right-to-be-forgotten, consent, breach-notification implications are materially different between "we have notes about Jane" and "we have an audio-derived transcript of everything Jane said for 8 minutes."

**Unstructured PII contamination.** A CRM note's PII content is bounded by what the advisor chose to write. A transcript's content is bounded by whatever the customer chose to say. Customers volunteer things on phone calls that they would never write in a form: medical conditions, financial intent, divorce, accusations against staff. You don't get to opt out of receiving that data — Aria captures whatever the customer says.

**Recording-equivalence.** In Canada, "one-party consent" covers a dealership recording its own calls. But once you store a verbatim transcript, regulators and class-action plaintiffs treat it equivalent to the recording itself. A transcript leak is a recording leak, legally.

### Practical implications

- Retention policy needed (default: 24 months; let dealerships configure shorter).
- "Delete on customer request" must actually delete the transcript row, not just orphan FKs. The `ON DELETE SET NULL` design we have is for `call_log_id`-pointing rows; the transcript itself lives on `call_logs.transcript` and needs `DELETE FROM call_logs WHERE id = ?`.
- Dealership's customer-facing privacy notice must disclose: calls are recorded, transcribed, AI-analyzed, stored with a third-party processor (PitLane).
- This is a DPA-required relationship, not a "we're just a tool" relationship.

### The architectural alternative if compliance scope must shrink

Don't store the transcript verbatim. Store only the structured summary. The full transcript can stay in ElevenLabs (their retention policy applies), and PitLane only persists `summary` JSON. This is a real choice with real trade-offs:

| Keep transcripts | Drop transcripts |
|---|---|
| Powerful search ("when did Aria last mention PCCB?") | Only summary-level search |
| Disputes resolvable from transcript | Disputes require ElevenLabs cooperation |
| Higher compliance burden | Lower compliance burden |
| Storage cost grows with traffic | Bounded growth |

This is worth a product decision but not in scope today.

---

## 3. `dealers.fortellis_client_secret` blast radius

**Encrypting it is not nice-to-have. It's a hard requirement before dealer #2 lands.**

### Today (one dealer, secret in Railway env var)

Fine. Railway env vars are scoped to the service, not stored in Supabase, not visible to any external caller.

### The moment N dealers land in the `dealers` table with `fortellis_client_secret` stored plaintext

**Blast radius if the Supabase service-role key leaks:**

1. Attacker `SELECT * FROM dealers` → every dealer's CDK OAuth secret + subscription_id + client_id.
2. For each, completes OAuth `client_credentials` flow → short-lived bearer token.
3. Token + `Subscription-Id` (also in the row) authenticates as PitLane against every dealer's CDK.
4. **Read access:** every customer, every vehicle, every RO, every invoice, every appointment, every recall, across every rooftop.
5. **Write access:** insert fake appointments, modify RO notes (less interesting to most attackers but devastating for trust + audit).
6. Dealerships can revoke from Fortellis dashboard — but only AFTER they discover the breach. Fortellis audit logs may take hours to surface anomalous access. Token exfil window can be sized in hours, not minutes.

For 22 Lithia Canada rooftops × N-thousand-customers-per-rooftop, the worst case is six figures of breached customer records. This is the kind of breach that ends a startup.

### How service-role keys actually leak in production

- Engineer commits `.env` to a public branch (history is recoverable for 30-90 days after force-push).
- Engineer's laptop is stolen / phished.
- A Next.js API route returns the key in an error response — JSON-serializing an Error object that wraps the Supabase client can leak the key. Has happened to other YC-stage SaaS startups in the wild.
- Supabase project admin password reused on a breached site.
- Honest insider exfiltration (especially common around layoffs).

None of these are unlikely.

### Required mitigation (envelope encryption)

- New `voice/src/lib/secrets.ts` wraps `crypto.createCipheriv('aes-256-gcm', ...)`.
- Encryption key (`PITLANE_FIELD_ENCRYPTION_KEY`) is a Railway env var. **NOT** stored in Supabase.
- `dealers.fortellis_client_secret` and `dealers.fortellis_client_id` stored as `<iv>:<ciphertext>:<auth_tag>` base64.
- Encrypt on insert, decrypt on read in `voice/src/lib/dealer.ts` immediately before constructing the Fortellis client.
- Migration to encrypt existing rows: one-off script, ~20 lines.

**Now a two-system compromise is required to do damage**: attacker needs both the Supabase service-role key AND the Railway field-encryption key. Standard envelope encryption pattern; not novel.

### Effort: half a day. Recommendation: ship before dealer #2.

---

## 4. SOC 2 — can we go to market without it?

**Yes, with caveats. The first meeting won't shut down. The pilot might. Enterprise go-live will.**

### How dealer-group vendor risk actually works

| Stage | What's asked |
|---|---|
| Pre-pilot meeting (Rob's level) | Does the product work? What does it cost? No security questionnaire. |
| Post-pilot-interest IT review | SOC 2 Type II is the default ask. Compensating controls accepted for startups. |
| Pilot signed (1-2 stores) | Security questionnaire (SIG Lite is common), DPA, cyber insurance, pen test report or scheduled date. |
| Enterprise go-live (22 stores) | SOC 2 Type II audited. Non-negotiable for a group at Lithia's scale. |

### Credible startup alternative to "we have SOC 2 today"

Bring all six:
1. **SOC 2 Type I in progress** with a specific audit firm + date.
2. **Security questionnaire** response (Vanta or Drata generates this automatically once you start their program).
3. **DPA / MSA template** ready to send.
4. **Pen test scheduled** — firm + date.
5. **Cyber liability insurance** bound. Real policy, real carrier, real dollar amount ($1-2M typical for early-stage).
6. **Architectural story** — least-privilege Fortellis OAuth, dealer-controlled kill switch, audit logging via `call_logs` + `sms_log` + `cdk_sync_queue`. This we have.

### The pitch to deliver to Rob and his IT

"We're 90 days into SOC 2 Type I implementation with [Vanta or Drata]. Type I report Q3, Type II audited Q1 next year. For the pilot, we'd operate at 1-2 stores under a security questionnaire + DPA + cyber insurance until Type I lands. Here's the architecture brief — happy to walk your security lead through any of it."

### Cost of NOT being in a SOC 2 program

Lithia is the largest dealer group in North America. They have a vendor risk program. They got burned by the CDK ransomware (June 2024) at material cost to their dealer customers. They are not a "we'll figure compliance out later" buyer. Walking in without a SOC 2 program in motion = the IT review shelves you for 6+ months.

### Action

Sign up for Vanta or Drata this week. ~$10-30K/year. Type I audit: another ~$10-15K. Total ~$25-50K and 3-6 months to first credible report. Price of taking the meeting seriously. Not optional for an enterprise close.

---

## 5. Canadian data residency

**Not legally required under PIPEDA. Required for Quebec dealerships under Law 25. Strongly preferred by every Canadian dealer IT department.**

### Framework

| Regulation | Requirement |
|---|---|
| **PIPEDA** (federal) | No storage-in-Canada mandate. Requires "comparable level of protection" for cross-border transfers AND transparent disclosure to data subjects. The dealership's customer privacy notice must disclose US processing. Real disclosure burden the dealer manages, not free. |
| **Quebec Law 25** (in force since Sept 2022) | Explicitly requires a privacy impact assessment before transferring personal information outside Quebec, AND a contractual commitment from the recipient. For Quebec rooftops (Pfaff has some), US-hosting creates real friction. |
| **Ontario Bill 194 / planned reforms** | Trajectory mirrors Quebec. Residency requirements are coming, not going. |

### The "CDK is already US-hosted, so adding PitLane is non-incremental" argument

Technically true under PIPEDA. Legally weak in practice:
- The dealership has *already* navigated disclosure + DPA mechanics for CDK.
- Adding PitLane means another disclosure, another DPA, another PIA. Not a doubling of legal risk but real incremental work for the dealer's privacy team.
- Vendor-list-bloat is something IT and Legal both push back on. "One more US-hosted processor" is a soft no in Quebec.

### Why moving to `ca-central-1` is worth it

- **Quebec rooftops become signable** without a Law 25 PIA per customer.
- **Sales-cycle compression**: "your data never leaves Canada" replaces a 20-minute disclosure discussion with a one-liner.
- **Marketing/competitive moat**: xtime, CDK, and most US-based dealer tech are US-hosted. Post-CDK-ransomware, every Canadian dealer is more receptive to Canadian infrastructure.
- **Cost: trivial.** Supabase has `ca-central-1`; Railway has Canadian regions.

### Effort

- Supabase: create new project in `ca-central-1`, dump current DB, restore, swap env vars. ~Half a day.
- Railway: change service region. ~10 minutes.

### Recommendation

Do it before launch. The cost is half a day; the return is Quebec-dealer-signable + a clean residency story + a real differentiator.

### Counter (if migration cost is unacceptable)

Stay US-hosted, but commit IN WRITING (in the DPA template) to:
- The dealership's customer-facing disclosure burden.
- Per-Quebec-dealer PIA support.
- Sub-processor list maintenance with notification SLAs.

Functionally workable. Material sales-cycle friction. Don't recommend.

---

## TL;DR — what we'd actually do

| Sulaim's claim | My honest take |
|---|---|
| "I'm just a wrapper, the data lives in CDK." | Wrong about transcripts + SMS bodies. Those are first-party PII PitLane creates. |
| "Transcripts are like CRM notes." | Wrong. Recording-equivalent. Higher compliance category. Plan retention + deletion. |
| "Fortellis secret encryption can wait." | OK for single-dealer pilot. Required before dealer #2. Half-day implementation. |
| "We can go in without SOC 2." | First meeting: yes. Pilot: with compensating controls. Go-live at 22 stores: no. Buy Vanta/Drata this week. |
| "Canadian residency doesn't matter if CDK is US-hosted." | Legally true under PIPEDA. False under Quebec Law 25. Sales-weak everywhere. Migrate before launch. |

### Three things to do this week (if Lithia is to convert)

1. **Sign Vanta or Drata.** Kick off SOC 2 Type I. ~$10-30K. ⏳ external
2. **Migrate Supabase to `ca-central-1`.** ~Half a day in the Supabase console (dump + restore). ⏳ external
   - **Railway has no Canadian region as of June 2026.** Lineup is
     us-west2, us-east4, europe-west4, asia-southeast1, asia-southeast2.
     We pinned `us-east4` (Virginia, closest to Toronto) in
     `voice/railway.toml` with a TODO to switch when Railway ships one.
     The voice service is stateless — Supabase is the actual residency
     anchor for the PII-at-rest claim. `/health` surfaces both regions
     so IT can verify.
3. **Envelope encryption for `dealers.fortellis_client_secret`.** ✅ shipped on Phase 5 branch.
   - AES-256-GCM, key in `FORTELLIS_ENCRYPTION_KEY` env var on Railway, never in Supabase.
   - `enc:v1:<iv>:<tag>:<ct>` format, idempotent migration via `npm run encrypt-secrets`, self-tested at build time.
   - Decrypted on demand via `getDealerFortellisCredentials(dealer)`, never eagerly.

These move the security brief from "in progress" promises to "shipped" facts before the IT review starts.
