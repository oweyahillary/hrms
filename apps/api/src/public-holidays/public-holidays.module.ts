import { Module } from '@nestjs/common';
import { PublicHolidaysController } from './public-holidays.controller';
import { PublicHolidaysService } from './public-holidays.service';

@Module({
  controllers: [PublicHolidaysController],
  providers: [PublicHolidaysService],
  exports: [PublicHolidaysService],
})
export class PublicHolidaysModule {}
