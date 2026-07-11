import { IsIn, IsOptional } from 'class-validator';

export class ListDsrDto {
  @IsOptional() @IsIn(['RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED'])
  status?: string;
}
