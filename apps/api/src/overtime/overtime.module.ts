import { Module } from '@nestjs/common';
import { OvertimeController } from './overtime.controller';
import { OvertimePolicyController } from './overtime-policy.controller';
import { OvertimeService } from './overtime.service';
import { OvertimePolicyService } from './overtime-policy.service';

@Module({
  controllers: [OvertimeController, OvertimePolicyController],
  providers: [OvertimeService, OvertimePolicyService],
  exports: [OvertimeService, OvertimePolicyService],
})
export class OvertimeModule {}
