import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { EmployeeLoansController, LoansController } from './loans.controller';

@Module({
  controllers: [EmployeeLoansController, LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
