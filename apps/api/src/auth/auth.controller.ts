import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForceResetDto } from './dto/force-reset.dto';
import { MfaEnableDto, MfaVerifyDto, MfaDisableDto } from './dto/mfa.dto';
import { Public } from './decorators/public.decorator';
import { BypassPasswordChange } from './decorators/bypass-password-change.decorator';
import { Permissions } from './decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from './decorators/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  /** Rotate the caller's password. Reachable even while a change is required. */
  @Post('change-password')
  @BypassPasswordChange()
  @HttpCode(200)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.changePassword(user.userId, dto.currentPassword, dto.newPassword, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /** Admin: force a user in the caller's org to change password on next login. */
  @Post('force-reset')
  @Permissions('users.manage')
  @HttpCode(200)
  forceReset(@Body() dto: ForceResetDto, @CurrentUser() user: AuthUser) {
    return this.auth.forcePasswordReset(user.organizationId, dto.email);
  }

  /** Requires a valid access token (global guard). Returns the caller's identity. */
  @Get('me')
  @BypassPasswordChange()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.currentUser(user.userId);
  }

  // ---- MFA (TOTP) ----

  /** Begin enrollment: returns a secret + otpauth URI to load into an authenticator. */
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.setupMfa(user.userId);
  }

  /** Confirm enrollment with a code from the authenticator; returns backup codes once. */
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@Body() dto: MfaEnableDto, @CurrentUser() user: AuthUser) {
    return this.auth.enableMfa(user.userId, dto.token);
  }

  /** Turn MFA off (requires a current TOTP or backup code). */
  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@Body() dto: MfaDisableDto, @CurrentUser() user: AuthUser) {
    return this.auth.disableMfa(user.userId, dto.code);
  }

  /** Finish an MFA-gated login: exchange the challenge token + code for a session. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  mfaVerify(@Body() dto: MfaVerifyDto, @Req() req: Request) {
    return this.auth.completeMfaLogin(dto.mfaToken, dto.code, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
