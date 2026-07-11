import { Module } from '@nestjs/common';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';
import { RetentionService } from './retention.service';
import { RetentionController } from './retention.controller';
import { DsrService } from './dsr.service';
import { DsrController } from './dsr.controller';
import { BreachService } from './breach.service';
import { BreachController } from './breach.controller';

@Module({
  controllers: [ConsentController, RetentionController, DsrController, BreachController],
  providers: [ConsentService, RetentionService, DsrService, BreachService],
  exports: [ConsentService, RetentionService, DsrService, BreachService],
})
export class ComplianceModule {}
