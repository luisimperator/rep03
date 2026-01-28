import type { Job } from '../types.js';
import * as repo from '../db/repo.js';
import * as loggi from '../services/loggi.js';
import { createOrderLogger } from '../utils/logger.js';
import {
  JOB_TYPES,
  enqueueGenerateLabel,
  type CreateShipmentPayload,
  type GenerateLabelPayload,
  type CheckShipmentStatusPayload,
} from './queue.js';

/**
 * Processa um job baseado no seu tipo
 */
export async function processJob(job: Job): Promise<void> {
  const payload = JSON.parse(job.payload);

  switch (job.type) {
    case JOB_TYPES.CREATE_SHIPMENT:
      await handleCreateShipment(payload as CreateShipmentPayload);
      break;

    case JOB_TYPES.GENERATE_LABEL:
      await handleGenerateLabel(payload as GenerateLabelPayload);
      break;

    case JOB_TYPES.CHECK_SHIPMENT_STATUS:
      await handleCheckShipmentStatus(payload as CheckShipmentStatusPayload);
      break;

    default:
      throw new Error(`Tipo de job desconhecido: ${job.type}`);
  }
}

/**
 * Handler: Criar shipment na Loggi
 */
async function handleCreateShipment(payload: CreateShipmentPayload): Promise<void> {
  const { invoiceId } = payload;
  const log = createOrderLogger(invoiceId);

  log.info('Processando criação de shipment');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  // Verificar se já foi criado
  if (order.loggi_shipment_id) {
    log.warn('Shipment já existe, pulando criação');
    return;
  }

  // Atualizar status
  repo.updateOrderStatus(invoiceId, 'ENVIANDO');
  repo.createEvent('shipment_creating', { invoiceId }, order.id, invoiceId);

  try {
    // Criar shipment
    const response = await loggi.createShipment(order);

    const shipmentId = response.id || response.shipmentId || '';
    const trackingCode = response.trackingCode || response.tracking_code || '';

    if (!shipmentId) {
      throw new Error('API Loggi não retornou shipment ID');
    }

    // Atualizar pedido
    repo.updateOrderStatus(invoiceId, 'AGUARDANDO_LOGGI', {
      loggiShipmentId: shipmentId,
      loggiTrackingCode: trackingCode,
      errorMessage: null,
    });

    repo.createEvent('shipment_created', {
      shipmentId,
      trackingCode,
    }, order.id, invoiceId);

    log.info({ shipmentId, trackingCode }, 'Shipment criado, enfileirando geração de etiqueta');

    // Enfileirar geração de etiqueta
    enqueueGenerateLabel(invoiceId, shipmentId);

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Verificar se é erro permanente
    if (error instanceof loggi.LoggiApiError && error.isPermanent()) {
      log.error({ error: message }, 'Erro permanente ao criar shipment');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: message,
      });
      repo.createEvent('shipment_failed_permanent', { error: message }, order.id, invoiceId);
      // Não relançar para não fazer retry
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('shipment_failed_transient', { error: message }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Handler: Gerar etiqueta
 */
async function handleGenerateLabel(payload: GenerateLabelPayload): Promise<void> {
  const { invoiceId, shipmentId } = payload;
  const log = createOrderLogger(invoiceId);

  log.info({ shipmentId }, 'Processando geração de etiqueta');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  // Verificar se já tem etiqueta
  if (order.label_path) {
    log.warn('Etiqueta já existe, pulando geração');
    return;
  }

  try {
    // Gerar etiqueta
    const labelPath = await loggi.generateLabel(shipmentId, invoiceId);

    // Atualizar pedido
    repo.updateOrderStatus(invoiceId, 'ETIQUETA_GERADA', {
      labelPath,
      errorMessage: null,
    });

    repo.createEvent('label_generated', { labelPath }, order.id, invoiceId);

    log.info({ labelPath }, 'Etiqueta gerada com sucesso');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Verificar se é erro permanente
    if (error instanceof loggi.LoggiApiError && error.isPermanent()) {
      log.error({ error: message }, 'Erro permanente ao gerar etiqueta');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: `Erro ao gerar etiqueta: ${message}`,
      });
      repo.createEvent('label_failed_permanent', { error: message }, order.id, invoiceId);
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('label_failed_transient', { error: message }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Handler: Verificar status do shipment
 */
async function handleCheckShipmentStatus(payload: CheckShipmentStatusPayload): Promise<void> {
  const { invoiceId, shipmentId } = payload;
  const log = createOrderLogger(invoiceId);

  log.info({ shipmentId }, 'Verificando status do shipment');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  try {
    const status = await loggi.getShipmentStatus(shipmentId);

    repo.createEvent('shipment_status_checked', {
      status: status.status,
      trackingCode: status.trackingCode,
    }, order.id, invoiceId);

    // Atualizar tracking code se disponível
    if (status.trackingCode && !order.loggi_tracking_code) {
      repo.updateOrderStatus(invoiceId, order.status, {
        loggiTrackingCode: status.trackingCode,
      });
    }

    log.info({ status: status.status }, 'Status verificado');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, 'Erro ao verificar status');
    throw error;
  }
}
