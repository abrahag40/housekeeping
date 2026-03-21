import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import configuration from './config/configuration'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { PropertiesModule } from './properties/properties.module'
import { RoomsModule } from './rooms/rooms.module'
import { BedsModule } from './beds/beds.module'
import { StaffModule } from './staff/staff.module'
import { TasksModule } from './tasks/tasks.module'
import { CheckoutsModule } from './checkouts/checkouts.module'
import { NotesModule } from './notes/notes.module'
import { MaintenanceModule } from './maintenance/maintenance.module'
import { NotificationsModule } from './notifications/notifications.module'
import { CloudbedsModule } from './integrations/cloudbeds/cloudbeds.module'
import { SettingsModule } from './settings/settings.module'
import { DiscrepanciesModule } from './discrepancies/discrepancies.module'
import { ReportsModule } from './reports/reports.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuthModule,
    PropertiesModule,
    RoomsModule,
    BedsModule,
    StaffModule,
    TasksModule,
    CheckoutsModule,
    NotesModule,
    MaintenanceModule,
    NotificationsModule,
    CloudbedsModule,
    SettingsModule,
    DiscrepanciesModule,
    ReportsModule,
  ],
})
export class AppModule {}
