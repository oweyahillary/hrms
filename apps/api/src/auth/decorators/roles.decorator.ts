import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
/** Restrict a route to the given role names, e.g. @Roles('Admin', 'HR Officer'). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
