import { z } from 'zod';
import type { SupportedLocale } from '../../i18n/localization.service.js';

const dialogueIdentifierSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const questKeySchema = z.string().trim().min(1).max(96).regex(/^[a-z0-9-]+$/);
const workstationKeySchema = z.string().trim().min(1).max(96).regex(/^[a-z0-9-]+$/);
const marketKeySchema = z.string().trim().min(1).max(96).regex(/^[a-z0-9-]+$/);
const questStageKeySchema = z.string().regex(/^\d+$/);
const localizedTextSchema = z.union([
  z.string().trim().min(1).max(2_000),
  z.object({ en: z.string().trim().min(1).max(2_000), pl: z.string().trim().min(1).max(2_000) }).strict(),
]);
const questDialogueActionSchema = z.object({
  type: z.enum(['ACCEPT', 'TURN_IN']), questKey: questKeySchema,
  successNodeId: dialogueIdentifierSchema, incompleteNodeId: dialogueIdentifierSchema.optional(),
}).strict();
const dialogueChoiceSchema = z.object({
  id: dialogueIdentifierSchema, label: localizedTextSchema,
  nextNodeId: dialogueIdentifierSchema.optional(), action: z.enum(['OPEN_MERCHANT', 'OPEN_CRAFTING', 'OPEN_MARKET', 'CLOSE']).optional(),
  questAction: questDialogueActionSchema.optional(),
}).strict().superRefine((choice, context) => {
  if ([choice.nextNodeId, choice.action, choice.questAction].filter(Boolean).length !== 1)
    context.addIssue({ code: 'custom', message: 'A dialogue choice must define exactly one next node, action, or quest action.' });
});
const dialogueNodeSchema = z.object({ text: localizedTextSchema, choices: z.array(dialogueChoiceSchema).max(12).default([]) }).strict();
const merchantConfigurationSchema = z.object({ itemKeys: z.array(z.string().trim().min(1).max(96)).min(1).max(100), infiniteStock: z.boolean().default(true) }).strict();
const craftingConfigurationSchema = z.object({ workstationKey: workstationKeySchema }).strict();
const marketConfigurationSchema = z.object({ marketKey: marketKeySchema }).strict();
const questConfigurationSchema = z.object({
  questKey: questKeySchema,
  rootNodes: z.object({ notStarted: dialogueIdentifierSchema, active: dialogueIdentifierSchema, ready: dialogueIdentifierSchema, rewarded: dialogueIdentifierSchema }).strict(),
  activeStageNodes: z.record(questStageKeySchema, dialogueIdentifierSchema).optional(),
}).strict();
const legacyMerchantDialogueSchema = z.object({
  type: z.literal('MERCHANT'),
  merchant: merchantConfigurationSchema.extend({ interactionRadius: z.number().int().min(0).max(8).optional() }).strict(),
}).strict();
const npcDialogueDefinitionInputSchema = z.object({
  type: z.enum(['DIALOGUE', 'MERCHANT', 'QUEST']).default('DIALOGUE'),
  interactionRadius: z.number().int().min(0).max(8).optional(),
  rootNodeId: dialogueIdentifierSchema,
  nodes: z.record(dialogueIdentifierSchema, dialogueNodeSchema),
  merchant: merchantConfigurationSchema.optional(),
  crafting: craftingConfigurationSchema.optional(),
  market: marketConfigurationSchema.optional(),
  quest: questConfigurationSchema.optional(),
}).strict().superRefine((definition, context) => {
  if (!definition.nodes[definition.rootNodeId]) context.addIssue({ code: 'custom', path: ['rootNodeId'], message: 'The root dialogue node does not exist.' });
  if (definition.type === 'MERCHANT' && !definition.merchant) context.addIssue({ code: 'custom', path: ['merchant'], message: 'Merchant dialogue requires merchant configuration.' });
  if (definition.type === 'QUEST' && !definition.quest) context.addIssue({ code: 'custom', path: ['quest'], message: 'Quest dialogue requires quest configuration.' });
  if (definition.quest) {
    for (const [state, nodeId] of Object.entries(definition.quest.rootNodes)) {
      if (!definition.nodes[nodeId]) context.addIssue({ code: 'custom', path: ['quest', 'rootNodes', state], message: `Quest root node "${nodeId}" does not exist.` });
    }
    for (const [stage, nodeId] of Object.entries(definition.quest.activeStageNodes ?? {})) {
      if (!definition.nodes[nodeId]) context.addIssue({ code: 'custom', path: ['quest', 'activeStageNodes', stage], message: `Quest stage node "${nodeId}" does not exist.` });
    }
  }
  for (const [nodeId, node] of Object.entries(definition.nodes)) for (const choice of node.choices) {
    if (choice.nextNodeId && !definition.nodes[choice.nextNodeId]) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: `Dialogue node "${choice.nextNodeId}" does not exist.` });
    if (choice.action === 'OPEN_MERCHANT' && !definition.merchant) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: 'OPEN_MERCHANT requires a merchant configuration.' });
    if (choice.action === 'OPEN_CRAFTING' && !definition.crafting) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: 'OPEN_CRAFTING requires a crafting configuration.' });
    if (choice.action === 'OPEN_MARKET' && !definition.market) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: 'OPEN_MARKET requires a market configuration.' });
    if (choice.questAction) {
      if (!definition.quest) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: 'Quest actions require a quest configuration.' });
      if (definition.quest && choice.questAction.questKey !== definition.quest.questKey) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: 'Quest action key must match the NPC quest binding.' });
      for (const targetNodeId of [choice.questAction.successNodeId, choice.questAction.incompleteNodeId].filter(Boolean) as string[]) if (!definition.nodes[targetNodeId]) context.addIssue({ code: 'custom', path: ['nodes', nodeId, 'choices'], message: `Quest action node "${targetNodeId}" does not exist.` });
    }
  }
  if (definition.merchant && new Set(definition.merchant.itemKeys).size !== definition.merchant.itemKeys.length) context.addIssue({ code: 'custom', path: ['merchant', 'itemKeys'], message: 'Merchant item keys must be unique.' });
});
export const npcDialogueDefinitionSchema = npcDialogueDefinitionInputSchema.transform(({ interactionRadius: _legacyInteractionRadius, ...definition }) => definition);
export type LocalizedDialogueText = z.infer<typeof localizedTextSchema>;
export type NpcDialogueDefinition = z.infer<typeof npcDialogueDefinitionSchema>;
export type NpcDialogueChoice = NpcDialogueDefinition['nodes'][string]['choices'][number];
export function parseNpcDialogueDefinition(value: unknown): NpcDialogueDefinition | undefined {
  const current = npcDialogueDefinitionSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyMerchantDialogueSchema.safeParse(value);
  if (!legacy.success) return undefined;
  return npcDialogueDefinitionSchema.parse({
    type: 'MERCHANT', rootNodeId: 'welcome',
    nodes: { welcome: { text: { pl: 'Witaj podróżniku, czy chcesz zobaczyć moje towary?', en: 'Welcome, traveler. Would you like to see my wares?' }, choices: [
      { id: 'show-offer', label: { pl: 'Pokaż mi co masz w ofercie!', en: 'Show me what you have for sale!' }, action: 'OPEN_MERCHANT' },
      { id: 'decline', label: { pl: 'Nie, dziękuję', en: 'No, thank you' }, action: 'CLOSE' },
    ] } },
    merchant: { itemKeys: legacy.data.merchant.itemKeys, infiniteStock: legacy.data.merchant.infiniteStock },
  });
}
export function localizeDialogueText(value: LocalizedDialogueText, locale: SupportedLocale): string { return typeof value === 'string' ? value : value[locale]; }
