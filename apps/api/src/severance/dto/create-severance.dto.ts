import { IsDateString, IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class CreateSeveranceDto {
  /** Employment Act §40: only REDUNDANCY attracts statutory severance. */
  @IsIn(['RESIGNATION', 'TERMINATION', 'REDUNDANCY', 'RETIREMENT'])
  reason!: string;

  @IsDateString()
  exitDate!: string;

  /** Drives the statutory notice minimum (§35). Not stored on the employee. */
  @IsIn(['DAILY', 'WEEKLY', 'BI_WEEKLY', 'MONTHLY'])
  payFrequency!: string;

  /**
   * Notice days the contract specifies, if any. Used only when it EXCEEDS the
   * statutory minimum — a shorter contractual figure never lowers the floor.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  contractualNoticeDays?: number;
}
