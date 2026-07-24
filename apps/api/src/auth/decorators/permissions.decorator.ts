import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
/** Restrict a route to callers whose role grants ALL of the given permission keys, e.g. @Permissions('employees.write'). */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSION_KEY = 'anyPermission';
/**
 * Restrict a route to callers whose role grants AT LEAST ONE of the given
 * keys, e.g. @AnyPermission('leave.view', 'leave.approve', 'leave.manage')
 * for a list endpoint that any of the three should be able to reach. Use
 * @Permissions() instead when the route genuinely needs every listed key.
 */
export const AnyPermission = (...permissions: string[]) => SetMetadata(ANY_PERMISSION_KEY, permissions);
