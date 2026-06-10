import { NextResponse } from 'next/server';

const elevenLabsBatchCallingUrl = 'https://api.elevenlabs.io/v1/convai/batch-calling/create';
const defaultPhoneNumberId = 'phnum_0301ktpjb9pvfwbvwkezwrt5c1c7';
const defaultAgentId = 'agent_2701ktpgkyr7f37vq8dmgxjw4bkt';

type OutboundCallRequest = {
    phone_number?: string;
    phoneNumber?: string;
    user_name?: string;
    userName?: string;
};

function getElevenLabsConfig() {
    return {
        apiKey: process.env.ELEVENLABS_API_KEY,
        phoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID ?? defaultPhoneNumberId,
        agentId: process.env.ELEVENLABS_AGENT_ID ?? defaultAgentId,
    };
}

export async function POST(request: Request) {
    const { apiKey, phoneNumberId, agentId } = getElevenLabsConfig();

    if (!apiKey) {
        return NextResponse.json(
            { message: 'ELEVENLABS_API_KEY is not configured.' },
            { status: 500 },
        );
    }

    let body: OutboundCallRequest;

    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
    }

    const phoneNumber = body.phone_number ?? body.phoneNumber;
    const userName = body.user_name ?? body.userName ?? 'PitLane customer';

    if (!phoneNumber) {
        return NextResponse.json({ message: 'phone_number is required.' }, { status: 400 });
    }

    const elevenLabsResponse = await fetch(elevenLabsBatchCallingUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
        },
        body: JSON.stringify({
            phone_number_id: phoneNumberId,
            agent_id: agentId,
            recipients: [{
                phone_number: phoneNumber,
                user_name: userName,
            }],
        }),
    });

    const responseText = await elevenLabsResponse.text();
    let payload: unknown = responseText;

    try {
        payload = JSON.parse(responseText);
    } catch {
        payload = { message: responseText };
    }

    return NextResponse.json(payload, { status: elevenLabsResponse.status });
}
