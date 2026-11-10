import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { RequestUser } from '../interfaces/request-user.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const anyPermissions =
      this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (requiredPermissions.length === 0 && anyPermissions.length === 0) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: RequestUser }>();
    const userPermissions: string[] = user?.role?.permissions ?? [];

    const hasAllPermissions = requiredPermissions.every((permission) =>
      userPermissions.includes(permission),
    );
    const hasAnyPermission =
      anyPermissions.length === 0 ||
      anyPermissions.some((permission) => userPermissions.includes(permission));

    if (!hasAllPermissions || !hasAnyPermission) {
      throw new ForbiddenException(
        'No tienes permisos suficientes para realizar esta acción',
      );
    }

    return true;
  }
}
