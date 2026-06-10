import { WebSocketServer, WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { Server } from 'http'
import { ScreenPopEvent } from '../types'

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()

export function initWebSocketServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const ip = req.socket.remoteAddress
    console.log(`[WS] PitLane dashboard connected from ${ip}`)
    clients.add(ws)

    // Send heartbeat ping every 30s to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping()
      }
    }, 30_000)

    ws.on('pong', () => {
      // Client is alive
    })

    ws.on('close', () => {
      console.log(`[WS] Dashboard disconnected from ${ip}`)
      clients.delete(ws)
      clearInterval(pingInterval)
    })

    ws.on('error', (err) => {
      console.error(`[WS] Error from ${ip}:`, err.message)
      clients.delete(ws)
      clearInterval(pingInterval)
    })

    // Send connection confirmation
    ws.send(JSON.stringify({ type: 'CONNECTED', message: 'PitLane Voice connected', timestamp: new Date().toISOString() }))
  })

  console.log('[WS] Screen pop WebSocket server initialised on /ws')
  return wss
}

/**
 * Broadcast a screen pop event to all connected PitLane dashboard clients.
 * Call this whenever a call comes in, ends, or an outbound is initiated.
 */
export function broadcastScreenPop(event: ScreenPopEvent): void {
  const payload = JSON.stringify(event)
  let sent = 0

  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
      sent++
    }
  })

  console.log(`[WS] Broadcast ${event.type} to ${sent} client(s)`)
}

export function getConnectedCount(): number {
  return clients.size
}
