import {
  Body, Controller, Delete, Get, Patch, Post, Res, StreamableFile,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OrganizationService, type UploadedFileLike } from './organization.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { UpdateNumberingDto } from './dto/update-numbering.dto';
import { UpdateLeaveApprovalDto } from './dto/update-leave-approval.dto';
import { UpdatePayrollSettingsDto } from './dto/update-payroll-settings.dto';
import { UpdateAttendanceSettingsDto } from './dto/update-attendance-settings.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { MAX_LOGO_BYTES } from '../storage/storage-path';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
export class OrganizationController {
  constructor(private readonly org: OrganizationService) {}

  /**
   * Branding for pre-login screens. Public by design: this instance serves a
   * single client, so its name/logo/colour are no more sensitive than the
   * company's own website. Nothing else about the org is exposed.
   */
  @Public() @Get('public-branding')
  publicBranding() {
    return this.org.publicBranding();
  }

  @Public() @Get('public-logo')
  async publicLogo(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const f = await this.org.publicLogo();
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': `inline; filename="${f.filename}"`,
      'Cache-Control': 'public, max-age=300',
    });
    return new StreamableFile(f.buffer);
  }

  @Get('branding') @Permissions('settings.manage')
  getBranding(@CurrentUser() user: AuthUser) {
    return this.org.getBranding(user.organizationId);
  }

  @Patch('branding') @Permissions('settings.manage')
  updateBranding(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.org.updateBranding(user.organizationId, dto);
  }

  @Get('leave-approval') @Permissions('settings.manage')
  getLeaveApproval(@CurrentUser() user: AuthUser) {
    return this.org.getLeaveApproval(user.organizationId);
  }

  @Patch('leave-approval') @Permissions('settings.manage')
  updateLeaveApproval(@CurrentUser() user: AuthUser, @Body() dto: UpdateLeaveApprovalDto) {
    return this.org.updateLeaveApproval(user.organizationId, dto);
  }

  @Get('employee-numbering') @Permissions('settings.manage')
  getNumbering(@CurrentUser() user: AuthUser) {
    return this.org.getNumbering(user.organizationId);
  }

  @Patch('employee-numbering') @Permissions('settings.manage')
  updateNumbering(@CurrentUser() user: AuthUser, @Body() dto: UpdateNumberingDto) {
    return this.org.updateNumbering(user.organizationId, dto);
  }

  @Get('payroll-settings') @Permissions('settings.manage')
  getPayrollSettings(@CurrentUser() user: AuthUser) {
    return this.org.getPayrollSettings(user.organizationId);
  }

  @Patch('payroll-settings') @Permissions('settings.manage')
  updatePayrollSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdatePayrollSettingsDto) {
    return this.org.updatePayrollSettings(user.organizationId, dto);
  }

  @Get('attendance-settings') @Permissions('settings.manage')
  getAttendanceSettings(@CurrentUser() user: AuthUser) {
    return this.org.getAttendanceSettings(user.organizationId);
  }

  @Patch('attendance-settings') @Permissions('settings.manage')
  updateAttendanceSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdateAttendanceSettingsDto) {
    return this.org.updateAttendanceSettings(user.organizationId, dto);
  }

  @Post('logo') @Permissions('settings.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }))
  uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike) {
    return this.org.uploadLogo(user.organizationId, file);
  }

  @Delete('logo') @Permissions('settings.manage')
  deleteLogo(@CurrentUser() user: AuthUser) {
    return this.org.deleteLogo(user.organizationId);
  }

  @Get('logo') @Permissions('settings.manage')
  async downloadLogo(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.org.getLogo(user.organizationId);
    res.set({
      'Content-Type': f.contentType,
      'Content-Disposition': `inline; filename="${f.filename}"`,
    });
    return new StreamableFile(f.buffer);
  }
}
