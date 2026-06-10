'use client';

import { useMemo } from 'react';
import { useVoice, VoiceAppointment, VoiceCustomerVehicle, VoiceRecall, VoiceRepairOrder } from '@/providers/VoiceProvider';

function formatCustomerName(firstName?: string, lastName?: string, fallback?: string) {
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return fullName || fallback || 'Unknown caller';
}

function formatVehicle(vehicle?: VoiceCustomerVehicle) {
    if (!vehicle) return 'No vehicle on file';
    return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
}

function formatAppointment(appointment?: VoiceAppointment) {
    if (!appointment) return 'No upcoming appointment';
    const dateParts = [appointment.date, appointment.time].filter(Boolean).join(' at ');
    return [dateParts, appointment.serviceType].filter(Boolean).join(' - ');
}

function formatRepairOrder(order: VoiceRepairOrder) {
    return order.roNumber || order.serviceType || order.status || order.id || 'Open repair order';
}

function formatRecall(recall: VoiceRecall) {
    return recall.campaign || recall.component || recall.summary || recall.id || 'Open recall';
}

export function IncomingCallPopup() {
    const { incomingCall, connectionStatus, dismissIncomingCall } = useVoice();

    const customer = incomingCall?.caller?.customer;
    const primaryVehicle = customer?.vehicles?.[0];
    const upcomingAppointment = customer?.upcomingAppointments?.[0];
    const openRepairOrders = customer?.openRepairOrders ?? [];
    const openRecalls = customer?.openRecalls ?? [];

    const customerName = useMemo(() => (
        formatCustomerName(customer?.firstName, customer?.lastName, customer?.name)
    ), [customer?.firstName, customer?.lastName, customer?.name]);

    if (!incomingCall) return null;

    return (
        <aside className="fixed bottom-6 right-6 z-50 w-[calc(100vw-3rem)] max-w-md overflow-hidden rounded-3xl border border-red-500/50 bg-zinc-950 text-zinc-100 shadow-2xl shadow-red-950/40">
            <div className="border-b border-red-500/30 bg-red-600/15 p-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.32em] text-red-300">Incoming call</p>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{customerName}</h2>
                        <p className="mt-1 text-sm font-semibold text-zinc-300">{incomingCall.caller?.phone ?? customer?.phone ?? 'Unknown phone'}</p>
                    </div>
                    <button
                        type="button"
                        onClick={dismissIncomingCall}
                        className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm font-bold text-zinc-300 transition hover:border-red-400 hover:text-white"
                        aria-label="Dismiss incoming call"
                    >
                        Close
                    </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-red-200">
                        {customer?.loyaltyTier ?? 'Guest'} tier
                    </span>
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-semibold text-zinc-300">
                        Voice {connectionStatus}
                    </span>
                </div>
            </div>

            <div className="space-y-4 p-5">
                <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Vehicle</p>
                    <p className="mt-2 text-lg font-black text-white">{formatVehicle(primaryVehicle)}</p>
                    <p className="mt-1 text-sm text-zinc-400">
                        {[primaryVehicle?.color, primaryVehicle?.licensePlate].filter(Boolean).join(' - ') || 'Details unavailable'}
                    </p>
                </section>

                <div className="grid gap-3 sm:grid-cols-2">
                    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Open ROs</p>
                        <p className="mt-2 text-3xl font-black text-white">{openRepairOrders.length}</p>
                        <div className="mt-3 space-y-2">
                            {openRepairOrders.length > 0 ? openRepairOrders.slice(0, 2).map((order) => (
                                <p key={order.id ?? formatRepairOrder(order)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                                    {formatRepairOrder(order)}
                                </p>
                            )) : (
                                <p className="text-sm text-zinc-400">No open repair orders</p>
                            )}
                        </div>
                    </section>

                    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Recalls</p>
                        <p className={`mt-2 text-3xl font-black ${openRecalls.length > 0 ? 'text-red-300' : 'text-white'}`}>{openRecalls.length}</p>
                        <div className="mt-3 space-y-2">
                            {openRecalls.length > 0 ? openRecalls.slice(0, 2).map((recall) => (
                                <p key={recall.id ?? formatRecall(recall)} className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                                    {formatRecall(recall)}
                                </p>
                            )) : (
                                <p className="text-sm text-zinc-400">No open recalls</p>
                            )}
                        </div>
                    </section>
                </div>

                <section className="rounded-2xl border border-red-500/30 bg-red-600/10 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-red-300">Upcoming appointment</p>
                    <p className="mt-2 text-base font-black text-white">{formatAppointment(upcomingAppointment)}</p>
                    {upcomingAppointment?.advisorName && (
                        <p className="mt-1 text-sm text-zinc-300">Advisor: {upcomingAppointment.advisorName}</p>
                    )}
                </section>

                {customer?.notes && (
                    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Advisor note</p>
                        <p className="mt-2 text-sm leading-6 text-zinc-300">{customer.notes}</p>
                    </section>
                )}
            </div>
        </aside>
    );
}
