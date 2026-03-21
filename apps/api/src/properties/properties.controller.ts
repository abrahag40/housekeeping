import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { Roles } from '../common/decorators/roles.decorator'
import { HousekeepingRole } from '@housekeeping/shared'
import { PropertiesService } from './properties.service'
import { CreatePropertyDto } from './dto/create-property.dto'

@Controller('properties')
export class PropertiesController {
  constructor(private service: PropertiesService) {}

  @Post()
  @Roles(HousekeepingRole.SUPERVISOR)
  create(@Body() dto: CreatePropertyDto) {
    return this.service.create(dto)
  }

  @Get()
  findAll() {
    return this.service.findAll()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Patch(':id')
  @Roles(HousekeepingRole.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: Partial<CreatePropertyDto>) {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  @Roles(HousekeepingRole.SUPERVISOR)
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
