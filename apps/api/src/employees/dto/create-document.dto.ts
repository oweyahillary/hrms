import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class CreateDocumentDto {
  @IsIn(['ID_COPY', 'CONTRACT', 'CERTIFICATE', 'OTHER'])
  documentType!: string;

  // Multipart text fields arrive as strings; coerce 'true'/'false' -> boolean.
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isSensitive?: boolean;
}
