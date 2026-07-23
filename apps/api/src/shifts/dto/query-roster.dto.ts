import { IsOptional, IsUUID, Matches } from 'class-validator';

export class QueryRosterDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to!: string;

  @IsOptional() @IsUUID()
  departmentId?: string;
}
