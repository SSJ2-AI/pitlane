# Phase 13 Compliance Notes — Internal Calendar & Loaner Fleet

## Scope

This document covers Phase 13 additions:

- `service_schedule`
- `schedule_overrides`
- `loaner_vehicles`
- `loaner_requests` extensions (`loaner_vehicle_id`, `start_date`, `end_date`)

Supabase project residency target remains **ca-central-1** (`tskczoemkegqbghjedpu`).

## Data Classification

| Table | Data classes | Notes |
|---|---|---|
| `service_schedule` | Operational metadata (non-PII) | Day-of-week hours, slot duration, booking caps only. |
| `schedule_overrides` | Operational metadata (non-PII) | Date-specific closures/hours and optional operational reason text. |
| `loaner_vehicles` | Operational metadata + quasi-PII | `license_plate` treated as quasi-PII (vehicle-identifying) for dispatch/return operations. |
| `loaner_requests` (new fields) | Operational scheduling metadata | `loaner_vehicle_id`, `start_date`, `end_date` are operational planning fields; no direct customer identity fields added in this phase. |

> PIPEDA minimization statement applied in migration comments:  
> **"No PII stored in schedule tables. PIPEDA s.4.4 data minimization compliant."**

## Access Model (Read/Write)

| Table | Read | Write |
|---|---|---|
| `service_schedule` | Staff in same dealer OR `group_manager` | `service_manager` in same dealer |
| `schedule_overrides` | Staff in same dealer OR `group_manager` | `service_manager` in same dealer |
| `loaner_vehicles` | Staff in same dealer OR `group_manager` | `service_manager` in same dealer |
| `loaner_requests` API writes | Authenticated PitLane staff roles (server-validated `x-pitlane-role`) | Role + dealer scope enforced server-side; write operations are audited |

All new Phase 13 tables have **RLS enabled** with explicit policies.

## Retention

- `loaner_requests` rows with resolved statuses older than **2 years** are eligible for purge under data minimization policy.
- Schedule and fleet metadata follow operational retention unless superseded by legal hold or dealership policy.

## SOC 2 / Security Control Mapping

- **Logical access control:** Supabase RLS policies for all new tables.
- **Server-side authorization:** API routes validate role from `x-pitlane-role` header on the server (not client-only gating).
- **Audit trail:** write paths and DB triggers append audit records to `audit_log`.
- **Data residency:** Supabase storage anchored in **ca-central-1**.
- **Encryption at rest:** Supabase managed encryption (AES-256 at rest).
