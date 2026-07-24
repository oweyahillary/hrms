import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeaveRolloverService } from './leave-rollover.service';
import { RunRolloverDto } from './dto/run-rollover.dto';
import { Permissions } from '../auth/decorators/permissions.decorator';

@ApiTags('leave-rollover')
@ApiBearerAuth()
@Controller('leave/rollover')
export class LeaveRolloverController {
  constructor(private readonly rollover: LeaveRolloverService) {}

  /**
   * Idempotently carry unused leave from a closed year into the next one.
   * Defaults to last year, which is what you want running it in January.
   */
  @Post('run') @Permissions('leave.manage')
  run(@Body() dto: RunRolloverDto) {
    const fromYear = dto.fromYear ?? new Date().getUTCFullYear() - 1;
    return this.rollover.runRollover(fromYear);
  }
}
