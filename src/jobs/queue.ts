import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import * as repo from '../db/repo.js';
import { processJob } from './handlers.js';
import type { Job } from '../types.js';

let isRunning = false;
let pollInterval: NodeJS.Timeout | null = null;

/**
 * Job types disponíveis
 */
export const JOB_TYPES = {
  CREATE_SHIPMENT: 'create_shipment',
  GENERATE_LABEL: 'generate_label',
  CHECK_SHIPMENT_STATUS: 'check_shipment_status',
} as const;

export type JobType = typeof JOB_TYPES[keyof typeof JOB_TYPES];

/**
 * Payload dos jobs
 */
export interface CreateShipmentPayload {
  invoiceId: string;
}

export interface GenerateLabelPayload {
  invoiceId: string;
  shipmentId: string;
}

export interface CheckShipmentStatusPayload {
  invoiceId: string;
  shipmentId: string;
}

/**
 * Adiciona job para criar shipment
 */
export function enqueueCreateShipment(invoiceId: string): Job {
  logger.info({ invoiceId }, 'Enfileirando job de criação de shipment');
  return repo.createJob(JOB_TYPES.CREATE_SHIPMENT, { invoiceId }, config.jobs.maxRetries);
}

/**
 * Adiciona job para gerar etiqueta
 */
export function enqueueGenerateLabel(invoiceId: string, shipmentId: string): Job {
  logger.info({ invoiceId, shipmentId }, 'Enfileirando job de geração de etiqueta');
  return repo.createJob(JOB_TYPES.GENERATE_LABEL, { invoiceId, shipmentId }, config.jobs.maxRetries);
}

/**
 * Adiciona job para verificar status do shipment
 */
export function enqueueCheckShipmentStatus(invoiceId: string, shipmentId: string): Job {
  logger.info({ invoiceId, shipmentId }, 'Enfileirando job de verificação de status');
  return repo.createJob(JOB_TYPES.CHECK_SHIPMENT_STATUS, { invoiceId, shipmentId }, 3);
}

/**
 * Processa o próximo job pendente
 */
async function processNextJob(): Promise<boolean> {
  const job = repo.getNextPendingJob();
  if (!job) {
    return false;
  }

  logger.debug({ jobId: job.id, type: job.type }, 'Processando job');

  // Marcar como processing
  repo.markJobProcessing(job.id);

  try {
    await processJob(job);
    repo.markJobCompleted(job.id);
    logger.info({ jobId: job.id, type: job.type }, 'Job concluído com sucesso');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ jobId: job.id, type: job.type, error: message }, 'Erro ao processar job');

    // Calcular delay de retry baseado no número de tentativas
    // 1 min, 5 min, 15 min, 30 min, 60 min
    const retryDelays = [1, 5, 15, 30, 60];
    const retryDelay = retryDelays[Math.min(job.attempts, retryDelays.length - 1)];

    repo.markJobFailed(job.id, message, retryDelay);
    return true;
  }
}

/**
 * Loop principal de processamento
 */
async function pollLoop(): Promise<void> {
  if (!isRunning) return;

  try {
    // Processar todos os jobs pendentes disponíveis
    let processed = true;
    while (processed && isRunning) {
      processed = await processNextJob();
    }
  } catch (error) {
    logger.error({ error }, 'Erro no loop de processamento de jobs');
  }

  // Agendar próxima execução
  if (isRunning) {
    pollInterval = setTimeout(pollLoop, config.jobs.pollIntervalMs);
  }
}

/**
 * Inicia o processador de jobs
 */
export function startJobProcessor(): void {
  if (isRunning) {
    logger.warn('Processador de jobs já está rodando');
    return;
  }

  isRunning = true;
  logger.info({
    pollIntervalMs: config.jobs.pollIntervalMs,
    maxRetries: config.jobs.maxRetries,
  }, 'Iniciando processador de jobs');

  // Iniciar loop
  pollLoop();
}

/**
 * Para o processador de jobs
 */
export function stopJobProcessor(): void {
  isRunning = false;
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
  logger.info('Processador de jobs parado');
}

/**
 * Retorna estatísticas da fila
 */
export function getQueueStats(): {
  pending: number;
  failed: number;
} {
  return {
    pending: repo.getPendingJobsCount(),
    failed: repo.getFailedJobs(1000).length,
  };
}
