import { SetMetadata } from '@nestjs/common';

export const BYPASS_PASSWORD_CHANGE_KEY = 'bypassPasswordChange';
/**
 * Marks a route as reachable even while the user must change their password
 * (e.g. the change-password endpoint itself, and identity/logout). Every other
 * authenticated route is blocked by PasswordChangeGuard until the flag clears.
 */
export const BypassPasswordChange = () => SetMetadata(BYPASS_PASSWORD_CHANGE_KEY, true);
