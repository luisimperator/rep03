import Fastify from 'fastify';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { runMigrations } from './db/migrate.js';
import { eduzzWebhookRoutes } from './routes/webhooks-eduzz.js';
import { loggiWebhookRoutes } from './routes/webhooks-loggi.js';
import { adminRoutes } from './routes/admin.js';
import { startJobProcessor, stopJobProcessor } from './jobs/queue.js';
import * as repo from './db/repo.js';
import type { ParsedEduzzData, OrderStatus } from './types.js';

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
 * Cria dados de exemplo se o banco estiver vazio
 */
function seedDemoData(): void {
  const orders = repo.getAllOrders(1);
  if (orders.length > 0) {
    return; // Já tem dados
  }

  logger.info('Criando dados de demonstração...');

  const sampleOrders: Array<{
    data: ParsedEduzzData;
    status: OrderStatus;
    loggiShipmentId?: string;
    loggiTrackingCode?: string;
    labelPath?: string;
    errorMessage?: string;
  }> = [
    {
      data: {
        invoiceId: 'DEMO-001',
        buyer: { name: 'Maria Santos', email: 'maria@email.com', phone: '11988776655' },
        address: { street: 'Av. Paulista', number: '1000', complement: 'Sala 501', neighborhood: 'Bela Vista', city: 'Sao Paulo', state: 'SP', zipCode: '01310100', country: 'BR' },
        items: [{ productId: '12345', name: 'Pack Adesivos Premium', skuReference: 'ADESIVO-01', quantity: 1, price: 29.90 }],
        paidAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        transactionId: 'TXN-001',
      },
      status: 'ETIQUETA_GERADA',
      loggiShipmentId: 'LOGGI-001',
      loggiTrackingCode: 'TRACK001BR',
    },
    {
      data: {
        invoiceId: 'DEMO-002',
        buyer: { name: 'João Pereira', email: 'joao@email.com', phone: '21999887766' },
        address: { street: 'Rua Copacabana', number: '500', complement: null, neighborhood: 'Copacabana', city: 'Rio de Janeiro', state: 'RJ', zipCode: '22041080', country: 'BR' },
        items: [{ productId: '67890', name: 'Adesivo Edicao Limitada', skuReference: 'ADESIVO-02', quantity: 3, price: 49.90 }],
        paidAt: new Date(Date.now() - 86400000).toISOString(),
        transactionId: 'TXN-002',
      },
      status: 'AGUARDANDO_LOGGI',
      loggiShipmentId: 'LOGGI-002',
    },
    {
      data: {
        invoiceId: 'DEMO-003',
        buyer: { name: 'Ana Costa', email: 'ana@email.com', phone: '31988665544' },
        address: { street: 'Rua da Bahia', number: '1500', complement: 'Loja 2', neighborhood: 'Centro', city: 'Belo Horizonte', state: 'MG', zipCode: '30160011', country: 'BR' },
        items: [
          { productId: '12345', name: 'Pack Adesivos Premium', skuReference: 'ADESIVO-01', quantity: 2, price: 29.90 },
          { productId: '67890', name: 'Adesivo Especial', skuReference: 'ADESIVO-02', quantity: 1, price: 49.90 },
        ],
        paidAt: new Date(Date.now() - 3600000).toISOString(),
        transactionId: 'TXN-003',
      },
      status: 'NOVO',
    },
    {
      data: {
        invoiceId: 'DEMO-004',
        buyer: { name: 'Carlos Lima', email: 'carlos@email.com', phone: '41977553322' },
        address: { street: 'Rua XV de Novembro', number: '700', complement: null, neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipCode: '80020310', country: 'BR' },
        items: [{ productId: '12345', name: 'Pack Adesivos Premium', skuReference: 'ADESIVO-01', quantity: 1, price: 29.90 }],
        paidAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        transactionId: 'TXN-004',
      },
      status: 'FALHA',
      errorMessage: 'CEP invalido ou nao atendido pela Loggi',
    },
    {
      data: {
        invoiceId: 'DEMO-005',
        buyer: { name: 'Fernanda Oliveira', email: 'fernanda@email.com', phone: '51966443322' },
        address: { street: 'Av. Borges de Medeiros', number: '2500', complement: 'Apto 1201', neighborhood: 'Praia de Belas', city: 'Porto Alegre', state: 'RS', zipCode: '90110150', country: 'BR' },
        items: [{ productId: '67890', name: 'Adesivo Edicao Limitada', skuReference: 'ADESIVO-02', quantity: 5, price: 49.90 }],
        paidAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        transactionId: 'TXN-005',
      },
      status: 'POSTADO',
      loggiShipmentId: 'LOGGI-005',
      loggiTrackingCode: 'TRACK005BR',
    },
  ];

  for (const sample of sampleOrders) {
    try {
      const order = repo.createOrderWithItems(sample.data);
      repo.updateOrderStatus(sample.data.invoiceId, sample.status, {
        loggiShipmentId: sample.loggiShipmentId,
        loggiTrackingCode: sample.loggiTrackingCode,
        labelPath: sample.labelPath,
        errorMessage: sample.errorMessage ?? null,
      });
      repo.createEvent('demo_created', { status: sample.status }, order.id, sample.data.invoiceId);
    } catch (e) {
      // Ignorar erros de duplicata
    }
  }

  logger.info('Dados de demonstração criados!');
}

/**
 * Inicializa o servidor
 */
async function start(): Promise<void> {
  try {
    // Rodar migrações do banco
    logger.info('Executando migrações do banco de dados...');
    runMigrations();

    // Criar dados de exemplo se banco vazio
    seedDemoData();

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
