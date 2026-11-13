import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import { Server } from 'socket.io'

import type { AppSocket, AppSocketServer } from '@/lib/socket'
import {
  REALTIME_CHANNEL,
  SOCKET_EVENTS,
  userChannel,
} from '@/lib/socket-events'
import type { RealtimeMessage } from '@/lib/socket-events'
import { balanceSnapshot } from '@/modules/wallet/service'

declare module 'fastify' {
  interface FastifyInstance {
    attachSocket: () => Promise<void>
    io: AppSocketServer | null
  }
}

function socketPlugin(
  fastify: FastifyInstance,
  _options: unknown,
  done: (error?: Error) => void,
) {
  let io: AppSocketServer | null = null
  let subscribed = false

  function handleEngineRequest(request: FastifyRequest, reply: FastifyReply) {
    const engine = fastify.io?.engine
    if (!engine) {
      reply.code(503).send({
        error: 'Service Unavailable',
        message: 'Socket server unavailable',
        statusCode: 503,
      })
      return
    }

    reply.hijack()
    engine.handleRequest(request.raw, reply.raw)
  }

  function relay(channel: string, raw: string) {
    if (channel !== REALTIME_CHANNEL || !io) {
      return
    }
    try {
      const message = JSON.parse(raw) as RealtimeMessage
      if (message.userId) {
        io.to(userChannel(message.userId)).emit(message.event, message.data)
      } else {
        io.emit(message.event, message.data)
      }
    } catch (error) {
      fastify.log.warn({ err: error }, 'Failed to relay realtime message')
    }
  }

  fastify.decorate('io', null)
  fastify.decorate('attachSocket', async () => {
    if (fastify.config.NODE_ENV === 'test' || io) {
      return
    }

    io = new Server(fastify.server, {
      cors: {
        credentials: true,
        origin:
          fastify.config.TRUSTED_ORIGINS.length > 0
            ? fastify.config.TRUSTED_ORIGINS
            : true,
      },
      path: '/ws',
      serveClient: false,
    })
    fastify.io = io

    io.engine.on('connection_error', (error) => {
      fastify.log.warn(
        { code: error.code, message: error.message },
        'Socket.IO connection error',
      )
    })

    io.use(async (client, next) => {
      try {
        const session = await fastify.auth.api.getSession({
          headers: fromNodeHeaders(client.handshake.headers),
        })
        if (!session) {
          return next()
        }
        const user = session.user
        if (
          user.banned &&
          (!user.banExpires || new Date(user.banExpires).getTime() > Date.now())
        ) {
          fastify.log.warn(
            {
              code: 'UserBanned',
              origin: client.handshake.headers.origin,
              socketId: client.id,
              userId: user.id,
            },
            'Socket connection rejected',
          )
          return next(new Error('User is banned'))
        }
        client.data.session = session
        await client.join(userChannel(user.id))
        return next()
      } catch (error) {
        fastify.log.warn(
          {
            err: error,
            origin: client.handshake.headers.origin,
            socketId: client.id,
          },
          'Socket authentication failed',
        )
        return next(
          error instanceof Error ? error : new Error('Authentication failed'),
        )
      }
    })

    io.on('connection', (client: AppSocket) => {
      const session = client.data.session
      fastify.log.debug(
        {
          origin: client.handshake.headers.origin,
          socketId: client.id,
          transport: client.conn.transport.name,
          userId: session?.user.id ?? null,
        },
        'Socket connected',
      )
      if (session) {
        void (async () => {
          try {
            const balance = await balanceSnapshot(fastify.db, session.user.id)
            client.emit(SOCKET_EVENTS.connected, {
              balance,
              userId: session.user.id,
            })
          } catch (error) {
            fastify.log.warn({ err: error }, 'Failed to emit wallet snapshot')
          }
        })()
      }

      client.on(SOCKET_EVENTS.ping, () => {
        client.emit(SOCKET_EVENTS.pong, {
          ts: Date.now(),
          userId: session?.user.id ?? null,
        })
      })

      client.on('disconnect', (reason) => {
        fastify.log.debug(
          {
            origin: client.handshake.headers.origin,
            reason,
            socketId: client.id,
            transport: client.conn.transport.name,
            userId: session?.user.id ?? null,
          },
          'Socket disconnected',
        )
      })
    })

    fastify.redisSubscriber.on('message', relay)
    await fastify.redisSubscriber.subscribe(REALTIME_CHANNEL)
    subscribed = true
    fastify.log.info(
      {
        path: io.path(),
        redisChannel: REALTIME_CHANNEL,
        transports: io.engine.opts.transports,
      },
      'Socket.IO server ready',
    )
  })

  // Fastify's localhost dual-stack mode creates a secondary HTTP server without
  // Socket.IO's request wrapper. Intercept before body parsing so polling still
  // reaches the same Engine.IO server.
  for (const url of ['/ws', '/ws/*']) {
    fastify.route({
      handler: handleEngineRequest,
      method: ['GET', 'POST', 'OPTIONS'],
      onRequest: handleEngineRequest,
      schema: { hide: true },
      url,
    })
  }

  fastify.addHook('onClose', async () => {
    if (!io) {
      return
    }
    fastify.redisSubscriber.off('message', relay)
    if (subscribed) {
      await fastify.redisSubscriber.unsubscribe(REALTIME_CHANNEL)
    }
    await io.close()
  })
  done()
}

export default fp(socketPlugin, { name: 'socket' })
