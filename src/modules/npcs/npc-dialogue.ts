import { z } from 'zod';
import type { SupportedLocale } from '../../i18n/localization.service.js';

const dialogueIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const localizedTextSchema = z.union([
  z.string().trim().min(1).max(2_000),
  z
    .object({
      en: z.string().trim().min(1).max(2_000),
      pl: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

const dialogueChoiceSchema = z
  .object({
    id: dialogueIdentifierSchema,
    label: localizedTextSchema,
    nextNodeId: dialogueIdentifierSchema.optional(),
    action: z.enum(['OPEN_MERCHANT', 'CLOSE']).optional(),
  })
  .strict()
  .superRefine((choice, context) => {
    if (Boolean(choice.nextNodeId) === Boolean(choice.action)) {
      context.addIssue({
        code: 'custom',
        message: 'A dialogue choice must define exactly one next node or action.',
      });
    }
  });

const dialogueNodeSchema = z
  .object({
    text: localizedTextSchema,
    choices: z.array(dialogueChoiceSchema).max(12).default([]),
  })
  .strict();

const merchantConfigurationSchema = z
  .object({
    itemKeys: z.array(z.string().trim().min(1).max(96)).min(1).max(100),
    infiniteStock: z.boolean().default(true),
  })
  .strict();

const legacyMerchantDialogueSchema = z
  .object({
    type: z.literal('MERCHANT'),
    merchant: merchantConfigurationSchema
      .extend({
        interactionRadius: z.number().int().min(0).max(8).default(1),
      })
      .strict(),
  })
  .strict();

export const npcDialogueDefinitionSchema = z
  .object({
    type: z.enum(['DIALOGUE', 'MERCHANT', 'QUEST']).default('DIALOGUE'),
    interactionRadius: z.number().int().min(0).max(8).default(1),
    rootNodeId: dialogueIdentifierSchema,
    nodes: z.record(dialogueIdentifierSchema, dialogueNodeSchema),
    merchant: merchantConfigurationSchema.optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    const nodeIds = Object.keys(definition.nodes);
    if (nodeIds.length === 0 || nodeIds.length > 128) {
      context.addIssue({
        code: 'custom',
        path: ['nodes'],
        message: 'A dialogue must contain between 1 and 128 nodes.',
      });
      return;
    }
    if (!definition.nodes[definition.rootNodeId]) {
      context.addIssue({
        code: 'custom',
        path: ['rootNodeId'],
        message: 'The root dialogue node does not exist.',
      });
    }
    if (definition.type === 'MERCHANT' && !definition.merchant) {
      context.addIssue({
        code: 'custom',
        path: ['merchant'],
        message: 'A merchant NPC must define its own item offer.',
      });
    }

    for (const [nodeId, node] of Object.entries(definition.nodes)) {
      const choiceIds = new Set<string>();
      for (const choice of node.choices) {
        if (choiceIds.has(choice.id)) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, 'choices'],
            message: `Dialogue choice "${choice.id}" is duplicated.`,
          });
        }
        choiceIds.add(choice.id);
        if (choice.nextNodeId && !definition.nodes[choice.nextNodeId]) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, 'choices'],
            message: `Dialogue node "${choice.nextNodeId}" does not exist.`,
          });
        }
        if (choice.action === 'OPEN_MERCHANT' && !definition.merchant) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', nodeId, 'choices'],
            message: 'OPEN_MERCHANT requires a merchant configuration.',
          });
        }
      }
    }

    if (definition.merchant) {
      const uniqueItemKeys = new Set(definition.merchant.itemKeys);
      if (uniqueItemKeys.size !== definition.merchant.itemKeys.length) {
        context.addIssue({
          code: 'custom',
          path: ['merchant', 'itemKeys'],
          message: 'Merchant item keys must be unique.',
        });
      }
    }
  });

export type LocalizedDialogueText = z.infer<typeof localizedTextSchema>;
export type NpcDialogueDefinition = z.infer<typeof npcDialogueDefinitionSchema>;
export type NpcDialogueChoice = NpcDialogueDefinition['nodes'][string]['choices'][number];

export function parseNpcDialogueDefinition(value: unknown): NpcDialogueDefinition | undefined {
  const current = npcDialogueDefinitionSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyMerchantDialogueSchema.safeParse(value);
  if (!legacy.success) return undefined;

  return npcDialogueDefinitionSchema.parse({
    type: 'MERCHANT',
    interactionRadius: legacy.data.merchant.interactionRadius,
    rootNodeId: 'welcome',
    nodes: {
      welcome: {
        text: {
          pl: 'Witaj podróżniku, czy chcesz zobaczyć moje towary?',
          en: 'Welcome, traveler. Would you like to see my wares?',
        },
        choices: [
          {
            id: 'show-offer',
            label: {
              pl: 'Pokaż mi co masz w ofercie!',
              en: 'Show me what you have for sale!',
            },
            action: 'OPEN_MERCHANT',
          },
          {
            id: 'decline',
            label: { pl: 'Nie, dziękuję', en: 'No, thank you' },
            action: 'CLOSE',
          },
        ],
      },
    },
    merchant: {
      itemKeys: legacy.data.merchant.itemKeys,
      infiniteStock: legacy.data.merchant.infiniteStock,
    },
  });
}

export function localizeDialogueText(
  value: LocalizedDialogueText,
  locale: SupportedLocale,
): string {
  return typeof value === 'string' ? value : value[locale];
}
