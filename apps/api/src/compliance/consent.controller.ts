import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { CreateConsentDto } from './dto/create-consent.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

@ApiTags('compliance-consent')
@ApiBearerAuth()
@Controller()
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post('employees/:employeeId/consents') @Roles(...HR_MANAGEMENT_ROLES)
  grant(@Param('employeeId') employeeId: string, @Body() dto: CreateConsentDto) {
    return this.consent.grant(employeeId, dto);
  }

  @Get('employees/:employeeId/consents') @Roles(...HR_MANAGEMENT_ROLES)
  list(@Param('employeeId') employeeId: string) { return this.consent.listForEmployee(employeeId); }

  @Get('consents/:id') @Roles(...HR_MANAGEMENT_ROLES)
  get(@Param('id') id: string) { return this.consent.get(id); }

  @Post('consents/:id/withdraw') @Roles(...HR_MANAGEMENT_ROLES)
  withdraw(@Param('id') id: string) { return this.consent.withdraw(id); }
}
