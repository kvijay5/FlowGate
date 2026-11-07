import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookSignatureResult {
  header: string;
  timestamp: number;
  signature: string;
}

/**
 * Signs a webhook payload using HMAC-SHA256 with timestamp replay protection.
 */
export function signWebhookPayload(
  payloadString: string,
  secret: string,
  timestamp?: number,
): WebhookSignatureResult {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const signaturePayload = `${t}.${payloadString}`;
  const signature = createHmac('sha256', secret).update(signaturePayload).digest('hex');
  const header = `t=${t},v1=${signature}`;

  return {
    header,
    timestamp: t,
    signature,
  };
}

/**
 * Verifies an incoming webhook signature using constant-time comparison
 * and enforces timestamp tolerance to protect against replay attacks.
 */
export function verifyWebhookSignature(
  rawPayload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): { valid: boolean; reason?: string } {
  if (!signatureHeader) {
    return { valid: false, reason: 'Missing signature header' };
  }

  // Header format: t=1731000000,v1=abcdef...
  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, item) => {
    const [k, v] = item.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestampStr = parts['t'];
  const signature = parts['v1'];

  if (!timestampStr || !signature) {
    return { valid: false, reason: 'Malformed signature header format' };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp in signature' };
  }

  // 1. Replay attack verification: check age against tolerance window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return {
      valid: false,
      reason: `Signature timestamp expired or out of tolerance window (drift: ${Math.abs(now - timestamp)}s > ${toleranceSeconds}s)`,
    };
  }

  // 2. Cryptographic signature check
  const signaturePayload = `${timestamp}.${rawPayload}`;
  const expectedSignature = createHmac('sha256', secret).update(signaturePayload).digest('hex');

  const signatureBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (signatureBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  const isMatch = timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!isMatch) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}
