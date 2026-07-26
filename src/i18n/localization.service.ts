import { Injectable } from '@nestjs/common';
import { englishMessages, type MessageKey } from './messages/en.js';

export type SupportedLocale = 'en';

@Injectable()
export class LocalizationService {
  resolveLocale(_requestedLocale: unknown): SupportedLocale {
    return 'en';
  }

  translate(
    key: MessageKey | string,
    _locale: SupportedLocale = 'en',
    variables: Record<string, string | number> = {},
  ): string {
    let message: string = englishMessages[key as MessageKey] ?? key;
    for (const [variable, value] of Object.entries(variables)) {
      message = message.replaceAll(`{${variable}}`, String(value));
    }
    return message;
  }
}
