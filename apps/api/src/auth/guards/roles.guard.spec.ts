import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user: any): ExecutionContext {
    return {
      getHandler: () => {},
      getClass: () => {},
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access if route has no required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(null);
    const context = createMockContext({ role: 'REQUESTER' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access if user possesses a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['TENANT_ADMIN', 'APPROVER']);
    const context = createMockContext({ role: 'TENANT_ADMIN' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow SUPER_ADMIN access regardless of specific required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['APPROVER']);
    const context = createMockContext({ role: 'SUPER_ADMIN' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject access with ForbiddenException if user lacks required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['TENANT_ADMIN']);
    const context = createMockContext({ role: 'REQUESTER' });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should reject access with ForbiddenException if user identity is missing', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['TENANT_ADMIN']);
    const context = createMockContext(null);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
