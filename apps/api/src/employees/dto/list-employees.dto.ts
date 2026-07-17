import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Sortable columns. Whitelisted deliberately — `sort` reaches Prisma's orderBy,
 * so an open string would let a caller order by any column (including the
 * ciphertext ones, which is meaningless but shouldn't be reachable).
 */
export const EMPLOYEE_SORT_FIELDS = ['name', 'employeeNumber', 'hireDate', 'createdAt'] as const;
export type EmployeeSortField = (typeof EMPLOYEE_SORT_FIELDS)[number];

export class ListEmployeesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize: number = 25;

  @IsOptional() @IsIn(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'EXITED'])
  status?: string;

  @IsOptional() @IsString()
  departmentId?: string;

  /**
   * Free-text search across firstName, lastName and employeeNumber
   * (case-insensitive substring). Encrypted columns are NOT searchable here —
   * national ID has its own blind-index route (`GET /employees/lookup`).
   * Trimmed; an all-whitespace value collapses to undefined so `?q=` means
   * "no filter" rather than matching every row.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  // Default preserves the previous hardcoded ordering (createdAt desc) so the
  // endpoint's behaviour is unchanged for callers that don't opt in.
  @IsOptional() @IsIn(EMPLOYEE_SORT_FIELDS)
  sort: EmployeeSortField = 'createdAt';

  @IsOptional() @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}
