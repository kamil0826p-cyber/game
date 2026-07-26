import { Injectable } from '@nestjs/common';
import { englishMessages, type MessageKey } from './messages/en.js';
import { polishMessages } from './messages/pl.js';

export const SUPPORTED_LOCALES = ['en', 'pl'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const messages = {
  en: englishMessages,
  pl: polishMessages,
} satisfies Record<SupportedLocale, Record<MessageKey, string>>;

@Injectable()
export class LocalizationService {
  resolveLocale(requestedLocale: unknown): SupportedLocale {
    if (typeof requestedLocale !== 'string') return 'en';
    const language = requestedLocale.toLowerCase().split('-')[0];
    return SUPPORTED_LOCALES.includes(language as SupportedLocale)
      ? (language as SupportedLocale)
      : 'en';
  }

  translate(
    key: MessageKey | string,
    locale: SupportedLocale = 'en',
    variables: Record<string, string | number> = {},
  ): string {
    let message: string = messages[locale][key as MessageKey] ?? englishMessages[key as MessageKey] ?? key;
    for (const [variable, value] of Object.entries(variables)) {
      message = message.replaceAll(`{${variable}}`, String(value));
    }
    return message;
  }
}
