import * as http from 'http';
import {
  isPrivateOrReservedIPv4,
  isPrivateOrReservedIPv6,
  isPrivateOrReservedIP,
  validateWebhookDestination,
  executeSafeWebhookRequest,
  SSRFProtectionError,
} from './ssrf-guard';

describe('SSRF Guard & Webhook Destination Security', () => {
  describe('isPrivateOrReservedIPv4', () => {
    it('should reject loopback addresses (127.0.0.0/8)', () => {
      expect(isPrivateOrReservedIPv4('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('127.1.2.3')).toBe(true);
      expect(isPrivateOrReservedIPv4('127.255.255.255')).toBe(true);
    });

    it('should reject RFC 1918 private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
      expect(isPrivateOrReservedIPv4('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('10.254.1.2')).toBe(true);
      expect(isPrivateOrReservedIPv4('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('172.31.255.254')).toBe(true);
      expect(isPrivateOrReservedIPv4('192.168.1.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('192.168.100.200')).toBe(true);
    });

    it('should allow public IPv4 addresses', () => {
      expect(isPrivateOrReservedIPv4('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIPv4('1.1.1.1')).toBe(false);
      expect(isPrivateOrReservedIPv4('93.184.216.34')).toBe(false);
      expect(isPrivateOrReservedIPv4('142.250.190.46')).toBe(false);
      expect(isPrivateOrReservedIPv4('172.15.255.255')).toBe(false);
      expect(isPrivateOrReservedIPv4('172.32.0.1')).toBe(false);
    });

    it('should reject link-local and cloud metadata endpoints (169.254.0.0/16)', () => {
      expect(isPrivateOrReservedIPv4('169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIPv4('169.254.1.1')).toBe(true);
    });

    it('should reject multicast and reserved ranges', () => {
      expect(isPrivateOrReservedIPv4('0.0.0.0')).toBe(true);
      expect(isPrivateOrReservedIPv4('224.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('240.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv4('255.255.255.255')).toBe(true);
    });
  });

  describe('isPrivateOrReservedIPv6', () => {
    it('should reject loopback (::1)', () => {
      expect(isPrivateOrReservedIPv6('::1')).toBe(true);
      expect(isPrivateOrReservedIPv6('0:0:0:0:0:0:0:1')).toBe(true);
    });

    it('should reject unspecified (::)', () => {
      expect(isPrivateOrReservedIPv6('::')).toBe(true);
    });

    it('should reject Unique Local Addresses (fc00::/7)', () => {
      expect(isPrivateOrReservedIPv6('fc00::1')).toBe(true);
      expect(isPrivateOrReservedIPv6('fd12:3456:789a:1::1')).toBe(true);
    });

    it('should reject link-local IPv6 (fe80::/10)', () => {
      expect(isPrivateOrReservedIPv6('fe80::1')).toBe(true);
      expect(isPrivateOrReservedIPv6('fe80::200:5efe:10.0.0.1')).toBe(true);
    });

    it('should reject IPv4-mapped IPv6 pointing to private/loopback', () => {
      expect(isPrivateOrReservedIPv6('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv6('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateOrReservedIPv6('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIPv6('::ffff:192.168.1.1')).toBe(true);
    });

    it('should allow public IPv4-mapped IPv6', () => {
      expect(isPrivateOrReservedIPv6('::ffff:8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIPv6('::ffff:93.184.216.34')).toBe(false);
    });

    it('should allow public global unicast IPv6', () => {
      expect(isPrivateOrReservedIPv6('2607:f8b0:4005:805::200e')).toBe(false);
      expect(isPrivateOrReservedIPv6('2404:6800:4007:806::2004')).toBe(false);
    });
  });

  describe('isPrivateOrReservedIP', () => {
    it('should correctly classify both IPv4 and IPv6 addresses', () => {
      expect(isPrivateOrReservedIP('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIP('::1')).toBe(true);
      expect(isPrivateOrReservedIP('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIP('2607:f8b0:4005:805::200e')).toBe(false);
    });
  });

  describe('validateWebhookDestination', () => {
    it('should reject invalid URL strings', async () => {
      await expect(validateWebhookDestination('not-a-valid-url')).rejects.toThrow(
        SSRFProtectionError,
      );
    });

    it('should reject non-HTTP schemes (ftp, file, gopher, javascript)', async () => {
      await expect(validateWebhookDestination('ftp://api.example.com/webhook')).rejects.toThrow(
        'Unsupported webhook protocol',
      );
      await expect(validateWebhookDestination('file:///etc/passwd')).rejects.toThrow(
        'Unsupported webhook protocol',
      );
      await expect(validateWebhookDestination('gopher://localhost:70/')).rejects.toThrow(
        'Unsupported webhook protocol',
      );
    });

    it('should reject URLs with embedded credentials (user:password@)', async () => {
      await expect(
        validateWebhookDestination('https://admin:secret123@example.com/webhook'),
      ).rejects.toThrow('Embedded credentials');
    });

    it('should strictly enforce HTTPS in production regardless of allowInsecureHttp options', async () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        await expect(
          validateWebhookDestination('http://example.com/webhook', {
            allowInsecureHttp: true,
          }),
        ).rejects.toThrow('Insecure HTTP scheme is not allowed');
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    it('should reject HTTP scheme when allowInsecureHttp is false or in production', async () => {
      await expect(
        validateWebhookDestination('http://api.example.com/webhook', { allowInsecureHttp: false }),
      ).rejects.toThrow('Insecure HTTP scheme is not allowed');
    });

    it('should reject direct localhost and loopback targets', async () => {
      await expect(validateWebhookDestination('https://localhost/webhook')).rejects.toThrow(
        'forbidden (SSRF protection)',
      );
      await expect(validateWebhookDestination('https://sub.localhost/webhook')).rejects.toThrow(
        'forbidden (SSRF protection)',
      );
      await expect(validateWebhookDestination('https://127.0.0.1:4000/webhook')).rejects.toThrow(
        'resolves to a private or reserved network range',
      );
      await expect(validateWebhookDestination('https://[::1]/webhook')).rejects.toThrow(
        'resolves to a private or reserved network range',
      );
    });

    it('should reject cloud metadata hostnames and addresses', async () => {
      await expect(
        validateWebhookDestination('https://metadata.google.internal/computeMetadata/v1/'),
      ).rejects.toThrow('forbidden (SSRF protection)');
      await expect(
        validateWebhookDestination('https://169.254.169.254/latest/meta-data/'),
      ).rejects.toThrow('SSRF protection');
    });

    it('should reject hostnames that resolve to private IPs', async () => {
      const mockResolver = jest.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

      await expect(
        validateWebhookDestination('https://my-internal-service.org/webhook', {
          dnsResolver: mockResolver,
        }),
      ).rejects.toThrow("resolved to forbidden address '10.0.0.5'");
    });

    it('should reject hostnames if ANY returned address is private/forbidden', async () => {
      const mockResolver = jest.fn().mockResolvedValue([
        { address: '93.184.216.34', family: 4 }, // public
        { address: '127.0.0.1', family: 4 }, // forbidden!
      ]);

      await expect(
        validateWebhookDestination('https://dual-homed.example.com/webhook', {
          dnsResolver: mockResolver,
        }),
      ).rejects.toThrow("resolved to forbidden address '127.0.0.1'");
    });

    it('should reject hostnames where DNS resolution fails', async () => {
      const mockResolver = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));

      await expect(
        validateWebhookDestination('https://non-existent-domain-404-xyz.com/webhook', {
          dnsResolver: mockResolver,
        }),
      ).rejects.toThrow('Failed to resolve webhook host');
    });

    it('should allow valid public HTTPS destinations', async () => {
      const mockResolver = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

      const result = await validateWebhookDestination('https://example.com/webhook', {
        dnsResolver: mockResolver,
      });

      expect(result.url.hostname).toBe('example.com');
      expect(result.resolvedAddresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
  });

  describe('executeSafeWebhookRequest (Runtime Security & Redirects)', () => {
    let server: http.Server;
    let serverPort: number;

    const originalLoopbackEnv = process.env.ALLOW_LOOPBACK_WEBHOOK_FOR_TESTS;

    beforeAll((done) => {
      process.env.ALLOW_LOOPBACK_WEBHOOK_FOR_TESTS = 'true';
      // Local test HTTP server
      server = http.createServer((req, res) => {
        if (req.url === '/redirect-to-private') {
          res.writeHead(302, { Location: 'http://10.0.0.1:9999/secret' });
          res.end();
        } else if (req.url === '/infinite-redirect') {
          res.writeHead(302, { Location: `http://127.0.0.1:${serverPort}/infinite-redirect` });
          res.end();
        } else if (req.url === '/echo') {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'X-Echo-Auth': req.headers['authorization'] || 'none',
              'X-Echo-Cookie': req.headers['cookie'] || 'none',
            });
            res.end(JSON.stringify({ received: body, ok: true }));
          });
        } else if (req.url === '/large-body') {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('A'.repeat(100000)); // 100 KB
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(0, '127.0.0.1', () => {
        serverPort = (server.address() as any).port;
        done();
      });
    });

    afterAll((done) => {
      process.env.ALLOW_LOOPBACK_WEBHOOK_FOR_TESTS = originalLoopbackEnv;
      server.close(done);
    });

    it('should block redirects to private or loopback destinations', async () => {
      // Even with allowInsecureHttp: true for the test, redirect to 127.0.0.1 must fail!
      await expect(
        executeSafeWebhookRequest({
          url: `http://127.0.0.1:${serverPort}/redirect-to-private`,
          allowInsecureHttp: true,
        }),
      ).rejects.toThrow(SSRFProtectionError);
    });

    it('should enforce redirect hop limits', async () => {
      await expect(
        executeSafeWebhookRequest({
          url: `http://127.0.0.1:${serverPort}/infinite-redirect`,
          maxRedirects: 2,
          allowInsecureHttp: true,
        }),
      ).rejects.toThrow(SSRFProtectionError);
    });

    it('should enforce streaming response size limits and truncate response safely', async () => {
      const res = await executeSafeWebhookRequest({
        url: `http://127.0.0.1:${serverPort}/large-body`,
        maxResponseBytes: 500, // 500 bytes limit on a 100KB stream
        allowInsecureHttp: true,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBe(500);
      expect(res.body).toBe('A'.repeat(500));
    });

    it('should strip sensitive headers such as authorization across redirects', async () => {
      const res = await executeSafeWebhookRequest({
        url: `http://127.0.0.1:${serverPort}/echo`,
        headers: {
          Authorization: 'Bearer super-secret-internal-key',
          Cookie: 'session=12345',
          'X-Internal-Token': 'do-not-leak',
          'X-Custom-Public': 'public-val',
        },
        allowInsecureHttp: true,
      });

      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(true);
      expect(res.headers['x-echo-auth']).toBe('none');
      expect(res.headers['x-echo-cookie']).toBe('none');
    });
  });
});
