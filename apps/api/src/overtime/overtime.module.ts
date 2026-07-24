import { Module } from '@nestjs/common';
import { OvertimeController } from './overtime.controller';
import { OvertimePolicyController } from './overtime-policy.controller';
import { OvertimeService } from './overtime.service';
import { OvertimePolicyService } from './overtime-policy.service';
import { AuthModule } from '../auth/auth.module';

// AuthModule is imported explicitly for DepartmentScopeService (OWN_DEPARTMENT scoping).
@Module({
  imports: [AuthModule],
  controllers: [OvertimeController, OvertimePolicyController],
  providers: [OvertimeService, OvertimePolicyService],
  exports: [OvertimeService, OvertimePolicyService],
})
export class OvertimeModule {}
