/**
 * Utilitários de validação e sanitização
 */

/**
 * Sanitiza CEP removendo tudo exceto dígitos
 * Ex: "01234-567" -> "01234567"
 */
export function sanitizeCep(cep: string | undefined | null): string {
  if (!cep) return '';
  return cep.replace(/\D/g, '');
}

/**
 * Valida se o CEP tem 8 dígitos
 */
export function isValidCep(cep: string): boolean {
  const sanitized = sanitizeCep(cep);
  return sanitized.length === 8;
}

/**
 * Sanitiza telefone removendo tudo exceto dígitos
 */
export function sanitizePhone(phone: string | undefined | null): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Valida UF brasileiro (2 letras maiúsculas)
 */
export function isValidUF(uf: string | undefined | null): boolean {
  if (!uf) return false;
  const validUFs = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
    'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
    'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];
  return validUFs.includes(uf.toUpperCase());
}

/**
 * Normaliza UF para maiúsculas
 */
export function normalizeUF(uf: string | undefined | null): string {
  if (!uf) return 'SP'; // Default
  const normalized = uf.toUpperCase().trim();
  return isValidUF(normalized) ? normalized : 'SP';
}

/**
 * Normaliza país (default BR se vazio ou inválido)
 */
export function normalizeCountry(country: string | undefined | null): string {
  if (!country || country.trim() === '') return 'BR';
  const normalized = country.toUpperCase().trim();
  // Aceita BR, BRA, Brasil, Brazil
  if (['BR', 'BRA', 'BRASIL', 'BRAZIL'].includes(normalized)) {
    return 'BR';
  }
  return normalized.slice(0, 2); // Pegar código de 2 letras
}

/**
 * Valida e normaliza endereço, preenchendo campos obrigatórios
 */
export function normalizeAddress(address: {
  street?: string;
  number?: string | number;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}): {
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
} {
  return {
    street: (address.street || 'Não informado').trim(),
    number: String(address.number || 'S/N').trim(),
    complement: address.complement?.trim() || null,
    neighborhood: (address.neighborhood || 'Centro').trim(),
    city: (address.city || 'Não informada').trim(),
    state: normalizeUF(address.state),
    zipCode: sanitizeCep(address.zipCode),
    country: normalizeCountry(address.country),
  };
}

/**
 * Valida se o endereço tem os campos mínimos para envio
 */
export function isAddressComplete(address: {
  street: string;
  number: string;
  city: string;
  state: string;
  zipCode: string;
}): boolean {
  return (
    address.street.length > 0 &&
    address.street !== 'Não informado' &&
    address.number.length > 0 &&
    address.city.length > 0 &&
    address.city !== 'Não informada' &&
    address.state.length === 2 &&
    address.zipCode.length === 8
  );
}

/**
 * Sanitiza string removendo caracteres especiais perigosos
 */
export function sanitizeString(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .replace(/[<>]/g, '') // Remove < e > para prevenir XSS
    .trim();
}

/**
 * Extrai primeiro nome de nome completo
 */
export function getFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || 'Cliente';
}
