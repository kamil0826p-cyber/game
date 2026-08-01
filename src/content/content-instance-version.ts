export type ContentInstanceType = 'ITEM' | 'QUEST' | 'ENCOUNTER' | 'EXPEDITION';

export interface ContentDefinitionSnapshot<TDefinition extends Record<string, unknown> = Record<string, unknown>> {
  instanceType: ContentInstanceType;
  contentVersion: string;
  definitionKey: string;
  definition: TDefinition;
}

const CONTENT_SNAPSHOT_KEY = '__contentSnapshot';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stampContentSnapshot<TState extends Record<string, unknown>, TDefinition extends Record<string, unknown>>(
  state: TState,
  snapshot: ContentDefinitionSnapshot<TDefinition>,
): TState & { __contentSnapshot: ContentDefinitionSnapshot<TDefinition> } {
  return { ...state, [CONTENT_SNAPSHOT_KEY]: snapshot } as TState & {
    __contentSnapshot: ContentDefinitionSnapshot<TDefinition>;
  };
}

export function readContentSnapshot<TDefinition extends Record<string, unknown> = Record<string, unknown>>(
  state: unknown,
  expectedType?: ContentInstanceType,
): ContentDefinitionSnapshot<TDefinition> | undefined {
  if (!isRecord(state)) return undefined;
  const raw = state[CONTENT_SNAPSHOT_KEY];
  if (!isRecord(raw)) return undefined;
  if (
    !['ITEM', 'QUEST', 'ENCOUNTER', 'EXPEDITION'].includes(String(raw.instanceType)) ||
    typeof raw.contentVersion !== 'string' ||
    !raw.contentVersion.trim() ||
    typeof raw.definitionKey !== 'string' ||
    !raw.definitionKey.trim() ||
    !isRecord(raw.definition)
  ) return undefined;
  if (expectedType && raw.instanceType !== expectedType) return undefined;
  return raw as unknown as ContentDefinitionSnapshot<TDefinition>;
}

export function stripContentSnapshot<TState extends Record<string, unknown>>(state: TState): Omit<TState, '__contentSnapshot'> {
  const { [CONTENT_SNAPSHOT_KEY]: _snapshot, ...rest } = state;
  return rest as Omit<TState, '__contentSnapshot'>;
}
