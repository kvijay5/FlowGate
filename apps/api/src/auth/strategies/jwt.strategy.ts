import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser, JwtPayload, UserRole, UserStatus } from '@flowgate/shared-types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret =
      configService.get<string>('JWT_SECRET') ||
      'flowgate_dev_jwt_secret_change_in_production_min32chars';

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token claims');
    }

    // Verify user exists and belongs to the claimed tenant
    const user = await this.prisma.user.findUnique({
      where: {
        tenant_user_id_unique: {
          tenantId: payload.tenantId,
          id: payload.sub,
        },
      },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User account not found in tenant');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is suspended or inactive');
    }

    if (user.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tenant organization is suspended or inactive');
    }

    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      status: user.status as UserStatus,
    };
  }
}
