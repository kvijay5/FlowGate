export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<EmailDeliveryResult>;
}

export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';
