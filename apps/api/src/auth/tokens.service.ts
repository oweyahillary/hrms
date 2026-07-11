import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';

/** Claims embedded in the short-lived access JWT. */
export interface AccessTokenPayload {
  sub: string;   // userId
  org: string;   // organizationId
  role: string;  // role name
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Sign a short-lived access token. */
  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    // expiresIn accepts jsonwebtoken's strict StringValue template type; a
    // runtime env string ('15m') is fine at runtime, so cast the value.
    const expiresIn = (this.config.get<string>('JWT_ACCESS_TTL') ?? '15m') as unknown as number;
    return this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn,
    });
  }

  /** Verify + decode an access token (throws if invalid/expired). */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Refresh tokens are opaque random strings (NOT JWTs) so they can be revoked.
   * Only the SHA-256 hash is stored in the sessions table — a DB leak can't
   * replay them. Returns the raw token (given to the client once) + its hash.
   */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(48).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
  }

  refreshExpiry(): Date {
    const days = this.config.get<number>('JWT_REFRESH_TTL_DAYS') ?? 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
