import { Module } from '@nestjs/common';
import { ShiftDefinitionsController } from './shift-definitions.controller';
import { ShiftDefinitionsService } from './shift-definitions.service';
import { ShiftRosterController } from './shift-roster.controller';
import { ShiftRosterService } from './shift-roster.service';

@Module({
  controllers: [ShiftDefinitionsController, ShiftRosterController],
  providers: [ShiftDefinitionsService, ShiftRosterService],
  exports: [ShiftDefinitionsService, ShiftRosterService],
})
export class ShiftsModule {}
