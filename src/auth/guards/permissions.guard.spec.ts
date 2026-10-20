import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: PermissionsGuard;

  const metadata = (values: { isPublic?: boolean; permissions?: string[] }) =>
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return values.isPublic;
      if (key === PERMISSIONS_KEY) return values.permissions;
      return undefined;
    });

  const contextFor = (permissions?: string[]) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: permissions ? { role: { permissions } } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new PermissionsGuard(reflector as unknown as Reflector);
  });

  it('allows @Public() handlers without a user', () => {
    metadata({ isPublic: true, permissions: ['users:create'] });
    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('allows any authenticated user when no permissions are required', () => {
    metadata({});
    expect(guard.canActivate(contextFor([]))).toBe(true);
  });

  it('allows a user that has every required permission', () => {
    metadata({ permissions: ['users:read', 'users:update'] });
    expect(
      guard.canActivate(
        contextFor(['users:read', 'users:update', 'roles:read']),
      ),
    ).toBe(true);
  });

  it('rejects with 403 when any required permission is missing', () => {
    metadata({ permissions: ['users:read', 'users:create'] });
    expect(() => guard.canActivate(contextFor(['users:read']))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects with 403 when there is no user on the request', () => {
    metadata({ permissions: ['users:read'] });
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
