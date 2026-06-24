// ─── Phase 9b: role-based access for the departments console ───────────────
//
// PitLane doesn't have a real authentication layer yet (Phase 11 task in
// docs/future-features.md). Until then, the departments management UI is
// gated by a lightweight role hint that the client sends as either:
//
//   - URL query string  ?role=service_manager
//   - HTTP request header  x-pitlane-role: service_manager
//
// Same pattern as the existing ?admin=true gate on /admin/dealers. This is
// intentionally a UX gate, not a security boundary — anyone with the URL
// can flip the flag. When a real auth layer lands, the same `requireRole`
// helper will read from the authenticated session instead and the URL
// hints will fall away.
//
// Roles:
//   service_manager  — read + write on departments
//   service_advisor  — read only
//   (unset / any other) — read only as well (default for advisors)

export type PitLaneRole = 'service_manager' | 'service_advisor';

export function readRoleFromRequest(request: Request): PitLaneRole {
    const url = new URL(request.url);
    const fromQuery = url.searchParams.get('role')?.trim().toLowerCase();
    const fromHeader = request.headers.get('x-pitlane-role')?.trim().toLowerCase();
    const value = fromQuery || fromHeader;
    if (value === 'service_manager') return 'service_manager';
    return 'service_advisor';
}

export function canEditDepartments(role: PitLaneRole): boolean {
    return role === 'service_manager';
}
