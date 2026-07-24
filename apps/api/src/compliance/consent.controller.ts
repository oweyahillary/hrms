import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { CreateConsentDto } from './dto/create-consent.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('compliance-consent')
@ApiBearerAuth()
@Controller()
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post('employees/:employeeId/consents') @Permissions('compliance.manage')
  grant(@Param('employeeId') employeeId: string, @Body() dto: CreateConsentDto) {
    return this.consent.grant(employeeId, dto);
  }

  @Get('employees/:employeeId/consents') @Permissions('compliance.manage')
  list(@Param('employeeId') employeeId: string) { return this.consent.listForEmployee(employeeId); }

  @Get('consents/:id') @Permissions('compliance.manage')
  get(@Param('id') id: string) { return this.consent.get(id); }

  @Post('consents/:id/withdraw') @Permissions('compliance.manage')
  withdraw(@Param('id') id: string) { return this.consent.withdraw(id); }
}
