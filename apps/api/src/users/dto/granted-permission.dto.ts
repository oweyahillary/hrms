import { IsIn } from 'class-validator';
import { PERMISSION_KEYS } from '../../auth/permissions';

/**
 * One held permission with its scope. Whether OWN_DEPARTMENT is actually
 * honoured for a given key is NOT decided here — UsersService.normalize
 * FORCES 'ALL' server-side for any key that isn't scopeable (see
 * auth/permissions.ts's isScopeable), regardless of what the client sends.
 * Never trust the client's scope choice on its own.
 */
export class GrantedPermissionDto {
  @IsIn(PERMISSION_KEYS)
  key!: string;

  @IsIn(['ALL', 'OWN_DEPARTMENT'])
  scope!: 'ALL' | 'OWN_DEPARTMENT';
}
