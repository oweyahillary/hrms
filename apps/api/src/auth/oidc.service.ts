import {
  BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { TokensService } from './tokens.service';
import { AuthService } from './auth.service';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/**
 * OpenID Connect (Authorization Code flow) groundwork. Feature-flagged via
 * SSO_ENABLED and dormant until a pilot client's IdP config is supplied, so it
 * has no effect on the existing local login (which remains the break-glass path).
 *
 * Not yet exercised against a live IdP — the provider-specific wiring
 * (registering the redirect URI, client credentials, claim quirks) is done when
 * the pilot's provider is known. See docs/sso.md.
 */
@Injectable()
export class OidcService {
  private discoveryCache: Discovery | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly tokens: TokensService,
    private readonly auth: AuthService,
  ) {}

  get enabled(): boolean {
    return this.cfg('SSO_ENABLED') === 'true' && !!this.cfg('OIDC_ISSUER') && !!this.cfg('OIDC_CLIENT_ID');
  }

  private cfg(key: string): string {
    return this.config.get<string>(key) ?? '';
  }

  private ensureEnabled(): void {
    if (!this.enabled) throw new ServiceUnavailableException('SSO is not configured on this instance');
  }

  private async discover(): Promise<Discovery> {
    if (this.discoveryCache) return this.discoveryCache;
    const issuer = this.cfg('OIDC_ISSUER').replace(/\/$/, '');
    const res = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!res.ok) throw new ServiceUnavailableException('Could not load identity provider configuration');
    const disc = (await res.json()) as Discovery;
    this.discoveryCache = disc;
    this.jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
    return disc;
  }

  /** The IdP authorization URL to redirect the browser to. */
  async authorizationUrl(): Promise<string> {
    this.ensureEnabled();
    const disc = await this.discover();
    const state = await this.tokens.signSsoState();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.cfg('OIDC_CLIENT_ID'),
      redirect_uri: this.cfg('OIDC_REDIRECT_URI'),
      scope: this.cfg('OIDC_SCOPES') || 'openid email profile',
      state,
    });
    return `${disc.authorization_endpoint}?${params.toString()}`;
  }

  /** Handle the IdP redirect: verify state, exchange the code, verify the id_token, log in. */
  async handleCallback(code: string, state: string, meta: { ipAddress?: string; userAgent?: string }) {
    this.ensureEnabled();
    if (!code || !state) throw new BadRequestException('Missing code or state');
    await this.tokens.verifySsoState(state).catch(() => {
      throw new UnauthorizedException('Invalid or expired SSO state');
    });

    const disc = await this.discover();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.cfg('OIDC_REDIRECT_URI'),
      client_id: this.cfg('OIDC_CLIENT_ID'),
      client_secret: this.cfg('OIDC_CLIENT_SECRET'),
    });
    const tokenRes = await fetch(disc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenRes.ok) throw new UnauthorizedException('Token exchange with the identity provider failed');
    const tokenSet = (await tokenRes.json()) as { id_token?: string };
    if (!tokenSet.id_token) throw new UnauthorizedException('No id_token returned by the identity provider');

    if (!this.jwks) await this.discover();
    const { payload } = await jwtVerify(tokenSet.id_token, this.jwks!, {
      issuer: disc.issuer,
      audience: this.cfg('OIDC_CLIENT_ID'),
    });

    const email = typeof payload.email === 'string' ? payload.email : undefined;
    if (!email) throw new UnauthorizedException('The identity provider did not return an email');
    if (payload.email_verified === false) throw new UnauthorizedException('Email not verified by the identity provider');

    return this.auth.ssoLogin(email, meta);
  }

  postLoginRedirect(): string {
    return this.cfg('OIDC_POST_LOGIN_REDIRECT') || 'http://localhost:5173';
  }
}
