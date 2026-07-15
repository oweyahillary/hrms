import { Inject, Injectable, BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';
import { newTotpSecret, totpUri, totpValid, newBackupCodes, hashBackupCode } from './totp.util';

interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
  ) {}

  /** The caller's identity for the SPA — same shape as the login `user` object. */
  async currentUser(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: { role: true, organization: { select: { name: true } } },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      role: user.role.name,
      organizationId: user.organizationId,
      organizationName: user.organization?.name ?? '',
      mustChangePassword: user.mustChangePassword === true,
    };
  }

  /**
   * Log in a user matched from a verified SSO identity. The OIDC service has
   * already verified the id_token signature, issuer, audience and email; here
   * we map that email to a local account and issue our own session. Users must
   * be provisioned locally first (no auto-create) — SSO authenticates, it
   * doesn't grant access on its own.
   */
  async ssoLogin(email: string, meta: SessionMeta) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('No active account for this identity');
    return this.issueSession(user, meta);
  }

  async login(email: string, password: string, meta: SessionMeta) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      include: { role: true },
    });

    if (!user) {
      // Burn comparable work so a missing user isn't faster (enumeration timing).
      await this.passwords.hash(password);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!(await this.passwords.verify(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // MFA gate: a correct password alone is not a session when MFA is on.
    if (user.mfaEnabled) {
      return { mfaRequired: true, mfaToken: await this.tokens.signMfaChallenge(user.id) };
    }
    return this.issueSession(user, meta);
  }

  /** Finish an MFA-gated login with a TOTP code or a one-time backup code. */
  async completeMfaLogin(mfaToken: string, code: string, meta: SessionMeta) {
    let userId: string;
    try {
      userId = await this.tokens.verifyMfaChallenge(mfaToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: { role: true },
    });
    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('Invalid MFA state');
    }

    const secret = await this.crypto.decrypt(user.mfaSecret);
    if (totpValid(secret, code)) {
      return this.issueSession(user, meta);
    }
    if (await this.consumeBackupCode(user.id, user.mfaBackupCodes ?? [], code)) {
      return this.issueSession(user, meta);
    }
    throw new UnauthorizedException('Invalid authentication code');
  }

  /** If the code matches an unused backup hash, remove it (one-time) and return true. */
  private async consumeBackupCode(userId: string, storedHashes: string[], code: string): Promise<boolean> {
    const hash = hashBackupCode(code);
    if (!storedHashes.includes(hash)) return false;
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaBackupCodes: storedHashes.filter((h) => h !== hash) },
    });
    return true;
  }

  /** Begin MFA enrollment: mint a secret, store it encrypted (not yet enabled). */
  async setupMfa(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: { organization: { select: { name: true } } },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.mfaEnabled) throw new ConflictException('MFA is already enabled; disable it first to re-enroll');

    const secret = newTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: await this.crypto.encrypt(secret) },
    });
    const issuer = (user as unknown as { organization?: { name?: string } }).organization?.name ?? 'HRMS';
    return { secret, otpauthUri: totpUri(secret, user.email, issuer) };
  }

  /** Confirm enrollment with a TOTP code; enable MFA and issue backup codes (shown once). */
  async enableMfa(userId: string, token: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.mfaEnabled) throw new ConflictException('MFA is already enabled');
    if (!user.mfaSecret) throw new BadRequestException('Start enrollment with /auth/mfa/setup first');

    const secret = await this.crypto.decrypt(user.mfaSecret);
    if (!totpValid(secret, token)) throw new BadRequestException('Code did not verify; check your authenticator');

    const { plain, hashes } = newBackupCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaBackupCodes: hashes },
    });
    return { enabled: true, backupCodes: plain };
  }

  /** Turn MFA off; requires a current TOTP or backup code. */
  async disableMfa(userId: string, code: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) throw new BadRequestException('MFA is not enabled');

    const secret = await this.crypto.decrypt(user.mfaSecret);
    const ok = totpValid(secret, code)
      || (await this.consumeBackupCode(user.id, user.mfaBackupCodes ?? [], code));
    if (!ok) throw new UnauthorizedException('Invalid authentication code');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });
    return { enabled: false };
  }

  async refresh(refreshToken: string, meta: SessionMeta) {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: session.userId, isActive: true },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    // Rotate: revoke the used refresh token, issue a fresh session.
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issueSession(user, meta);
  }

  async logout(refreshToken: string) {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * Rotate the caller's password. Verifies the current password, enforces that
   * the new one differs, clears any must-change flag, then revokes ALL of the
   * user's existing sessions and issues a fresh one — so other devices holding
   * the old (still mcp=true) token are logged out and the caller is unblocked.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, meta: SessionMeta) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: { role: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await this.passwords.verify(newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must be different from the current password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    // Invalidate every existing session for this user (force re-auth elsewhere).
    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Issue a clean session so the caller continues without a default credential.
    return this.issueSession({ ...user, mustChangePassword: false }, meta);
  }

  /**
   * Admin action: require a user (in the caller's org) to change their password
   * on next login, and revoke their active sessions so it takes effect at once.
   * Idempotent; does not reveal whether the email exists beyond a generic result.
   */
  async forcePasswordReset(organizationId: string, email: string) {
    const user = await this.prisma.user.findFirst({
      where: { organizationId, email: email.toLowerCase() },
    });
    if (user) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: true },
      });
      await this.prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  private async issueSession(
    user: { id: string; email: string; organizationId: string; mustChangePassword?: boolean; role: { name: string } },
    meta: SessionMeta,
  ) {
    const { token: refreshToken, hash } = this.tokens.newRefreshToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hash,
        expiresAt: this.tokens.refreshExpiry(),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      org: user.organizationId,
      role: user.role.name,
      mcp: user.mustChangePassword === true ? true : undefined,
    });
    return {
      accessToken,
      refreshToken,
      mustChangePassword: user.mustChangePassword === true,
      user: { id: user.id, email: user.email, role: user.role.name, organizationId: user.organizationId },
    };
  }
}
