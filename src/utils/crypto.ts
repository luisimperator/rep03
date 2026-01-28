import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Gera HMAC-SHA256 de um payload usando uma chave secreta
 */
export function generateHmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verifica assinatura HMAC-SHA256 de forma constant-time
 * Previne timing attacks
 */
export function verifyHmacSignature(
  secret: string,
  payload: string,
  signature: string
): boolean {
  const expected = generateHmacSha256(secret, payload);

  // Garantir que ambos têm o mesmo tamanho para timingSafeEqual
  if (signature.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    // Em caso de erro (ex: signature não é hex válido)
    return false;
  }
}

/**
 * Alternativa: verifica signature como string (alguns webhooks enviam em formato diferente)
 */
export function verifyHmacSignatureString(
  secret: string,
  payload: string,
  signature: string
): boolean {
  const expected = generateHmacSha256(secret, payload);

  // Para strings, converter para buffer
  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
