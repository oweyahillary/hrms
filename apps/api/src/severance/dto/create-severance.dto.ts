import { IsDateString, IsIn, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';

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

  /**
   * Contract classification for PAYE spreading of the severance lump sum (KRA
   * three-bucket rule). Specific to THIS exit, not a permanent employee field.
   */
  @IsIn(['FIXED_TERM', 'UNSPECIFIED_WITH_CLAUSE', 'NO_PROVISION'])
  contractTermType!: string;

  /**
   * The unexpired months of a fixed-term contract — the lump sum is spread over
   * this many months. Required and positive when contractTermType is
   * FIXED_TERM; ignored (and not validated) otherwise.
   */
  @ValidateIf((o) => o.contractTermType === 'FIXED_TERM')
  @IsInt()
  @Min(1)
  unexpiredTermMonths?: number;
}
