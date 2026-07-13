import { Inject, Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';

interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: ExtendedPrismaClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokensService,
  ) {}

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
    return this.issueSession(user, meta);
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
