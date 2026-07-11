/**
 * Typed configuration namespace. Read via ConfigService.get('...') anywhere
 * in the app so no module reaches into process.env directly.
 */
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL as string,
});
