import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class TransitionDsrDto {
  @IsIn(['IN_PROGRESS', 'COMPLETED', 'REJECTED'])
  status!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
