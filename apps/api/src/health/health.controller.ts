import { Controller, Get, Optional } from '@nestjs/common';
import { HealthCheckResponse } from '@flowgate/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  @Get(['health', 'api/health'])
  async check(): Promise<HealthCheckResponse> {
    let dbStatus: 'connected' | 'disconnected' = 'disconnected';
    let responseTimeMs: number | undefined;

    if (this.prisma) {
      const start = Date.now();
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
        responseTimeMs = Date.now() - start;
      } catch {
        dbStatus = 'disconnected';
      }
    }

    return {
      status: dbStatus === 'connected' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      version: '0.1.0',
      service: 'flowgate-api',
      database: {
        status: dbStatus,
        ...(responseTimeMs !== undefined ? { responseTimeMs } : {}),
      },
    };
  }
}
