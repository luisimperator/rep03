import Fastify from 'fastify';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { runMigrations } from './db/migrate.js';
import { eduzzWebhookRoutes } from './routes/webhooks-eduzz.js';
import { loggiWebhookRoutes } from './routes/webhooks-loggi.js';
import { adminRoutes } from './routes/admin.js';
import { startJobProcessor, stopJobProcessor } from './jobs/queue.js';

// Criar instância do Fastify
const fastify = Fastify({
  logger: false, // Usamos pino diretamente
  bodyLimit: 1048576, // 1MB
});

// Plugin para capturar raw body (necessário para validar assinatura HMAC)
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (req, body, done) => {
    try {
      const json = JSON.parse(body as string);
      // Armazenar raw body na requisição
      (req as typeof req & { rawBody: string }).rawBody = body as string;
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Redirect root to admin
fastify.get('/', async (request, reply) => {
  return reply.redirect('/admin');
});

/**
 * Inicializa o servidor
 */
async function start(): Promise<void> {
  try {
    // Rodar migrações do banco
    logger.info('Executando migrações do banco de dados...');
    runMigrations();

    // Registrar rotas
    await fastify.register(eduzzWebhookRoutes);
    await fastify.register(loggiWebhookRoutes);
    await fastify.register(adminRoutes);

    // Iniciar processador de jobs
    startJobProcessor();

    // Iniciar servidor HTTP
    const address = await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    logger.info(`Servidor iniciado em ${address}`);
    logger.info(`Painel admin: ${address}/admin`);
    logger.info(`Webhook Eduzz: ${address}/webhooks/eduzz`);
    logger.info(`Webhook Loggi: ${address}/webhooks/loggi`);

  } catch (err) {
    logger.error({ err }, 'Erro ao iniciar servidor');
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(): Promise<void> {
  logger.info('Encerrando servidor...');

  // Parar processador de jobs
  stopJobProcessor();

  // Fechar servidor HTTP
  await fastify.close();

  logger.info('Servidor encerrado');
  process.exit(0);
}

// Handlers de shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Iniciar
start();
