import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConsentService } from './consent.service';
import { CreateConsentDto } from './dto/create-consent.dto';
import { AnyPermission, Permissions } from '../auth/decorators/permissions.decorator';

const VIEW = ['compliance.view', 'compliance.manage'];

@ApiTags('compliance-consent')
@ApiBearerAuth()
@Controller()
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post('employees/:employeeId/consents') @Permissions('compliance.manage')
  grant(@Param('employeeId') employeeId: string, @Body() dto: CreateConsentDto) {
    return this.consent.grant(employeeId, dto);
  }

  @Get('employees/:employeeId/consents') @AnyPermission(...VIEW)
  list(@Param('employeeId') employeeId: string) { return this.consent.listForEmployee(employeeId); }

  @Get('consents/:id') @AnyPermission(...VIEW)
  get(@Param('id') id: string) { return this.consent.get(id); }

  @Post('consents/:id/withdraw') @Permissions('compliance.manage')
  withdraw(@Param('id') id: string) { return this.consent.withdraw(id); }
}
