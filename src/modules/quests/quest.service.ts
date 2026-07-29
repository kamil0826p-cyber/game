import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';
import { applyExperience, statGrowthForLevels } from '../mobs/character-progression.js';
import { skillPoints