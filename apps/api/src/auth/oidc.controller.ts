import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { OidcService } from './oidc.service';
import { Public } from './decorators/public.decorator';

/** OIDC login endpoints (public — no session exists yet). */
@ApiTags('auth-sso')
@Controller('auth/sso')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  /** Whether SSO is configured — lets the SPA show/hide the SSO button. */
  @Public() @Get('config')
  config(): { enabled: boolean } {
    return { enabled: this.oidc.enabled };
  }

  /** Begin SSO: redirect the browser to the identity provider. */
  @Public() @Get('login')
  async login(@Res() res: Response): Promise<void> {
    res.redirect(await this.oidc.authorizationUrl());
  }

  /** IdP redirect target: complete login and hand the session to the SPA. */
  @Public() @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const session = await this.oidc.handleCallback(code, state, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    // GROUNDWORK handoff: pass tokens to the SPA via URL fragment. Production
    // hardening should set an httpOnly refresh cookie instead (see docs/sso.md).
    const frag = new URLSearchParams({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
    res.redirect(`${this.oidc.postLoginRedirect()}/sso/callback#${frag.toString()}`);
  }
}
