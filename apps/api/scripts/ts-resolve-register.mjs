/**
 * Installs the extensionless-`.ts` resolution hook (ts-resolve-hooks.mjs) for
 * the node:test runner. Loaded via `node --import ./scripts/ts-resolve-register.mjs`.
 * See ts-resolve-hooks.mjs for why this is needed.
 */
import { register } from 'node:module';

register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
