import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenPayload } from './tokens.service';
import type { AuthUser } from './decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') as string,
    });
  }

  /** Return value becomes request.user. */
  validate(payload: AccessTokenPayload): AuthUser {
    return {
      userId: payload.sub,
      organizationId: payload.org,
      role: payload.role,
      mustChangePassword: payload.mcp === true,
    };
  }
}
