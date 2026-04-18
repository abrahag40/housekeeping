import { Module, Global } from '@nestjs/common'
import { MailerModule } from '@nestjs-modules/mailer'
import { ConfigService } from '@nestjs/config'
import { EmailService } from './email.service'

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        transport: {
          host:   config.get('SMTP_HOST', 'smtp.gmail.com'),
          port:   parseInt(config.get('SMTP_PORT', '587')),
          secure: false,
          auth: {
            user: config.get('SMTP_USER'),
            pass: config.get('SMTP_PASS'),
          },
        },
        defaults: {
          from: `"Hospitalidad OS" <${config.get('SMTP_FROM', 'noreply@hospitalidad.os')}>`,
        },
      }),
    }),
  ],
  providers:  [EmailService],
  exports:    [EmailService],
})
export class EmailModule {}
