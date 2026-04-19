import { ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory, Reflector } from '@nestjs/core'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from './common/filters/http-exception.filter'
import { JwtAuthGuard } from './common/guards/jwt-auth.guard'
import { RolesGuard } from './common/guards/roles.guard'
import { PropertyScopeInterceptor } from './common/interceptors/property-scope.interceptor'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true })

  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',') ?? []
      : true,
    credentials: true,
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  const reflector = app.get(Reflector)
  app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector))
  app.useGlobalInterceptors(new PropertyScopeInterceptor())
  app.useGlobalFilters(new HttpExceptionFilter())

  app.setGlobalPrefix('api')

  const configService = app.get(ConfigService)
  const port = configService.get<number>('port') ?? 3000

  await app.listen(port)
  console.log(`🚀 API running on http://localhost:${port}/api`)
}

bootstrap()
