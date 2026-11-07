import { createHmac, timingSafeEqual } from 'crypto';

export interface WebhookSignatureResult {
  header: string;
  timestamp: number;
  signature: string;
}

export interface VerifyWebhookResult {
  valid: boolean;
  timestamp?: number;
  eventId?: string;
  reason?: string;
}

/**
 * Signs a webhook payload using HMAC-SHA256 with timestamp replay protection.
 * Format: t={timestamp},v1={hmac_sha256_hex}
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
 * SECURITY NOTE ON REPLAY ATTACKS:
 * Timestamp validation enforces an upper bound on how long a signature is considered fresh
 * (default tolerance: 300 seconds). However, timestamp validation alone CANNOT prevent
 * replay attacks within that allowed window. An adversary capturing a valid HTTP request
 * could replay the exact payload and headers within the 300-second window.
 *
 * Receiver-Side Deduplication Instructions:
 * 1. Extract the stable logical event ID from the `X-FlowGate-Event-Id` header (or payload `eventId`).
 * 2. Maintain a persistent deduplication store (e.g., Redis key with TTL >= 600s, or a DB table).
 * 3. Before executing business logic, check if `(tenantId, eventId)` was already processed.
 * 4. If already processed, acknowledge with 200 OK (idempotent no-op) and discard the duplicate.
 * 5. If not processed, record the event ID atomically and proceed with processing.
 *
 * Logical Event vs. Delivery Attempt:
 * - A "logical event" (`eventId`) represents a single business state change (e.g. request approved).
 * - A "delivery attempt" (`deliveryId`) represents a single HTTP transmission.
 * - When retrying an outbound delivery due to network failure, the `eventId` is strictly preserved,
 *   while the `deliveryId` identifies the attempt.
 */
export function verifyWebhookSignature(
  rawPayload: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): VerifyWebhookResult {
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

  // 1. Timestamp drift verification: check age against tolerance window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return {
      valid: false,
      reason: `Signature timestamp expired or out of tolerance window (drift: ${Math.abs(now - timestamp)}s > ${toleranceSeconds}s)`,
    };
  }

  // 2. Cryptographic signature check with constant-time comparison
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

  return { valid: true, timestamp };
}
