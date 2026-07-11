import { PartialType } from '@nestjs/swagger';
import { CreateEmployeeDto } from './create-employee.dto';

/** All create fields optional; PII fields are re-encrypted when supplied. */
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
