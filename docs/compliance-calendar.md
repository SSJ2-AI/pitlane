# PitLane Phase 13 Calendar and Loaner Fleet Compliance

## Data classification

| Table | Data stored | Classification | PII / quasi-PII | Read access | Write access |
|---|---|---|---|---|---|
| `service_schedule` | Dealer weekly operating hours, slot duration, concurrent booking capacity, active flag, creator id | Operational metadata | No customer PII | Authenticated active staff for same dealer; group managers read across dealers | Same-dealer `service_manager` only |
| `schedule_overrides` | Dealer date closures, custom hours, capacity override, reason | Operational metadata | No customer PII. Reasons must not contain customer identifiers. | Authenticated active staff for same dealer; group managers read across dealers | Same-dealer `service_manager` only |
| `loaner_vehicles` | Dealer loaner make/model/year/color, availability, notes, license plate | Operational fleet data | `license_plate` is quasi-PII because it can be linked to an individual through external records | Authenticated active staff for same dealer; group managers read across dealers | Same-dealer `service_manager` only |
| `loaner_requests` additions | Assigned loaner vehicle id, customer vehicle id, start date, end date | Customer service workflow data | Links to customer id and loaner vehicle; treat as customer-associated operational data | Existing dealer-scoped service desk and customer/call views | Authenticated dealer staff create; dealer staff resolve per service desk workflow |

## Retention

- `service_schedule` and `schedule_overrides`: retain while operationally relevant; stale overrides may be purged after the dealership confirms they are no longer needed for historical capacity review.
- `loaner_vehicles`: retain while the vehicle is in fleet. Soft-deleted vehicles are marked `is_available=false`; purge only after downstream references are no longer needed.
- `loaner_requests`: resolved requests older than 2 years can be purged under PIPEDA data minimization principles.

## Controls

- Row Level Security is enabled on every new table with same-dealer staff read policies and same-dealer service-manager write policies.
- All new dashboard API routes validate `x-pitlane-role` and `x-pitlane-dealer` server-side before reads or writes.
- Every write route records an `audit_log` entry, and database triggers also audit direct table mutations for the new schedule/fleet tables.
- Supabase remains the data residency anchor and must stay in `ca-central-1` for project `tskczoemkegqbghjedpu`.
- Supabase provides AES-256 encryption at rest for stored data.
- No PII is stored in `service_schedule` or `schedule_overrides`; this satisfies PIPEDA s.4.4 data minimization for schedule configuration.
