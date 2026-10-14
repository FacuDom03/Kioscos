export interface ConfigMp {
  clientId: string;
  clientSecret: string;
  /** URL de callback registrada en la app de Mercado Pago: <origen>/api/v1/mp/callback */
  redirectUri: string;
  /** Clave secreta de webhooks de la app (Tus integraciones). */
  webhookSecret: string;
  apiBase: string;
  authUrl: string;
  /** true en el entorno de pruebas de Mercado Pago. */
  pruebas: boolean;
}

/** Devuelve null si Mercado Pago no está configurado en este servidor. */
export function configMpDesdeEntorno(
  origen: string,
  entorno: NodeJS.ProcessEnv = process.env,
): ConfigMp | null {
  const clientId = entorno['MP_CLIENT_ID'];
  const clientSecret = entorno['MP_CLIENT_SECRET'];
  const webhookSecret = entorno['MP_WEBHOOK_SECRET'];
  if (!clientId || !clientSecret || !webhookSecret) return null;
  return {
    clientId,
    clientSecret,
    webhookSecret,
    redirectUri: entorno['MP_REDIRECT_URI'] ?? `${origen}/api/v1/mp/callback`,
    apiBase: entorno['MP_API_BASE'] ?? 'https://api.mercadopago.com',
    authUrl: entorno['MP_AUTH_URL'] ?? 'https://auth.mercadopago.com.ar/authorization',
    pruebas: entorno['MP_PRUEBAS'] === '1',
  };
}
