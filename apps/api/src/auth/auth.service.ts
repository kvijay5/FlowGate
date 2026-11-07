import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponse, JwtPayload, UserRole, UserStatus } from '@flowgate/shared-types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Authenticates a tenant member using tenantSlug, email, and password.
   * Employs generic error responses to prevent tenant or user enumeration attacks.
   */
  async login(dto: LoginDto): Promise<AuthResponse> {
    const genericErrorMessage = 'Invalid credentials';

    // 1. Resolve tenant by slug
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug.toLowerCase().trim() },
    });

    if (!tenant || tenant.status !== 'ACTIVE') {
      // Do not reveal whether tenant exists or is inactive
      throw new UnauthorizedException(genericErrorMessage);
    }

    // 2. Resolve user within the tenant by email
    const user = await this.prisma.user.findUnique({
      where: {
        tenant_user_email_unique: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase().trim(),
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      // Do not reveal whether user exists or is inactive
      throw new UnauthorizedException(genericErrorMessage);
    }

    // 3. Verify password hash using bcrypt
    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException(genericErrorMessage);
    }

    // 4. Construct trusted JWT claims
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: user.role as UserRole,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    this.logger.log(`User ${user.email} successfully authenticated for tenant ${tenant.slug}`);

    return {
      accessToken,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        status: user.status as UserStatus,
      },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        createdAt: tenant.createdAt.toISOString(),
      },
    };
  }

  /**
   * Returns authenticated user profile and tenant details.
   */
  async getProfile(userId: string, tenantId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        tenant_user_id_unique: {
          tenantId,
          id: userId,
        },
      },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User profile not found');
    }

    return {
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role as UserRole,
        status: user.status as UserStatus,
        createdAt: user.createdAt.toISOString(),
      },
      tenant: {
        id: user.tenant.id,
        slug: user.tenant.slug,
        name: user.tenant.name,
        status: user.tenant.status,
        settings: user.tenant.settings,
        createdAt: user.tenant.createdAt.toISOString(),
      },
    };
  }
}
