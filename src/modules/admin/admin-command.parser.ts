import { AdminCommandError } from './admin-command.types.js';

const COMMAND_PATTERN = /^\/([a-z][a-z0-9-]*)(?:\s+(.*))?$/iu;

export interface ParsedAdminCommand { name: string; rawArguments: string; }

export function parseAdminCommand(text: string): ParsedAdminCommand {
  const match = COMMAND_PATTERN.exec(text.trim());
  if (!match) throw new AdminCommandError('ADMIN_COMMAND_INVALID', 'Nieprawidłowa składnia komendy.');
  return { name: match[1]!.toLowerCase(), rawArguments: match[2]?.trim() ?? '' };
}
