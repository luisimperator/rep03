import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { validateWebhookPayload, parseEduzzPayload } from '../services/eduzz.js';
import * as repo from '../db/repo.js';
import { enqueueCreateShipment } from '../jobs/queue.js';
import { createOrderLogger, logger } from '../utils/logger.js';
import type { EduzzWebhookPayload } from '../types.js';

/**
 * Registra rotas de webhook Eduzz
 */
export async function eduzzWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /webhooks/eduzz
   * Recebe webhooks da Eduzz
   */
  fastify.post('/webhooks/eduzz', {
    config: {
      // Precisamos do raw body para validar assinatura
      rawBody: true,
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const signature = request.headers['x-signature'] as string | undefined;
    const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody || '';
    const payload = request.body as EduzzWebhookPayload;

    logger.info({ event: payload?.event }, 'Webhook Eduzz recebido');

    // Validar payload
    const validation = validateWebhookPayload(rawBody, signature, payload);

    if (!validation.valid) {
      logger.warn({ reason: validation.reason }, 'Webhook Eduzz rejeitado');

      // Registrar evento mesmo rejeitado (para auditoria)
      repo.createEvent(`webhook_rejected_${validation.reason}`, {
        event: payload?.event,
        reason: validation.reason,
      });

      // Retornar 200 para não travar fila da Eduzz
      // (exceto para assinatura inválida, que pode ser ataque)
      if (validation.reason === 'invalid_signature') {
        return reply.status(401).send({ error: 'Invalid signature' });
      }

      return reply.status(200).send({ status: 'ignored', reason: validation.reason });
    }

    // Parsear payload
    const data = parseEduzzPayload(payload);
    if (!data) {
      logger.error('Falha ao parsear payload do webhook');
      repo.createEvent('webhook_parse_error', { event: payload.event });
      return reply.status(200).send({ status: 'ignored', reason: 'parse_error' });
    }

    const log = createOrderLogger(data.invoiceId);
    log.info({ buyer: data.buyer.name, itemCount: data.items.length }, 'Processando venda paga');

    // Registrar evento
    repo.createEvent('webhook_received', {
      invoiceId: data.invoiceId,
      event: payload.event,
      buyer: data.buyer.name,
      itemCount: data.items.length,
    }, undefined, data.invoiceId);

    // Verificar se já existe (idempotência)
    const existingOrder = repo.findOrderByInvoiceId(data.invoiceId);

    if (existingOrder) {
      log.info({ status: existingOrder.status }, 'Pedido já existe, atualizando');

      // Atualizar dados se necessário
      repo.updateOrderWithItems(data.invoiceId, data);

      repo.createEvent('order_updated_via_webhook', {
        previousStatus: existingOrder.status,
      }, existingOrder.id, data.invoiceId);

      // Se estava em FALHA, permitir reprocessar
      if (existingOrder.status === 'FALHA') {
        log.info('Pedido estava em FALHA, enfileirando reprocessamento');
        repo.updateOrderStatus(data.invoiceId, 'NOVO', {
          errorMessage: null,
        });
        enqueueCreateShipment(data.invoiceId);
      }

      return reply.status(200).send({
        status: 'updated',
        invoiceId: data.invoiceId,
        orderStatus: existingOrder.status,
      });
    }

    // Criar novo pedido
    log.info('Criando novo pedido');
    const order = repo.createOrderWithItems(data);

    // Enfileirar criação de shipment
    enqueueCreateShipment(data.invoiceId);

    log.info({ orderId: order.id }, 'Pedido criado e enfileirado para envio');

    return reply.status(201).send({
      status: 'created',
      invoiceId: data.invoiceId,
      orderId: order.id,
    });
  });
}
