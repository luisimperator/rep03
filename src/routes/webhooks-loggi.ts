import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as repo from '../db/repo.js';
import { enqueueGenerateLabel } from '../jobs/queue.js';
import { logger, createOrderLogger } from '../utils/logger.js';
import type { LoggiWebhookPayload } from '../types.js';

/**
 * Registra rotas de webhook Loggi
 */
export async function loggiWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/loggi
   * Recebe webhooks da Loggi (status de shipments)
   */
  fastify.post('/webhooks/loggi', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = request.body as LoggiWebhookPayload;

    logger.info({ event: payload?.event || payload?.type }, 'Webhook Loggi recebido');

    // Registrar evento
    repo.createEvent('loggi_webhook_received', payload);

    // Extrair dados
    const data = payload.data;
    if (!data) {
      logger.warn('Webhook Loggi sem campo data');
      return reply.status(200).send({ status: 'ignored', reason: 'no_data' });
    }

    const shipmentId = data.shipmentId || data.shipment_id || data.id || '';
    const status = data.status || '';
    const trackingCode = data.trackingCode || data.tracking_code || '';

    if (!shipmentId) {
      logger.warn('Webhook Loggi sem shipment ID');
      return reply.status(200).send({ status: 'ignored', reason: 'no_shipment_id' });
    }

    logger.info({ shipmentId, status, trackingCode }, 'Processando webhook Loggi');

    // Buscar pedido pelo shipment ID
    const orders = repo.getAllOrders(1000);
    const order = orders.find(o => o.loggi_shipment_id === shipmentId);

    if (!order) {
      logger.warn({ shipmentId }, 'Pedido não encontrado para shipment ID');
      return reply.status(200).send({ status: 'ignored', reason: 'order_not_found' });
    }

    const log = createOrderLogger(order.invoice_id);
    log.info({ status }, 'Atualizando status do pedido via webhook Loggi');

    // Registrar evento
    repo.createEvent('loggi_status_update', {
      shipmentId,
      status,
      trackingCode,
    }, order.id, order.invoice_id);

    // Atualizar tracking code se disponível
    if (trackingCode && !order.loggi_tracking_code) {
      repo.updateOrderStatus(order.invoice_id, order.status, {
        loggiTrackingCode: trackingCode,
      });
    }

    // Verificar se shipment está pronto para etiqueta
    // (status varia conforme API: READY, CREATED, CONFIRMED, etc.)
    const readyStatuses = ['ready', 'created', 'confirmed', 'label_ready', 'shipped'];
    const isReady = readyStatuses.some(s =>
      status.toLowerCase().includes(s)
    );

    if (isReady && order.status === 'AGUARDANDO_LOGGI' && !order.label_path) {
      log.info('Shipment pronto, enfileirando geração de etiqueta');
      enqueueGenerateLabel(order.invoice_id, shipmentId);
    }

    return reply.status(200).send({
      status: 'processed',
      invoiceId: order.invoice_id,
      orderStatus: order.status,
    });
  });
}
