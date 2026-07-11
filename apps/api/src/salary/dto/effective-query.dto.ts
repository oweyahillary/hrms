import { IsISO8601, IsOptional } from 'class-validator';

export class EffectiveQueryDto {
  @IsOptional() @IsISO8601()
  asOf?: string;
}
