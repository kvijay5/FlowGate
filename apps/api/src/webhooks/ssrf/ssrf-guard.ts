import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import { URL } from 'url';

export class SSRFProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFProtectionError';
  }
}

/**
 * Checks if a given IPv4 address belongs to private, loopback, link-local,
 * multicast, carrier-grade NAT, benchmark, or reserved ranges.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;

  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 is treated as unsafe
  }

  const [b0, b1, b2, b3] = parts;

  // 0.0.0.0/8 (Current network / "this host")
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private RFC 1918)
  if (b0 === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT RFC 6598)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 127.0.0.0/8 (Loopback RFC 1122)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-local RFC 3927, includes cloud metadata 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast RFC 7526)
  if (b0 === 192 && b1 === 88 && b2 === 99) return true;

  // 192.168.0.0/16 (Private RFC 1918)
  if (b0 === 192 && b1 === 168) return true;

  // 198.18.0.0/15 (Network benchmark tests RFC 2544)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;

  // 224.0.0.0/4 (Multicast RFC 5771)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reserved for future use RFC 1112)
  if (b0 >= 240) return true;

  // 255.255.255.255 (Broadcast)
  if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) return true;

  return false;
}

/**
 * Checks if a given IPv6 address belongs to private, loopback, link-local,
 * ULA, multicast, documentation, discard, or IPv4-mapped private ranges.
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  if (!net.isIPv6(ip)) return false;

  const lower = ip.toLowerCase();

  // Handle IPv4-mapped IPv6 (::ffff:192.0.2.128 or ::ffff:c000:0280)
  if (lower.startsWith('::ffff:') || lower.startsWith('0:0:0:0:0:ffff:')) {
    const lastPart = lower.split(':').pop() || '';
    if (net.isIPv4(lastPart)) {
      return isPrivateOrReservedIPv4(lastPart);
    }
  }

  // Unspecified (::)
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

  // Loopback (::1)
  if (
    lower === '::1' ||
    lower === '0:0:0:0:0:0:0:1' ||
    lower.endsWith(':0001') ||
    lower === '::0001'
  ) {
    const segments = lower.split(':').filter((s) => s.length > 0 && s !== '0');
    if (segments.length === 1 && (segments[0] === '1' || segments[0] === '0001')) {
      return true;
    }
  }

  // Unique Local Address (ULA fc00::/7 -> fc00 to fdff)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // Link-Local (fe80::/10 -> fe80 to febf)
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  ) {
    return true;
  }

  // Multicast (ff00::/8)
  if (lower.startsWith('ff')) return true;

  // Documentation (2001:db8::/32)
  if (lower.startsWith('2001:db8') || lower.startsWith('2001:0db8')) return true;

  // Discard-only (100::/64)
  if (lower.startsWith('100:')) return true;

  // 6to4 (2002::/16)
  if (lower.startsWith('2002:')) return true;

  return false;
}

/**
 * Checks whether an IP (v4 or v6) is private or reserved.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateOrReservedIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateOrReservedIPv6(ip);
  return true; // Not a valid IP -> unsafe
}

/**
 * Known cloud metadata and internal hostnames that must be blocked unconditionally.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  '169.254.169.254',
  'api.internal',
]);

/**
 * Validates a webhook destination URL against SSRF rules:
 * - Scheme must be https (or http if allowInsecureHttp is explicitly enabled in dev/test)
 * - Hostname cannot be localhost, cloud metadata, or internal domain
 * - DNS resolution must succeed and ALL resolved addresses must be public non-reserved IPs
 */
export async function validateWebhookDestination(
  urlStr: string,
  options?: {
    allowInsecureHttp?: boolean;
    dnsResolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  },
): Promise<{ url: URL; resolvedAddresses: Array<{ address: string; family: number }> }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new SSRFProtectionError(`Invalid webhook URL format: ${urlStr}`);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowHttp =
    options?.allowInsecureHttp ??
    (!isProduction && process.env.ALLOW_INSECURE_HTTP_WEBHOOKS === 'true');
  const allowLoopbackTest =
    !isProduction &&
    process.env.NODE_ENV === 'test' &&
    process.env.ALLOW_LOOPBACK_WEBHOOK_FOR_TESTS === 'true';

  if (parsed.protocol === 'https:') {
    // Valid HTTPS
  } else if (parsed.protocol === 'http:') {
    if (isProduction || !allowHttp) {
      throw new SSRFProtectionError(
        `Insecure HTTP scheme is not allowed for webhooks. HTTPS is required: ${urlStr}`,
      );
    }
  } else {
    throw new SSRFProtectionError(
      `Unsupported webhook protocol '${parsed.protocol}'. Only HTTPS is permitted.`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const rawHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  // Check known blocked hostnames
  if (
    (!allowLoopbackTest && (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOSTNAMES.has(rawHost))) ||
    (!allowLoopbackTest && hostname.endsWith('.localhost')) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    throw new SSRFProtectionError(
      `Webhook target host '${hostname}' is forbidden (SSRF protection).`,
    );
  }

  // Check if hostname is direct IP literal (IPv4 or IPv6)
  if (net.isIP(rawHost)) {
    if (allowLoopbackTest && (rawHost === '127.0.0.1' || rawHost === '::1')) {
      // Loopback explicitly permitted only in test mode with explicit flag
    } else if (isPrivateOrReservedIP(rawHost)) {
      throw new SSRFProtectionError(
        `Webhook target IP '${rawHost}' resolves to a private or reserved network range (SSRF protection).`,
      );
    }
  }

  // Resolve hostname using DNS and check ALL returned addresses
  const resolver =
    options?.dnsResolver ||
    (async (host: string) => {
      const records = await dns.promises.lookup(host, { all: true });
      return records.map((r) => ({ address: r.address, family: r.family }));
    });

  let resolvedAddresses: Array<{ address: string; family: number }>;
  try {
    resolvedAddresses = await resolver(hostname);
  } catch (err: any) {
    throw new SSRFProtectionError(`Failed to resolve webhook host '${hostname}': ${err.message}`);
  }

  if (!resolvedAddresses || resolvedAddresses.length === 0) {
    throw new SSRFProtectionError(`Webhook host '${hostname}' resolved to zero IP addresses.`);
  }

  for (const record of resolvedAddresses) {
    if (allowLoopbackTest && (record.address === '127.0.0.1' || record.address === '::1')) {
      continue;
    }
    if (isPrivateOrReservedIP(record.address)) {
      throw new SSRFProtectionError(
        `Webhook host '${hostname}' resolved to forbidden address '${record.address}' (SSRF protection).`,
      );
    }
  }

  return { url: parsed, resolvedAddresses };
}

export interface SafeRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  allowInsecureHttp?: boolean;
}

export interface SafeResponse {
  statusCode: number;
  statusMessage: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  resolvedIp: string;
  durationMs: number;
}

/**
 * Executes a secure HTTP/HTTPS POST or GET request with:
 * - Pre-connection DNS resolution & SSRF validation
 * - DNS Pinning / connection-time lookup protection against DNS rebinding
 * - Manual redirect validation (re-validating every redirect destination)
 * - Strict connect & response timeouts
 * - Response body truncation / limit
 * - No inheritance of internal credentials
 */
export async function executeSafeWebhookRequest(
  options: SafeRequestOptions,
  currentRedirectCount = 0,
): Promise<SafeResponse> {
  const {
    url: targetUrlStr,
    method = 'POST',
    headers = {},
    body = '',
    timeoutMs = 5000,
    connectTimeoutMs = 3000,
    maxResponseBytes = 65536, // 64 KB limit
    maxRedirects = 3,
    allowInsecureHttp = false,
  } = options;

  const startTime = Date.now();

  // 1. Validate destination & resolve IP
  const { url: targetUrl, resolvedAddresses } = await validateWebhookDestination(targetUrlStr, {
    allowInsecureHttp,
  });

  const chosenAddress = resolvedAddresses[0];
  const isHttps = targetUrl.protocol === 'https:';
  const transport = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  const port = targetUrl.port ? parseInt(targetUrl.port, 10) : defaultPort;

  // Filter out any sensitive internal headers
  const sanitizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lowerKey = k.toLowerCase();
    if (
      lowerKey === 'authorization' ||
      lowerKey === 'cookie' ||
      lowerKey === 'set-cookie' ||
      lowerKey.startsWith('x-internal-')
    ) {
      continue;
    }
    sanitizedHeaders[k] = v;
  }

  // Ensure Host header matches original hostname
  sanitizedHeaders['Host'] = targetUrl.host;
  sanitizedHeaders['Content-Length'] = Buffer.byteLength(body).toString();

  return new Promise<SafeResponse>((resolve, reject) => {
    let completed = false;
    let timer: NodeJS.Timeout | null = null;
    let connectTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (connectTimer) clearTimeout(connectTimer);
    };

    const requestOptions: https.RequestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port,
      path: targetUrl.pathname + targetUrl.search,
      method,
      headers: sanitizedHeaders,
      // For HTTPS, preserve servername for TLS SNI validation
      servername: isHttps ? targetUrl.hostname : undefined,
      // Custom DNS lookup pins to pre-validated IP to eliminate DNS rebinding TOCTOU
      lookup: (hostname, lookupOpts, cb) => {
        // Re-verify that resolved IP remains valid
        if (isPrivateOrReservedIP(chosenAddress.address)) {
          return cb(
            new SSRFProtectionError(
              `DNS rebinding detected: host resolved to forbidden IP ${chosenAddress.address}`,
            ),
            '',
            4,
          );
        }
        if (lookupOpts && (lookupOpts as any).all) {
          cb(null, [{ address: chosenAddress.address, family: chosenAddress.family }] as any);
        } else {
          cb(null, chosenAddress.address, chosenAddress.family);
        }
      },
    };

    const req = transport.request(requestOptions, async (res) => {
      if (connectTimer) clearTimeout(connectTimer);

      const statusCode = res.statusCode || 0;

      // Handle HTTP redirects (301, 302, 303, 307, 308) manually
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        if (currentRedirectCount >= maxRedirects) {
          cleanup();
          completed = true;
          req.destroy();
          return reject(
            new SSRFProtectionError(
              `Maximum redirect limit (${maxRedirects}) exceeded for webhook request.`,
            ),
          );
        }

        let redirectUrlStr: string;
        try {
          redirectUrlStr = new URL(res.headers.location, targetUrl).toString();
        } catch {
          cleanup();
          completed = true;
          req.destroy();
          return reject(
            new SSRFProtectionError(`Invalid redirect URL received: ${res.headers.location}`),
          );
        }

        cleanup();
        completed = true;
        req.destroy();

        try {
          // Re-execute with incremented redirect count and same payload
          const redirectRes = await executeSafeWebhookRequest(
            {
              ...options,
              url: redirectUrlStr,
            },
            currentRedirectCount + 1,
          );
          return resolve(redirectRes);
        } catch (err) {
          return reject(err);
        }
      }

      let responseData = '';
      let receivedBytes = 0;

      res.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes <= maxResponseBytes) {
          responseData += chunk.toString('utf8');
        } else if (!completed) {
          // Truncate response and destroy stream if limit exceeded
          req.destroy();
        }
      });

      res.on('end', () => {
        if (completed) return;
        cleanup();
        completed = true;
        resolve({
          statusCode,
          statusMessage: res.statusMessage || '',
          headers: res.headers,
          body: responseData.substring(0, maxResponseBytes),
          resolvedIp: chosenAddress.address,
          durationMs: Date.now() - startTime,
        });
      });

      res.on('error', (err) => {
        if (completed) return;
        cleanup();
        completed = true;
        reject(err);
      });
    });

    // Connection timeout
    connectTimer = setTimeout(() => {
      if (!completed) {
        completed = true;
        req.destroy(new Error(`Webhook connection timed out after ${connectTimeoutMs}ms`));
      }
    }, connectTimeoutMs);

    // Overall request timeout
    timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        req.destroy(new Error(`Webhook request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    req.on('socket', (socket) => {
      socket.on('connect', () => {
        if (connectTimer) clearTimeout(connectTimer);
      });
    });

    req.on('error', (err) => {
      if (completed) return;
      cleanup();
      completed = true;
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}
