import { z } from 'zod';

/**
 * Environment contract. Validated once at boot so a missing key fails the
 * process immediately rather than the first time a request touches it.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Minimum level written. `log` is Nest's "info". */
    LOG_LEVEL: z.enum(['verbose', 'debug', 'log', 'warn', 'error', 'fatal']).default('log'),
    /** Defaults to `json` in production and `text` elsewhere. */
    LOG_FORMAT: z.enum(['json', 'text']).optional(),
    /**
     * Number of reverse proxies in front of the API (load balancer, ingress),
     * so `req.ip` is the client rather than the proxy. 0 trusts none.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    PORT: z.coerce.number().int().default(3333),
    /**
     * How long to keep serving after SIGTERM with readiness failing, so the
     * load balancer stops routing here before the server closes. 0 suits
     * platforms that stop routing before signalling (Cloud Run); Kubernetes
     * needs a few seconds. See ADR 0012.
     */
    SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(60_000).default(0),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url().optional(),

    SUPABASE_URL: z.string().url(),
    /**
     * Only set on legacy HS256 projects. When empty the guard verifies tokens
     * against the project's published JWKS instead, which is what new Supabase
     * projects issue.
     */
    SUPABASE_JWT_SECRET: z.string().optional(),

    /**
     * Shared state for running more than one instance: rate-limit counters.
     * Optional; without it each instance counts on its own. ADR 0014.
     */
    REDIS_URL: z.string().url().optional(),

    EXPO_ACCESS_TOKEN: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
    ADMIN_EMAIL: z.string().email().optional(),
  })
  .transform((env) => ({
    ...env,
    LOG_FORMAT: env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'text'),
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}
