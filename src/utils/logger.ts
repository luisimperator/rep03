import pino from 'pino';

/**
 * Logger estruturado com pino
 * Usa correlationId para rastrear operações por pedido
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    app: 'eduzz-loggi-automation',
  },
});

/**
 * Cria child logger com correlationId (invoiceId)
 */
export function createOrderLogger(invoiceId: string) {
  return logger.child({ correlationId: invoiceId });
}

export type Logger = typeof logger;
