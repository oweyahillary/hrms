import {
  Body, Controller, Delete, Get, Patch, Post, Res, StreamableFile,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { OrganizationService, type UploadedFileLike } from './organization.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type AuthUser } from '../auth/decorators/current-user.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';
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

  @Get('branding') @Roles(...HR_MANAGEMENT_ROLES)
  getBranding(@CurrentUser() user: AuthUser) {
    return this.org.getBranding(user.organizationId);
  }

  @Patch('branding') @Roles(...HR_MANAGEMENT_ROLES)
  updateBranding(@CurrentUser() user: AuthUser, @Body() dto: UpdateBrandingDto) {
    return this.org.updateBranding(user.organizationId, dto);
  }

  @Post('logo') @Roles(...HR_MANAGEMENT_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }))
  uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike) {
    return this.org.uploadLogo(user.organizationId, file);
  }

  @Delete('logo') @Roles(...HR_MANAGEMENT_ROLES)
  deleteLogo(@CurrentUser() user: AuthUser) {
    return this.org.deleteLogo(user.organizationId);
  }

  @Get('logo') @Roles(...HR_MANAGEMENT_ROLES)
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
