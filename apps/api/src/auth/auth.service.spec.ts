import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: any;
  let mockJwt: any;

  const samplePasswordHash = bcrypt.hashSync('CorrectPassword123!', 10);

  const mockTenant = {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'acme-corp',
    name: 'Acme Corporation',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };

  const mockUser = {
    id: '22222222-2222-2222-2222-222222222222',
    tenantId: mockTenant.id,
    email: 'admin@acme.com',
    name: 'Alice Vance',
    passwordHash: samplePasswordHash,
    role: 'TENANT_ADMIN',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    tenant: mockTenant,
  };

  beforeEach(async () => {
    mockPrisma = {
      tenant: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };

    mockJwt = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should successfully log in with valid credentials', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(mockTenant);
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

    const result = await service.login({
      tenantSlug: 'acme-corp',
      email: 'admin@acme.com',
      password: 'CorrectPassword123!',
    });

    expect(result).toHaveProperty('accessToken', 'signed.jwt.token');
    expect(result.user).toEqual({
      id: mockUser.id,
      tenantId: mockUser.tenantId,
      email: mockUser.email,
      name: mockUser.name,
      role: mockUser.role,
      status: mockUser.status,
    });
    expect(result.tenant.slug).toBe('acme-corp');
    expect(mockJwt.signAsync).toHaveBeenCalledWith({
      sub: mockUser.id,
      tenantId: mockTenant.id,
      email: mockUser.email,
      role: mockUser.role,
    });
  });

  it('should reject login if tenant does not exist with generic error', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.login({
        tenantSlug: 'non-existent',
        email: 'admin@acme.com',
        password: 'Password123!',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('should reject login if user does not exist in tenant with generic error', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(mockTenant);
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.login({
        tenantSlug: 'acme-corp',
        email: 'unknown@acme.com',
        password: 'Password123!',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('should reject login if password does not match with generic error', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(mockTenant);
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

    await expect(
      service.login({
        tenantSlug: 'acme-corp',
        email: 'admin@acme.com',
        password: 'WrongPassword!',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('should reject login if user account is inactive', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValueOnce(mockTenant);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...mockUser,
      status: 'SUSPENDED',
    });

    await expect(
      service.login({
        tenantSlug: 'acme-corp',
        email: 'admin@acme.com',
        password: 'CorrectPassword123!',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
  });

  it('should retrieve authenticated user profile and tenant summary', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(mockUser);

    const profile = await service.getProfile(mockUser.id, mockTenant.id);
    expect(profile.user.id).toBe(mockUser.id);
    expect(profile.tenant.slug).toBe(mockTenant.slug);
  });
});
