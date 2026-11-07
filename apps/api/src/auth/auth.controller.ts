import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { CurrentTenant } from './decorators/current-tenant.decorator';
import { AuthenticatedUser } from '@flowgate/shared-types';
import { Throttle } from '@nestjs/throttler';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Tenant Member Login
   * Rate limited: max 10 attempts per minute per IP.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: process.env.NODE_ENV === 'test' ? 100 : 10, ttl: 60000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Current Authenticated User & Tenant Context
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser('id') userId: string, @CurrentTenant() tenantId: string) {
    return this.authService.getProfile(userId, tenantId);
  }

  /**
   * Endpoint demonstrating Role-Based Access Control (RBAC)
   * Restricted strictly to TENANT_ADMIN and SUPER_ADMIN roles.
   */
  @Get('admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  adminOnlyEndpoint(@CurrentUser() user: AuthenticatedUser) {
    return {
      message: 'Access granted to privileged administrative resource',
      user: {
        id: user.id,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }
}
