/**
 * SettingsService — Configuración por propiedad.
 *
 * Gestiona los ajustes operativos de cada propiedad (hotel/hostel) dentro del sistema.
 * La configuración controla comportamientos clave como notificaciones, umbrales de tiempo,
 * integración con channel managers, etc. (según lo definido en el modelo PropertySettings del schema).
 *
 * Diseño de inicialización lazy (auto-create on first access):
 *  No se crean los registros de configuración al dar de alta una propiedad. En cambio,
 *  `findByProperty` los crea automáticamente con valores por defecto la primera vez que
 *  se accede. Esto simplifica el proceso de onboarding (no hay paso de "inicializar settings")
 *  y garantiza que siempre haya una configuración válida disponible.
 *
 *  Relación: Property 1 ─── 1 PropertySettings (unique constraint en propertyId)
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateSettingsDto } from './dto/update-settings.dto'

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * findByProperty — Obtiene la configuración de una propiedad, creándola si no existe.
   *
   * Patrón "find-or-create" (upsert sin upsert explícito):
   *  Se podría usar prisma.propertySettings.upsert(), pero el findUnique + create manual
   *  permite lanzar NotFoundException si la propiedad padre no existe, lo que sería
   *  imposible con upsert (que crearía el registro sin validar la FK).
   *
   * Condiciones:
   *  - Si PropertySettings existe → devolverlo directamente.
   *  - Si no existe → verificar que Property exista primero (FK safety), luego crear con defaults.
   *  - Si Property tampoco existe → NotFoundException.
   *
   * Esta función es usada también por `update` para garantizar que el registro
   * exista antes de intentar actualizarlo.
   *
   * @param propertyId  UUID de la propiedad
   * @returns           El registro PropertySettings existente o recién creado con defaults
   * @throws            NotFoundException si la propiedad no existe en la base de datos
   */
  async findByProperty(propertyId: string) {
    const include = { property: { select: { type: true } } } as const

    let settings = await this.prisma.propertySettings.findUnique({
      where: { propertyId },
      include,
    })
    if (!settings) {
      const property = await this.prisma.property.findUnique({ where: { id: propertyId } })
      if (!property) throw new NotFoundException('Property not found')
      settings = await this.prisma.propertySettings.create({
        data: { propertyId },
        include,
      })
    }

    // Flatten property.type → propertyType para que el frontend lo consuma directamente
    const { property, ...rest } = settings
    return { ...rest, propertyType: property.type }
  }

  /**
   * update — Actualiza la configuración de una propiedad.
   *
   * Llama a findByProperty primero para garantizar que el registro existe.
   * Esto tiene dos efectos deseables:
   *  1. Si la propiedad no tiene configuración aún, la crea con defaults antes de aplicar
   *     el update (evita que update falle con "Record to update not found").
   *  2. Si la propiedad no existe en absoluto, lanza NotFoundException antes de intentar
   *     la escritura, dando un error más descriptivo que la violación de FK de Prisma.
   *
   * El DTO `UpdateSettingsDto` usa decoradores de class-validator para definir qué campos
   * son actualizables y sus tipos/restricciones. Prisma aplicará solo los campos presentes
   * en `data: dto` (los undefined son ignorados automáticamente).
   *
   * @param propertyId  UUID de la propiedad a configurar
   * @param dto         Campos a actualizar (parcial — solo los campos enviados se modifican)
   * @returns           El registro PropertySettings actualizado
   * @throws            NotFoundException si la propiedad no existe
   */
  async update(propertyId: string, dto: UpdateSettingsDto) {
    await this.findByProperty(propertyId) // ensures it exists (creates with defaults if needed)
    return this.prisma.propertySettings.update({
      where: { propertyId },
      data: dto,
    })
  }
}
