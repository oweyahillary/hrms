import { IsUUID, Matches } from 'class-validator';

export class UpsertRosterDto {
  @IsUUID()
  employeeId!: string;

  /** The date the shift STARTS — see the crossesMidnight note on ShiftAssignment. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsUUID()
  shiftDefinitionId!: string;
}
