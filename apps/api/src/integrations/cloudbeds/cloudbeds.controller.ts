import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common'
import { Request } from 'express'
import { Public } from '../../common/decorators/public.decorator'
import { CloudbedsService } from './cloudbeds.service'

@Controller('webhooks/cloudbeds')
export class CloudbedsController {
  private readonly logger = new Logger(CloudbedsController.name)

  constructor(private service: CloudbedsService) {}

  @Public()
  @Post()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-cloudbeds-signature') signature: string,
    @Headers('x-cloudbeds-property-id') cloudbedsPropertyId: string,
  ) {
    const rawBody = req.rawBody
    if (!rawBody) throw new BadRequestException('Missing raw body')

    // Verify HMAC signature
    this.service.verifySignature(rawBody, signature)

    const body = JSON.parse(rawBody.toString())
    const eventType: string = body.event ?? body.type ?? ''

    this.logger.log(`CloudBeds webhook: ${eventType}`)

    // Resolve internal propertyId from CloudBeds propertyID header
    const propertyId = await this.service.resolvePropertyId(cloudbedsPropertyId)
    if (!propertyId) {
      this.logger.warn(`No property mapped for CloudBeds propertyID: ${cloudbedsPropertyId}`)
      return { received: true, ignored: true }
    }

    // Route to correct handler
    if (eventType === 'reservation/checkedOut' || eventType === 'reservation.checkedOut') {
      return this.service.handleCheckout(body, propertyId)
    }

    // Unknown event — acknowledge to prevent CloudBeds retries
    return { received: true, ignored: true }
  }
}
