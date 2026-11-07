import { Injectable, Logger } from '@nestjs/common';
import { EmailDeliveryResult, EmailProvider, SendEmailOptions } from './email-provider.interface';

@Injectable()
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);
  public sentEmails: SendEmailOptions[] = [];
  public simulateFailure = false;
  public failureErrorMessage = 'Simulated SMTP connection timeout';

  async sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult> {
    if (this.simulateFailure) {
      this.logger.warn(`[MOCK EMAIL FAILURE] Simulated delivery failure to ${options.to}`);
      return {
        success: false,
        error: this.failureErrorMessage,
      };
    }

    this.sentEmails.push(options);
    this.logger.log(
      `[MOCK EMAIL SENT] To: ${options.to} | Subject: "${options.subject}" | Body preview: "${options.text.substring(0, 50)}..."`,
    );

    return {
      success: true,
      messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    };
  }

  clear() {
    this.sentEmails = [];
    this.simulateFailure = false;
  }
}
