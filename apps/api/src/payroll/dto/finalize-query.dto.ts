import { IsIn, IsOptional } from 'class-validator';

export class FinalizeQueryDto {
  @IsOptional() @IsIn(['true', 'false'])
  override?: string;
}
