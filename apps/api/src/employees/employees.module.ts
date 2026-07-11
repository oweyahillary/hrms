import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeDocumentsController } from './employee-documents.controller';
import { EmployeeDocumentsService } from './employee-documents.service';

// PrismaModule, CryptoModule, and StorageModule are @Global.
@Module({
  controllers: [EmployeesController, EmployeeDocumentsController],
  providers: [EmployeesService, EmployeeDocumentsService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
