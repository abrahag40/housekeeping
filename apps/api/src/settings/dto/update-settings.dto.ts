import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'defaultCheckoutTime must be HH:mm' })
  defaultCheckoutTime?: string

  @IsOptional()
  @IsString()
  timezone?: string

  @IsOptional()
  @IsString()
  pmsMode?: string

  /**
   * Hora local (0-23) a partir de la cual el night audit marca no-shows automáticamente.
   * Default: 2 (02:00 AM). Permite configurar ventana de gracia para late arrivals.
   * IMPORTANTE: Siempre se evalúa en la timezone de la propiedad, nunca en UTC.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)  // Máximo 6 AM — cobrar después crea disputas
  noShowCutoffHour?: number
}
