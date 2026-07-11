import { IsIn, IsOptional } from 'class-validator';

export class ListBreachDto {
  @IsOptional() @IsIn(['OPEN', 'CONTAINED', 'CLOSED'])
  status?: string;
}
