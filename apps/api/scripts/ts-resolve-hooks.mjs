/**
 * Module resolution hook for Node's native TypeScript test runner
 * (`node --experimental-strip-types --test`).
 *
 * The app's source uses extensionless relative imports (e.g.
 * `import { nextInstallment } from '../loans/loan-math'`) because that's what
 * tsc / `nest build` expect. Node's runtime ESM resolver, however, requires a
 * full extension and does NOT auto-resolve `.ts` on transitive import hops — so
 * a node:test spec that pulls in a module which itself imports another module
 * extensionlessly fails with ERR_MODULE_NOT_FOUND.
 *
 * This hook keeps the source untouched (so `nest build` is unaffected) and only
 * affects the test process: when a relative, extensionless specifier fails to
 * resolve, it retries with a `.ts` suffix.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasKnownExt = /\.(c|m)?(j|t)s$/i.test(specifier) || /\.json$/i.test(specifier);
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && isRelative && !hasKnownExt) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
