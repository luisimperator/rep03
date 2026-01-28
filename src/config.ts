import { config as dotenvConfig } from 'dotenv';
import type { Config } from './types.js';

// Carregar .env
dotenvConfig();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Variável de ambiente ${key} deve ser um número válido`);
  }
  return num;
}

function parseCSV(value: string): string[] {
  if (!value || value.trim() === '') {
    return [];
  }
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export function loadConfig(): Config {
  return {
    port: getEnvNumber('APP_PORT', 3000),

    eduzz: {
      webhookSecret: getEnv('EDUZZ_WEBHOOK_SECRET', 'dev_secret_change_me'),
      allowedProductIds: parseCSV(getEnv('EDUZZ_ALLOWED_PRODUCT_IDS', '')),
      allowedSkus: parseCSV(getEnv('EDUZZ_ALLOWED_SKUS', '')),
    },

    loggi: {
      baseUrl: getEnv('LOGGI_BASE_URL', 'https://api.loggi.com'),
      clientId: getEnv('LOGGI_CLIENT_ID', ''),
      clientSecret: getEnv('LOGGI_CLIENT_SECRET', ''),
      companyId: getEnv('LOGGI_COMPANY_ID', ''),
    },

    origin: {
      name: getEnv('ORIGIN_NAME', 'Remetente Padrão'),
      phone: getEnv('ORIGIN_PHONE', '11999999999'),
      email: getEnv('ORIGIN_EMAIL', 'contato@exemplo.com'),
      street: getEnv('ORIGIN_STREET', 'Rua Exemplo'),
      number: getEnv('ORIGIN_NUMBER', '100'),
      complement: getEnv('ORIGIN_COMPLEMENT', ''),
      neighborhood: getEnv('ORIGIN_NEIGHBORHOOD', 'Centro'),
      city: getEnv('ORIGIN_CITY', 'São Paulo'),
      state: getEnv('ORIGIN_STATE', 'SP'),
      zip: getEnv('ORIGIN_ZIP', '01000000'),
    },

    package: {
      weightG: getEnvNumber('PACKAGE_WEIGHT_G', 50),
      lengthCm: getEnvNumber('PACKAGE_LENGTH_CM', 12),
      widthCm: getEnvNumber('PACKAGE_WIDTH_CM', 7),
      heightCm: getEnvNumber('PACKAGE_HEIGHT_CM', 1), // Mínimo 1cm para APIs
    },

    jobs: {
      pollIntervalMs: getEnvNumber('JOB_POLL_INTERVAL_MS', 5000),
      maxRetries: getEnvNumber('JOB_MAX_RETRIES', 5),
    },
  };
}

// Exportar config singleton
export const config = loadConfig();
