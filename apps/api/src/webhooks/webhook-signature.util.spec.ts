import { signWebhookPayload, verifyWebhookSignature } from './webhook-signature.util';

describe('WebhookSignatureUtil', () => {
  const secret = 'whsec_test_secret_key_1234567890';
  const payload = JSON.stringify({
    event: 'request.created',
    requestId: 'req-abc-123',
    tenantId: 'tenant-xyz',
    amount: 5000,
  });

  it('should generate valid header with t= and v1= tokens', () => {
    const fixedTime = 1731000000;
    const { header, timestamp, signature } = signWebhookPayload(payload, secret, fixedTime);

    expect(timestamp).toBe(fixedTime);
    expect(signature).toBeDefined();
    expect(header).toBe(`t=${fixedTime},v1=${signature}`);
  });

  it('should successfully verify a freshly signed webhook payload', () => {
    const now = Math.floor(Date.now() / 1000);
    const { header } = signWebhookPayload(payload, secret, now);

    const result = verifyWebhookSignature(payload, header, secret, 300);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should reject if signature header is missing or empty', () => {
    const result = verifyWebhookSignature(payload, '', secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing signature header');
  });

  it('should reject if header is malformed', () => {
    const result1 = verifyWebhookSignature(payload, 'malformed-string', secret);
    expect(result1.valid).toBe(false);

    const result2 = verifyWebhookSignature(payload, 't=invalid,v1=abc', secret);
    expect(result2.valid).toBe(false);
    expect(result2.reason).toContain('Invalid timestamp');
  });

  it('should reject when secret is incorrect', () => {
    const now = Math.floor(Date.now() / 1000);
    const { header } = signWebhookPayload(payload, secret, now);
    const wrongSecret = 'whsec_incorrect_secret';

    const result = verifyWebhookSignature(payload, header, wrongSecret, 300);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('should reject when payload is tampered with', () => {
    const now = Math.floor(Date.now() / 1000);
    const { header } = signWebhookPayload(payload, secret, now);
    const tamperedPayload = JSON.stringify({
      event: 'request.created',
      requestId: 'req-abc-123',
      tenantId: 'tenant-xyz',
      amount: 999999, // Modified!
    });

    const result = verifyWebhookSignature(tamperedPayload, header, secret, 300);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('should reject timestamps older than tolerance window (replay attack protection)', () => {
    const now = Math.floor(Date.now() / 1000);
    const pastTimestamp = now - 350; // 350 seconds ago, beyond 300s tolerance
    const { header } = signWebhookPayload(payload, secret, pastTimestamp);

    const result = verifyWebhookSignature(payload, header, secret, 300);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('out of tolerance window');
  });

  it('should reject future timestamps beyond tolerance window (clock skew protection)', () => {
    const now = Math.floor(Date.now() / 1000);
    const futureTimestamp = now + 400; // 400 seconds in the future
    const { header } = signWebhookPayload(payload, secret, futureTimestamp);

    const result = verifyWebhookSignature(payload, header, secret, 300);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('out of tolerance window');
  });

  describe('Replay Deduplication inside tolerance window', () => {
    it('demonstrates that valid timestamp alone passes verification, requiring eventId deduplication', () => {
      const now = Math.floor(Date.now() / 1000);
      const { header } = signWebhookPayload(payload, secret, now);

      // Replay 1 (initial delivery)
      const initial = verifyWebhookSignature(payload, header, secret, 300);
      expect(initial.valid).toBe(true);

      // Replay 2 (captured by attacker and re-sent within window)
      // Timestamp verification passes because now is still within 300s!
      const replayed = verifyWebhookSignature(payload, header, secret, 300);
      expect(replayed.valid).toBe(true);

      // Persistent event-ID deduplication store detects the replay:
      const processedEventIds = new Set<string>();
      const eventId = 'evt-unique-abc-123';

      // First check: new event
      const isFirstDuplicate = processedEventIds.has(eventId);
      expect(isFirstDuplicate).toBe(false);
      processedEventIds.add(eventId);

      // Second check: repeated event inside window
      const isSecondDuplicate = processedEventIds.has(eventId);
      expect(isSecondDuplicate).toBe(true); // Caught by eventId deduplication!
    });
  });
});
