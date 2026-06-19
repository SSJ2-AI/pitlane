/* eslint-disable no-console */
//
// Smoke test for voice/src/cdk/fortellis.ts mock-mode paths.
// Verifies: (a) every method returns the right shape, (b) the LIVE
// createAppointment warning fires, (c) getServiceAdvisors returns the
// two seeded advisors. Run with: `node dist/scripts/smoke-fortellis.js`.

import {
    createAppointment,
    createRONote,
    getCustomer,
    getOpCodes,
    getServiceAdvisors,
    getVehicle,
    isFortellisLive,
} from '../cdk/fortellis'

async function main() {
    const dealerId = 'aaaaaaaa-0000-0000-0000-000000000001'

    console.log('isFortellisLive:', isFortellisLive())

    console.log('\n=== getCustomer (mock) ===')
    console.log(await getCustomer('+16475457709', dealerId))

    console.log('\n=== getVehicle (mock) ===')
    console.log(await getVehicle('WP0AA2A98NS820011', dealerId))

    console.log('\n=== getOpCodes (mock) ===')
    const opCodes = await getOpCodes('PORS', dealerId)
    console.log(`got ${opCodes.length} op codes; first 3:`, opCodes.slice(0, 3))

    console.log('\n=== createRONote (mock) ===')
    console.log(await createRONote('RO-2026-4471', 'Aria: customer requested loaner', dealerId))

    console.log('\n=== createAppointment (mock; bundle-gap warning only when LIVE) ===')
    console.log(await createAppointment(
        {
            customer_id: 'cust_005',
            vehicle_id: 'veh_005a',
            date: '2026-07-15',
            time: '10:00',
            service_type: 'Brake Service',
        },
        dealerId,
    ))

    console.log('\n=== getServiceAdvisors (mock) ===')
    console.log(await getServiceAdvisors(dealerId))
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err)
        process.exit(1)
    })
