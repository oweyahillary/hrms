import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDsrDto {
  @IsIn(['ACCESS', 'CORRECTION', 'ERASURE'])
  requestType!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}
