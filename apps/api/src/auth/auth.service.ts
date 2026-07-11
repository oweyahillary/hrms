import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

  private async issueSession(
    user: { id: string; email: string; organizationId: string; role: { name: string } },
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
    });
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role.name, organizationId: user.organizationId },
    };
  }
}
