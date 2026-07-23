import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SelfServiceService } from './self-service.service';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';

/**
 * Deliberately NOT @Roles-gated: any authenticated, password-changed user may
 * call every route here (see PasswordChangeGuard — unlike @Public, that guard
 * still applies normally, so a temp-password login can't reach these either).
 * Isolation comes from SelfServiceService always resolving "which employee"
 * from the caller's OWN userId, never from client input.
 */
@ApiTags('self-service')
@ApiBearerAuth()
@Controller('me')
export class SelfServiceController {
  constructor(private readonly selfService: SelfServiceService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.selfService.getProfile(user.userId);
  }

  @Get('payslips')
  payslips(@CurrentUser() user: AuthUser) {
    return this.selfService.listPayslips(user.userId);
  }

  @Get('payslips/:id/pdf')
  async payslipPdf(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const { buffer, filename } = await this.selfService.getPayslipPdf(user.userId, id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get('leave')
  leave(@CurrentUser() user: AuthUser) {
    return this.selfService.getLeave(user.userId, user);
  }

  @Get('shifts')
  shifts(@CurrentUser() user: AuthUser, @Query('from') from: string, @Query('to') to: string) {
    return this.selfService.getShifts(user.userId, from, to);
  }

  @Get('documents')
  documents(@CurrentUser() user: AuthUser) {
    return this.selfService.listDocuments(user.userId);
  }

  @Get('documents/:docId/download')
  async documentDownload(
    @Param('docId') docId: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.selfService.getDocumentDownload(user.userId, docId, user);
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': `attachment; filename="${f.filename}"`,
    });
    return new StreamableFile(f.buffer);
  }

  @Get('attendance')
  attendance(@CurrentUser() user: AuthUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.selfService.getAttendance(user.userId, from, to);
  }
}
