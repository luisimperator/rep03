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

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadConfig(): Config {
  // Railway usa PORT, outros usam APP_PORT
  const port = getEnvNumber('PORT', getEnvNumber('APP_PORT', 3000));

  // Provider de envio: 'loggi' ou 'melhorenvio'
  const shippingProvider = getEnv('SHIPPING_PROVIDER', 'melhorenvio') as 'loggi' | 'melhorenvio';

  return {
    port,
    shippingProvider,

    eduzz: {
      webhookSecret: getEnv('EDUZZ_WEBHOOK_SECRET', 'edzwgp_w8Zxg06nroieQMJzJeYQOi59KCDAcSpuGKXDbraHYJEZfNL0g'),
      // IDs dos produtos de adesivos do Canal do Anfitrião
      allowedProductIds: parseCSV(getEnv('EDUZZ_ALLOWED_PRODUCT_IDS',
        '1461811,1521176,1521233,1521243,1521415,2320335,2320422,2320426,2320427,2897710'
      )),
      allowedSkus: parseCSV(getEnv('EDUZZ_ALLOWED_SKUS', '')),
    },

    loggi: {
      baseUrl: getEnv('LOGGI_BASE_URL', 'https://api.loggi.com'),
      clientId: getEnv('LOGGI_CLIENT_ID', ''),
      clientSecret: getEnv('LOGGI_CLIENT_SECRET', ''),
      companyId: getEnv('LOGGI_COMPANY_ID', ''),
    },

    melhorEnvio: {
      clientId: getEnv('MELHOR_ENVIO_CLIENT_ID', '22043'),
      token: getEnv('MELHOR_ENVIO_TOKEN', 'xYaID6vCbDl3i2zFcPl0wGbY1nduj6yN1yRhBe2d'),
      sandbox: getEnvBoolean('MELHOR_ENVIO_SANDBOX', false),
    },

    unnichat: {
      apiUrl: getEnv('UNNICHAT_API_URL', ''),
      token: getEnv('UNNICHAT_TOKEN', ''),
      enabled: getEnvBoolean('UNNICHAT_ENABLED', false),
    },

    origin: {
      name: getEnv('ORIGIN_NAME', 'Canal do Anfitriao'),
      phone: getEnv('ORIGIN_PHONE', '11961859863'),
      email: getEnv('ORIGIN_EMAIL', 'contato@canaldoanfitriao.com.br'),
      street: getEnv('ORIGIN_STREET', 'Avenida Nacoes Unidas'),
      number: getEnv('ORIGIN_NUMBER', '14401'),
      complement: getEnv('ORIGIN_COMPLEMENT', 'Torre Taruma - Cj 2804'),
      neighborhood: getEnv('ORIGIN_NEIGHBORHOOD', 'Chacara Santo Antonio'),
      city: getEnv('ORIGIN_CITY', 'Sao Paulo'),
      state: getEnv('ORIGIN_STATE', 'SP'),
      zip: getEnv('ORIGIN_ZIP', '04794000'),
      document: getEnv('ORIGIN_DOCUMENT', ''), // CPF
      companyDocument: getEnv('ORIGIN_COMPANY_DOCUMENT', ''), // CNPJ
      stateRegister: getEnv('ORIGIN_STATE_REGISTER', ''), // Inscrição estadual
    },

    package: {
      weightG: getEnvNumber('PACKAGE_WEIGHT_G', 100), // 100g para kit de adesivos
      lengthCm: getEnvNumber('PACKAGE_LENGTH_CM', 20),
      widthCm: getEnvNumber('PACKAGE_WIDTH_CM', 15),
      heightCm: getEnvNumber('PACKAGE_HEIGHT_CM', 2),
    },

    jobs: {
      pollIntervalMs: getEnvNumber('JOB_POLL_INTERVAL_MS', 5000),
      maxRetries: getEnvNumber('JOB_MAX_RETRIES', 5),
    },
  };
}

// Exportar config singleton
export const config = loadConfig();
