# PitLane Voice — Cursor Tasks

Live service: https://pitlane-voice-production.up.railway.app  
GitHub: SSJ2-AI/pitlane-voice (private)  
Deployment: Railway auto-deploys on push to main

---

## Task 1 — Fix tools.ts (URGENT — TypeScript compilation may be broken)

The file `src/routes/tools.ts` was partially edited. It now has GET routes for `book-appointment` and `check-ro-status` that call `handleBookAppointment(...)` and `handleCheckROStatus(...)` as standalone functions, but those functions may have incomplete TypeScript types.

Please:

1. **Verify the file compiles** with `npm run build` — fix any TypeScript errors
2. **Ensure GET routes work:**
   - `GET /tools/customer-lookup/:phone` — already working ✅
   - `GET /tools/book-appointment?customer_id=...&vehicle_id=...&service_type=...&preferred_date=...&preferred_time=...`
   - `GET /tools/check-ro-status/:customer_id` (optional ro_number as query param)
3. **Ensure POST routes still work:**
   - `POST /tools/customer-lookup` — existing, works ✅
   - `POST /tools/book-appointment` — existing, should still work
   - `POST /tools/check-ro-status` — existing, should still work
4. **Push fixed code** to GitHub main branch

---

## Task 2 — Add PORT=8080 to railway.json (if not already there)

Railway auto-assigns PORT=8080. Our `src/server.ts` reads `process.env.PORT ?? 3001`. Since Railway sets PORT=8080 via environment variables, the server WILL use 8080. But to be explicit, ensure the start command in `railway.json` or Railway Variables sets PORT=8080.

Current `railway.json`:
```json
{
  "deploy": {
    "startCommand": "npm run build && npm start",
    "healthcheckPath": "/health"
  }
}
```

This is fine as-is. PORT is already set via Railway Variables.

---

## Task 3 — Verify `/dashboard` route works

`src/server.ts` has:
```typescript
app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'src', 'dashboard.html'))
})
app.get('/', (_req, res) => res.redirect('/dashboard'))
```

And `src/dashboard.html` is the live advisor dashboard. Verify:
- `GET /dashboard` returns the HTML file
- `GET /` redirects to `/dashboard`
- The dashboard connects to the WebSocket at `/ws`

Test: `curl -I https://pitlane-voice-production.up.railway.app/dashboard`

---

## Reference: All API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/dashboard` | Live advisor dashboard |
| POST | `/tools/customer-lookup` | ElevenLabs webhook (POST body: phone_number) |
| GET | `/tools/customer-lookup/:phone` | ElevenLabs GET path param version |
| POST | `/tools/book-appointment` | Book appointment (POST body) |
| GET | `/tools/book-appointment` | Book appointment (query params) |
| POST | `/tools/check-ro-status` | Check repair order (POST body) |
| GET | `/tools/check-ro-status/:customer_id` | Check repair order (path + query) |
| POST | `/calls/outbound` | Trigger outbound call |
| POST | `/calls/batch` | Trigger bulk outbound calls |
| GET | `/calls/history` | Recent call log |
| POST | `/events/call-completed` | ElevenLabs post-call webhook |
| GET | `/demo/customers` | List all 5 mock CDK customers |
| POST | `/demo/set-next-caller` | Override next call's customer identity |
| GET | `/demo/overrides` | Active overrides |
| POST | `/demo/simulate-inbound` | Fire screen pop without real call |
| WS | `/ws` | WebSocket screen pop stream |

## Mock Customers

| ID | Name | Phone | Scenario |
|----|------|-------|----------|
| cust_001 | James Whitfield | +16475550101 | Gold, RO awaiting parts |
| cust_002 | Priya Mehta | +14165550202 | Platinum, Taycan, open recall, appt tomorrow |
| cust_003 | David Okafor | +14375550303 | Silver, Macan in shop today |
| cust_004 | Sophie Tremblay | +15145550404 | Bronze, 718 Cayman, French |
| cust_005 | Sulaim Siddiqi | +16475457709 | Platinum, 911 GT3 RS |

## ElevenLabs Agent

- Agent ID: `agent_2701ktpgkyr7f37vq8dmgxjw4bkt`
- Agent Name: Aria — PitLane Service AI
- Tool: `customer_lookup` → `GET /tools/customer-lookup/{phone_number}` ✅ LIVE
- Pending tools: `book_appointment`, `check_repair_order_status` (to be added via ElevenLabs UI)
