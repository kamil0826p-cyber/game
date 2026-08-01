import type { SocketAck } from '../../contracts/socket';
import type {
  SkillBuildSnapshot,
  SkillLoadoutDraft,
  SkillRespecPreview,
} from '../../contracts/skillBuild';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import { GameSocketClient } from './GameSocketClient';

declare module './GameSocketClient' {
  interface GameSocketClient {
    selectSkillSpecialization(
      specializationKey: string,
      expectedVersion: number,
    ): Promise<SkillBuildSnapshot>;
    saveSkillLoadout(
      draft: SkillLoadoutDraft,
      expectedVersion: number,
    ): Promise<SkillBuildSnapshot>;
    activateSkillLoadout(
      loadoutId: string,
      expectedVersion: number,
    ): Promise<SkillBuildSnapshot>;
    previewSkillRespec(
      selectedSpecializationKey: string | undefined,
      ranks: Record<string, number>,
    ): Promise<SkillRespecPreview>;
    respecSkills(
      selectedSpecializationKey: string | undefined,
      ranks: Record<string, number>,
      expectedVersion: number,
    ): Promise<SkillBuildSnapshot>;
  }
}

type SkillClientInternals = {
  requireSocket(): { emit(event: string, payload: unknown, ack: (response: unknown) => void): void };
  withAck<T>(emit: (ack: (response: SocketAck<T>) => void) => void): Promise<SocketAck<T>>;
  assertOk<T>(response: SocketAck<T>): asserts response is { ok: true; data: T };
};

const command = async <T>(
  client: GameSocketClient,
  event: string,
  payload: Record<string, unknown>,
): Promise<T> => {
  const internals = client as unknown as SkillClientInternals;
  const response = await internals.withAck<T>((ack) =>
    internals.requireSocket().emit(event, payload, ack as (response: unknown) => void),
  );
  internals.assertOk(response);
  return response.data;
};

GameSocketClient.prototype.selectSkillSpecialization = async function (
  specializationKey,
  expectedVersion,
) {
  const requestId = createRequestId('skill-specialization');
  const snapshot = await command<SkillBuildSnapshot>(this, 'skills:specialization', {
    requestId,
    operationId: requestId,
    expectedVersion,
    specializationKey,
  });
  gameStore.updateSkillTree(snapshot);
  return snapshot;
};

GameSocketClient.prototype.saveSkillLoadout = async function (draft, expectedVersion) {
  const requestId = createRequestId('skill-loadout-save');
  const snapshot = await command<SkillBuildSnapshot>(this, 'skills:loadoutSave', {
    requestId,
    operationId: requestId,
    expectedVersion,
    ...draft,
  });
  gameStore.updateSkillTree(snapshot);
  return snapshot;
};

GameSocketClient.prototype.activateSkillLoadout = async function (
  loadoutId,
  expectedVersion,
) {
  const requestId = createRequestId('skill-loadout-activate');
  const snapshot = await command<SkillBuildSnapshot>(this, 'skills:loadoutActivate', {
    requestId,
    operationId: requestId,
    expectedVersion,
    loadoutId,
  });
  gameStore.updateSkillTree(snapshot);
  return snapshot;
};

GameSocketClient.prototype.previewSkillRespec = function (
  selectedSpecializationKey,
  ranks,
) {
  return command<SkillRespecPreview>(this, 'skills:respecPreview', {
    requestId: createRequestId('skill-respec-preview'),
    selectedSpecializationKey,
    ranks,
  });
};

GameSocketClient.prototype.respecSkills = async function (
  selectedSpecializationKey,
  ranks,
  expectedVersion,
) {
  const requestId = createRequestId('skill-respec');
  const snapshot = await command<SkillBuildSnapshot>(this, 'skills:respec', {
    requestId,
    operationId: requestId,
    expectedVersion,
    selectedSpecializationKey,
    ranks,
  });
  gameStore.updateSkillTree(snapshot);
  return snapshot;
};
