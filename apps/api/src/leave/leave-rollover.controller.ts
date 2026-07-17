import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveRolloverService } from './leave-rollover.service';
import { RunRolloverDto } from './dto/run-rollover.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { HR_MANAGEMENT_ROLES } from '../auth/roles.constants';

const MANAGE = [...HR_MANAGEMENT_ROLES] as string[];

@ApiTags('leave-rollover')
@ApiBearerAuth()
@Controller('leave/rollover')
export class LeaveRolloverController {
  constructor(private readonly rollover: LeaveRolloverService) {}

  /**
   * Idempotently carry unused leave from a closed year into the next one.
   * Defaults to last year, which is what you want running it in January.
   */
  @Post('run') @Roles(...MANAGE)
  run(@Body() dto: RunRolloverDto) {
    const fromYear = dto.fromYear ?? new Date().getUTCFullYear() - 1;
    return this.rollover.runRollover(fromYear);
  }
}
