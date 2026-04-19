import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { BlockSemantic, BlockStatus, HousekeepingRole, JwtPayload } from '@zenix/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { RolesGuard } from '../common/guards/roles.guard'
import { BlocksService } from './blocks.service'
import { CreateBlockDto } from './dto/create-block.dto'
import {
  ApproveBlockDto,
  CancelBlockDto,
  ExtendBlockDto,
  RejectBlockDto,
} from './dto/approve-block.dto'

@Controller('blocks')
@UseGuards(RolesGuard)
export class BlocksController {
  constructor(private readonly service: BlocksService) {}

  /**
   * POST /blocks
   * Crear solicitud de bloqueo.
   * RECEPTIONIST puede crear OOS (auto-aprobado si es SUPERVISOR).
   * Solo SUPERVISOR puede crear OOI.
   */
  @Post()
  @Roles(HousekeepingRole.RECEPTIONIST, HousekeepingRole.SUPERVISOR)
  create(@Body() dto: CreateBlockDto, @CurrentUser() actor: JwtPayload) {
    return this.service.createBlock(dto, actor)
  }

  /**
   * GET /blocks?status=PENDING_APPROVAL&semantic=OUT_OF_ORDER
   * Listar bloqueos de la propiedad con filtros opcionales.
   */
  @Get()
  @Roles(HousekeepingRole.RECEPTIONIST, HousekeepingRole.SUPERVISOR)
  findAll(
    @CurrentUser() actor: JwtPayload,
    @Query('status') status?: BlockStatus,
    @Query('semantic') semantic?: BlockSemantic,
    @Query('bedId') bedId?: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.service.findAll(actor, { status, semantic, bedId, roomId })
  }

  /**
   * GET /blocks/:id
   * Detalle de un bloqueo con historial completo.
   */
  @Get(':id')
  @Roles(HousekeepingRole.RECEPTIONIST, HousekeepingRole.SUPERVISOR)
  findOne(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.service.findOne(id, actor)
  }

  /**
   * POST /blocks/:id/approve
   * Supervisor aprueba un bloqueo PENDING_APPROVAL.
   * Si startDate ≤ hoy, el bloqueo se activa inmediatamente y se
   * crea una CleaningTask(MAINTENANCE, UNASSIGNED).
   */
  @Post(':id/approve')
  @Roles(HousekeepingRole.SUPERVISOR)
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveBlockDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.approveBlock(id, dto, actor)
  }

  /**
   * POST /blocks/:id/reject
   * Supervisor rechaza un bloqueo con nota obligatoria.
   * Se notifica al solicitante por push.
   */
  @Post(':id/reject')
  @Roles(HousekeepingRole.SUPERVISOR)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectBlockDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.rejectBlock(id, dto, actor)
  }

  /**
   * POST /blocks/:id/cancel
   * Cancelar un bloqueo ACTIVE o PENDING_APPROVAL.
   * Requiere reason. No cancela tareas IN_PROGRESS o DONE.
   */
  @Post(':id/cancel')
  @Roles(HousekeepingRole.SUPERVISOR)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelBlockDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.cancelBlock(id, dto, actor)
  }

  /**
   * POST /blocks/:id/extend
   * Extender la fecha de expiración de un bloqueo ACTIVE o APPROVED.
   * La nueva fecha debe ser posterior a la actual.
   */
  @Post(':id/extend')
  @Roles(HousekeepingRole.SUPERVISOR)
  extend(
    @Param('id') id: string,
    @Body() dto: ExtendBlockDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.extendBlock(id, dto, actor)
  }

  /**
   * POST /blocks/:id/release
   * Liberar anticipadamente un bloqueo ACTIVE.
   * Cancela la tarea de mantenimiento si aún no inició, restaura cama a AVAILABLE.
   */
  @Post(':id/release')
  @Roles(HousekeepingRole.SUPERVISOR)
  release(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.service.earlyRelease(id, actor)
  }
}
