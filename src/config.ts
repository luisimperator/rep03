import { config as dotenvConfig } from 'dotenv';
import type { Config } from './types.js';

// Carregar .env
dotenvConfig();

function getEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
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
    return defaultValue;
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
  // Railway usa PORT, outros usam APP_PORT
  const port = getEnvNumber('PORT', getEnvNumber('APP_PORT', 3000));

  return {
    port,

    eduzz: {
      webhookSecret: getEnv('EDUZZ_WEBHOOK_SECRET', 'minha_chave_secreta_eduzz_2024'),
      allowedProductIds: parseCSV(getEnv('EDUZZ_ALLOWED_PRODUCT_IDS', '12345,67890')),
      allowedSkus: parseCSV(getEnv('EDUZZ_ALLOWED_SKUS', 'ADESIVO-01,ADESIVO-02')),
    },

    loggi: {
      baseUrl: getEnv('LOGGI_BASE_URL', 'https://api.loggi.com'),
      clientId: getEnv('LOGGI_CLIENT_ID', 'demo_client_id'),
      clientSecret: getEnv('LOGGI_CLIENT_SECRET', 'demo_client_secret'),
      companyId: getEnv('LOGGI_COMPANY_ID', 'demo_company'),
    },

    origin: {
      name: getEnv('ORIGIN_NAME', 'Minha Loja de Adesivos'),
      phone: getEnv('ORIGIN_PHONE', '11999999999'),
      email: getEnv('ORIGIN_EMAIL', 'contato@minhaloja.com'),
      street: getEnv('ORIGIN_STREET', 'Rua das Flores'),
      number: getEnv('ORIGIN_NUMBER', '123'),
      complement: getEnv('ORIGIN_COMPLEMENT', 'Sala 1'),
      neighborhood: getEnv('ORIGIN_NEIGHBORHOOD', 'Centro'),
      city: getEnv('ORIGIN_CITY', 'Sao Paulo'),
      state: getEnv('ORIGIN_STATE', 'SP'),
      zip: getEnv('ORIGIN_ZIP', '01310100'),
    },

    package: {
      weightG: getEnvNumber('PACKAGE_WEIGHT_G', 50),
      lengthCm: getEnvNumber('PACKAGE_LENGTH_CM', 12),
      widthCm: getEnvNumber('PACKAGE_WIDTH_CM', 7),
      heightCm: getEnvNumber('PACKAGE_HEIGHT_CM', 1),
    },

    jobs: {
      pollIntervalMs: getEnvNumber('JOB_POLL_INTERVAL_MS', 5000),
      maxRetries: getEnvNumber('JOB_MAX_RETRIES', 5),
    },
  };
}

// Exportar config singleton
export const config = loadConfig();
