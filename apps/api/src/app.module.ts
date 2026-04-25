import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { ScheduleModule } from '@nestjs/schedule'
import { ClsModule, ClsMiddleware } from 'nestjs-cls'
import configuration from './config/configuration'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { PropertiesModule } from './properties/properties.module'
import { RoomsModule } from './rooms/rooms.module'
import { UnitsModule } from './units/units.module'
import { StaffModule } from './staff/staff.module'
import { TasksModule } from './tasks/tasks.module'
import { CheckoutsModule } from './checkouts/checkouts.module'
import { NotesModule } from './notes/notes.module'
import { MaintenanceModule } from './maintenance/maintenance.module'
import { NotificationsModule } from './notifications/notifications.module'
import { ChannexModule } from './integrations/channex/channex.module'
import { AvailabilityModule } from './pms/availability/availability.module'
import { SettingsModule } from './settings/settings.module'
import { DiscrepanciesModule } from './discrepancies/discrepancies.module'
import { ReportsModule } from './reports/reports.module'
// EmailModule fue stubbed temporalmente (sin @nestjs-modules/mailer). Sigue
// activo y expone EmailService con envío no-op hasta que se configure SMTP.
import { EmailModule } from './common/email/email.module'
import { GuestStaysModule } from './pms/guest-stays/guest-stays.module'
import { RoomReadinessModule } from './pms/room-readiness/room-readiness.module'
import { RoomTypesModule } from './pms/room-types/room-types.module'
import { StayJourneysModule } from './pms/stay-journeys/stay-journeys.module'
import { DashboardModule } from './dashboard/dashboard.module'
import { BlocksModule } from './blocks/blocks.module'
import { PaymentsModule } from './payments/payments.module'
import { SoftLockModule } from './soft-lock/soft-lock.module'
import { NotificationCenterModule } from './notification-center/notification-center.module'
import { TenantContextMiddleware } from './common/tenant-context.middleware'
import { TenantContextService } from './common/tenant-context.service'
import { TenantGuard } from './common/guards/tenant.guard'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ClsModule.forRoot({
      global: true,
      middleware: { mount: false },
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    PropertiesModule,
    RoomsModule,
    UnitsModule,
    StaffModule,
    TasksModule,
    CheckoutsModule,
    NotesModule,
    MaintenanceModule,
    NotificationsModule,
    ChannexModule,
    AvailabilityModule,
    SettingsModule,
    DiscrepanciesModule,
    ReportsModule,
    EmailModule,            // stubbed — ver comentario arriba
    GuestStaysModule,
    RoomReadinessModule,
    RoomTypesModule,
    StayJourneysModule,
    DashboardModule,
    BlocksModule,
    PaymentsModule,
    SoftLockModule,
    NotificationCenterModule,
  ],
  providers: [
    TenantContextService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ClsMiddleware, TenantContextMiddleware).forRoutes('*')
  }
}
