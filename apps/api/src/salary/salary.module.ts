import { Module } from '@nestjs/common';
import { SalaryStructuresService } from './salary-structures.service';
import { EmployeeSalaryStructuresController, SalaryStructuresController } from './salary-structures.controller';

@Module({
  controllers: [EmployeeSalaryStructuresController, SalaryStructuresController],
  providers: [SalaryStructuresService],
  exports: [SalaryStructuresService],
})
export class SalaryModule {}
