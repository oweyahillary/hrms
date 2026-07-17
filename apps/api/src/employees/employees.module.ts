import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeeDocumentsController } from './employee-documents.controller';
import { EmployeeDocumentsService } from './employee-documents.service';
import { AuthModule } from '../auth/auth.module';

// PrismaModule, CryptoModule, and StorageModule are @Global. AuthModule is
// imported explicitly for PasswordService (login provisioning).
@Module({
  imports: [AuthModule],
  controllers: [EmployeesController, EmployeeDocumentsController],
  providers: [EmployeesService, EmployeeDocumentsService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
