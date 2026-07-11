import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { Public } from './decorators/public.decorator';
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

  /** Requires a valid access token (global guard). Returns the caller's identity. */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
