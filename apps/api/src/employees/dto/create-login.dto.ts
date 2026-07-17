import { IsEmail, IsIn } from 'class-validator';

/**
 * The fixed role-name set this endpoint will resolve-or-create against (schema
 * doc-comment's intended default set — only 'Admin' is actually seeded today,
 * see apps/api/scripts/seed.ts). Granting 'Admin' is further restricted to
 * Admin actors in the service.
 */
export const GRANTABLE_ROLE_NAMES = ['Admin', 'HR Manager', 'HR Officer', 'Manager', 'Employee'] as const;
export type GrantableRoleName = (typeof GRANTABLE_ROLE_NAMES)[number];

export class CreateLoginDto {
  @IsEmail()
  email!: string;

  @IsIn(GRANTABLE_ROLE_NAMES)
  roleName!: GrantableRoleName;
}
