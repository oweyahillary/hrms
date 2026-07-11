import { PartialType } from '@nestjs/swagger';
import { CreatePublicHolidayDto } from './create-public-holiday.dto';
export class UpdatePublicHolidayDto extends PartialType(CreatePublicHolidayDto) {}
