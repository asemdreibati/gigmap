import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Request } from 'express';

import { ALLOW_NO_PROFILE_KEY, IS_PUBLIC_KEY } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';
import type { Env } from '../../config/env';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Verifies the Supabase access token the client already holds, then resolves
 * it to our own `users` row.
 *
 * Supabase Auth stays the identity provider — we never mint or store
 * passwords — but authorisation from here on is ours, enforced in the service
 * layer rather than by RLS.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);
  private readonly issuer: string;
  private readonly hmacKey?: Uint8Array;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.issuer = `${config.get('SUPABASE_URL', { infer: true })}/auth/v1`;

    const legacySecret = config.get('SUPABASE_JWT_SECRET', { infer: true });
    if (legacySecret) {
      // Legacy projects sign with a shared HS256 secret.
      this.hmacKey = new TextEncoder().encode(legacySecret);
    } else {
      // Current projects sign asymmetrically; jose caches and rotates the keys.
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const payload = await this.verify(this.extractToken(request));

    const subject = typeof payload.sub === 'string' ? payload.sub : null;
    if (!subject) {
      throw new UnauthorizedException('Token is missing a subject');
    }

    const profile = await this.prisma.user.findUnique({
      where: { id: subject },
      select: { role: true, isActive: true, email: true },
    });

    if (profile && !profile.isActive) {
      throw new ForbiddenException('This account has been deactivated');
    }

    const allowNoProfile = this.reflector.getAllAndOverride<boolean>(
      ALLOW_NO_PROFILE_KEY,
      targets,
    );

    if (!profile && !allowNoProfile) {
      // Signed up but never finished role selection.
      throw new ForbiddenException('Complete your profile before continuing');
    }

    const user: AuthenticatedUser = {
      id: subject,
      email: profile?.email ?? (typeof payload['email'] === 'string' ? payload['email'] : ''),
      role: profile?.role ?? null,
      hasProfile: profile !== null,
    };

    (request as Request & { user: AuthenticatedUser }).user = user;
    return true;
  }

  private extractToken(request: Request): string {
    const header = request.headers.authorization;
    const [scheme, token] = header?.split(' ') ?? [];

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    return token;
  }

  private async verify(token: string): Promise<JWTPayload> {
    try {
      const options = { issuer: this.issuer, audience: 'authenticated' };
      const { payload } = this.hmacKey
        ? await jwtVerify(token, this.hmacKey, options)
        : await jwtVerify(token, this.jwks!, options);

      return payload;
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error).message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
