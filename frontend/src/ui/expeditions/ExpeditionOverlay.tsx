import { useEffect, useMemo, useState } from 'react';
import type {
  ExpeditionCatalogView,
  ExpeditionDifficulty,
  ExpeditionPublicView,
} from '../../contracts/expedition';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useGroupState } from '../../game/state/groupStore';

function lootLabel(stack: ExpeditionPublicView['pendingLoot'][number]): string {
  if (stack.silver) return `${stack.silver} srebra`;
  return `${stack.quantity ?? 1}x ${stack.itemKey ?? stack.category}`;
}

function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'brak danych';
  const totalSeconds = Math.floor(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function ExpeditionOverlay(): React.JSX.Element {
  const client = useGameConnection();
  const game = useGameState();
  const groupState = useGroupState();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<ExpeditionCatalogView[]>([]);
  const [run, setRun] = useState<ExpeditionPublicView | null>(null);
  const [definitionKey, setDefinitionKey] = useState('');
  const [difficulty, setDifficulty] = useState<ExpeditionDifficulty>('BASE');
  const [riskKey, setRiskKey] = useState('');
  const [insurance, setInsurance] = useState(false);
  const [formationKey, setFormationKey] = useState('balanced');
  const [roles, setRoles] = useState<Record<string, { roleKey: string; formation: 'FRONT' | 'BACK' }>>({});
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  const prospectiveMembers = groupState.group?.members ?? (game.self ? [game.self] : []);

  useEffect(() => {
    const unsubscribe = client.subscribeExpedition(setRun);
    void Promise.all([client.getExpeditionCatalog(), client.getExpedition()])
      .then(([definitions, current]) => {
        setCatalog(definitions);
        setRun(current);
        const first = definitions[0];
        if (first) {
          setDefinitionKey((value) => value || first.key);
          setRiskKey((value) => value || first.riskProfiles[0]?.key || '');
        }
      })
      .catch(() => undefined);
    return unsubscribe;
  }, [client]);

  useEffect(() => {
    setRoles((current) => {
      const next: Record<string, { roleKey: string; formation: 'FRONT' | 'BACK' }> = {};
      for (const member of prospectiveMembers) {
        next[member.characterId] = current[member.characterId] ?? {
          roleKey: member.characterClass === 'WARRIOR'
            ? 'guardian'
            : member.characterClass === 'MAGE'
              ? 'ritualist'
              : 'scout',
          formation: member.characterClass === 'WARRIOR' ? 'FRONT' : 'BACK',
        };
      }
      return next;
    });
  }, [groupState.group?.id, game.self?.characterId]);

  const definition = useMemo(
    () => catalog.find((entry) => entry.key === definitionKey) ?? catalog[0],
    [catalog, definitionKey],
  );
  const risk = definition?.riskProfiles.find((entry) => entry.key === riskKey)
    ?? definition?.riskProfiles[0];
  const isLeader = Boolean(run && game.self?.characterId === run.preparation.leaderCharacterId);
  const ritualPending = Boolean(
    run?.ritualChoices.length &&
    !run.preparation.ritualChoices[run.currentNode.key],
  );

  const act = async (operation: () => Promise<ExpeditionPublicView>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      setRun(await operation());
    } catch {
      // The socket bridge already publishes a localized notification.
    } finally {
      setBusy(false);
    }
  };

  const prepare = (): Promise<void> => {
    if (!definition || !risk || !riskAccepted) return Promise.resolve();
    return act(() => client.prepareExpedition({
      definitionKey: definition.key,
      definitionVersion: definition.version,
      difficulty,
      riskProfileKey: risk.key,
      riskVersion: risk.version,
      insurancePurchased: insurance,
      formationKey,
      roles,
    }));
  };

  return (
    <>
      <button
        type="button"
        className="retro-button fixed right-4 top-20 z-40 border-amber-300/70 bg-slate-950/90 px-4 py-2 text-amber-100 shadow-xl"
        onClick={() => setOpen((value) => !value)}
      >
        Wyprawa{run?.status === 'ACTIVE' ? ' • aktywna' : ''}
      </button>

      {open ? (
        <section className="fantasy-panel fixed bottom-4 right-4 top-32 z-40 w-[min(520px,calc(100vw-2rem))] overflow-y-auto border border-amber-300/40 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-300">Wyprawy 1–10</p>
              <h2 className="font-display text-2xl text-amber-100">
                {run?.definition.name ?? definition?.name ?? 'Przygotowanie'}
              </h2>
            </div>
            <button type="button" className="retro-button px-3 py-1" onClick={() => setOpen(false)}>×</button>
          </div>

          {!run ? (
            <div className="mt-5 space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-300">Definicja</span>
                <select
                  className="w-full border border-amber-300/30 bg-slate-900 p-2"
                  value={definition?.key ?? ''}
                  onChange={(event) => {
                    const next = catalog.find((entry) => entry.key === event.target.value);
                    setDefinitionKey(event.target.value);
                    setRiskKey(next?.riskProfiles[0]?.key ?? '');
                    setRiskAccepted(false);
                  }}
                >
                  {catalog.map((entry) => <option key={`${entry.key}@${entry.version}`} value={entry.key}>{entry.name}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-slate-300">Trudność</span>
                  <select className="w-full border border-amber-300/30 bg-slate-900 p-2" value={difficulty} onChange={(event) => setDifficulty(event.target.value as ExpeditionDifficulty)}>
                    {definition?.difficultyProfiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.label}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-slate-300">Profil ryzyka</span>
                  <select className="w-full border border-amber-300/30 bg-slate-900 p-2" value={risk?.key ?? ''} onChange={(event) => { setRiskKey(event.target.value); setRiskAccepted(false); }}>
                    {definition?.riskProfiles.map((profile) => <option key={`${profile.key}@${profile.version}`} value={profile.key}>{profile.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="space-y-3 rounded border border-amber-300/20 bg-slate-900/60 p-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-300">Formacja grupy</span>
                  <select
                    className="w-full border border-amber-300/30 bg-slate-900 p-2"
                    value={formationKey}
                    onChange={(event) => {
                      setFormationKey(event.target.value);
                      setRiskAccepted(false);
                    }}
                  >
                    <option value="balanced">Zbalansowana</option>
                    <option value="shield-wall">Mur tarcz</option>
                    <option value="skirmish">Rozproszona</option>
                  </select>
                </label>
                <div className="space-y-2">
                  {prospectiveMembers.map((member) => {
                    const selected = roles[member.characterId];
                    return (
                      <div key={member.characterId} className="grid grid-cols-[1fr_120px_100px] items-center gap-2 text-xs">
                        <span>{member.name} • {member.characterClass}</span>
                        <select
                          className="border border-amber-300/30 bg-slate-900 p-1"
                          value={selected?.roleKey ?? 'scout'}
                          onChange={(event) => {
                            setRoles((current) => ({
                              ...current,
                              [member.characterId]: {
                                roleKey: event.target.value,
                                formation: current[member.characterId]?.formation ?? 'BACK',
                              },
                            }));
                            setRiskAccepted(false);
                          }}
                        >
                          <option value="guardian">Guardian</option>
                          <option value="ritualist">Ritualist</option>
                          <option value="scout">Scout</option>
                          <option value="support">Support</option>
                        </select>
                        <select
                          className="border border-amber-300/30 bg-slate-900 p-1"
                          value={selected?.formation ?? 'BACK'}
                          onChange={(event) => {
                            setRoles((current) => ({
                              ...current,
                              [member.characterId]: {
                                roleKey: current[member.characterId]?.roleKey ?? 'scout',
                                formation: event.target.value as 'FRONT' | 'BACK',
                              },
                            }));
                            setRiskAccepted(false);
                          }}
                        >
                          <option value="FRONT">Front</option>
                          <option value="BACK">Back</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              {definition && risk ? (
                <div className="rounded border border-rose-300/30 bg-rose-950/20 p-3 text-sm leading-6">
                  <p><strong>Grupa:</strong> {definition.minimumPartySize}–{definition.maximumPartySize}, rekomendowane {definition.recommendedPartySize}</p>
                  <p><strong>Koszt:</strong> {definition.preparationCost.silver} srebra + {insurance ? risk.insuranceCostSilver : 0} ubezpieczenia</p>
                  <p><strong>Porażka:</strong> utrata {Math.max(0, risk.pendingLootLossPercent - (insurance ? risk.insurancePendingLootLossReductionPercent : 0))}% niezabezpieczonego łupu</p>
                  <p><strong>Checkpoint:</strong> zabezpiecza {risk.checkpointSecurityPercent}% pending loot</p>
                  <p><strong>Rotacja:</strong> {definition.rotationPolicy.cadence.toLowerCase()}, okno {definition.rotationPolicy.broadWindowDays} dni; core rewards pozostają dostępne</p>
                  <label className="mt-2 flex items-start gap-2">
                    <input type="checkbox" checked={insurance} onChange={(event) => { setInsurance(event.target.checked); setRiskAccepted(false); }} />
                    Kup ubezpieczenie za {risk.insuranceCostSilver} srebra
                  </label>
                  <label className="mt-2 flex items-start gap-2 text-amber-100">
                    <input type="checkbox" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)} />
                    Akceptuję jawny profil ryzyka i blokadę składu, ról, formacji, loadoutu, trudności i ubezpieczenia po utworzeniu lobby.
                  </label>
                </div>
              ) : null}

              <button type="button" className="retro-button w-full border-amber-300/70 bg-amber-500/20 py-2 text-amber-100 disabled:opacity-40" disabled={!riskAccepted || busy || !definition || !risk} onClick={() => void prepare()}>
                Utwórz lobby wyprawy
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded border border-amber-300/20 bg-slate-900/70 p-3"><span className="text-slate-400">Status</span><div className="font-semibold text-amber-100">{run.status}</div></div>
                <div className="rounded border border-amber-300/20 bg-slate-900/70 p-3"><span className="text-slate-400">Grupa</span><div className="font-semibold">{run.party.length}/10</div></div>
                <div className="rounded border border-amber-300/20 bg-slate-900/70 p-3"><span className="text-slate-400">Węzeł</span><div className="font-semibold">{run.currentNode.title}</div></div>
                <div className="rounded border border-amber-300/20 bg-slate-900/70 p-3"><span className="text-slate-400">Revision</span><div className="font-semibold">{run.revision}</div></div>
              </div>

              {run.status === 'PREPARING' ? (
                <div className="space-y-3">
                  <h3 className="font-display text-lg text-amber-200">Lobby i blokady</h3>
                  <div className="space-y-2 text-sm">
                    {run.party.map((member) => (
                      <div key={member.characterId} className="flex justify-between rounded bg-slate-900/80 p-2">
                        <span>
                          {member.name} • {member.characterClass}
                          <small className="block text-slate-400">
                            loadout {member.loadout.loadoutId ?? 'fallback'} v{member.loadout.buildVersion}: {member.loadout.skillKeys.join(', ') || member.loadout.fallbackAction}
                          </small>
                        </span>
                        <span>{member.roleKey} / {member.formation}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400">Od utworzenia lobby zablokowane: {run.preparation.lockedFields.join(', ')}</p>
                  {isLeader ? <button type="button" className="retro-button w-full py-2" disabled={busy} onClick={() => void act(() => client.startExpedition({ runId: run.runId, expectedRevision: run.revision }))}>Rozpocznij wyprawę</button> : <p className="text-sm text-slate-400">Oczekiwanie na lidera.</p>}
                </div>
              ) : null}

              <div>
                <h3 className="font-display text-lg text-amber-200">Zasoby grupy</h3>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  {run.resources.map((resource) => (
                    <div key={resource.key} className="rounded bg-slate-900/80 p-2">
                      <div className="flex justify-between"><span>{resource.label}</span><span>{resource.value}/{resource.maximum}</span></div>
                      <div className="mt-1 h-1.5 bg-slate-700"><div className="h-full bg-amber-300" style={{ width: `${Math.max(0, Math.min(100, resource.value / Math.max(1, resource.maximum) * 100))}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-display text-lg text-amber-200">Odkryta trasa</h3>
                <p className="mt-1 text-xs text-slate-400">{run.visitedNodeKeys.join(' → ')}</p>
                <p className="mt-2 text-sm text-slate-300">{run.currentNode.description}</p>
              </div>

              {run.pendingEncounter ? (
                <div className="rounded border border-rose-300/30 bg-rose-950/20 p-3 text-sm">
                  <strong>Aktywny encounter:</strong> {run.pendingEncounter.encounterKey}@{run.pendingEncounter.encounterVersion}{run.pendingEncounter.variantKey ? ` • ${run.pendingEncounter.variantKey}` : ''}. Podejdź do odpowiadającego moba w świecie i rozpocznij autorytatywną walkę.
                </div>
              ) : null}

              {run.ritualChoices.length > 0 ? (
                <div>
                  <h3 className="font-display text-lg text-amber-200">Przygotowanie rytuału</h3>
                  <div className="mt-2 space-y-2">
                    {run.ritualChoices.map((choice) => (
                      <button key={choice.key} type="button" className="retro-button w-full p-3 text-left disabled:opacity-40" disabled={!isLeader || busy || Boolean(run.preparation.ritualChoices[run.currentNode.key])} onClick={() => void act(() => client.selectExpeditionRitual({ runId: run.runId, expectedRevision: run.revision, choiceKey: choice.key }))}>
                        <strong>{choice.label}</strong><span className="mt-1 block text-xs text-slate-300">{choice.disclosedEffect}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {run.availableRoutes.length > 0 ? (
                <div>
                  <h3 className="font-display text-lg text-amber-200">Następny węzeł</h3>
                  <div className="mt-2 space-y-2">
                    {run.availableRoutes.map((route) => (
                      <button key={route.key} type="button" className="retro-button w-full p-3 text-left disabled:opacity-40" disabled={!isLeader || busy || Boolean(run.pendingEncounter) || ritualPending} onClick={() => void act(() => client.advanceExpedition({ runId: run.runId, expectedRevision: run.revision, edgeKey: route.key }))}>
                        <strong>{route.threatType}</strong>
                        <span className="mt-1 block text-xs text-slate-300">{[route.knownCost, route.rewardCategory, route.scoutHint].filter(Boolean).join(' • ')}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div><h3 className="font-display text-base text-amber-200">Pending loot</h3>{run.pendingLoot.length ? run.pendingLoot.map((stack) => <div key={stack.sourceKey} className="text-xs text-slate-300">{lootLabel(stack)}</div>) : <p className="text-xs text-slate-500">Brak</p>}</div>
                <div><h3 className="font-display text-base text-emerald-200">Secured loot</h3>{run.securedLoot.length ? run.securedLoot.map((stack) => <div key={stack.sourceKey} className="text-xs text-slate-300">{lootLabel(stack)}</div>) : <p className="text-xs text-slate-500">Brak</p>}</div>
              </div>

              <div><h3 className="font-display text-base text-amber-200">Mutatory i konsekwencje</h3><p className="text-xs text-slate-400">{run.activeModifiers.join(' • ')}</p>{run.consequences.map((entry, index) => <p key={`${entry.key}:${index}`} className="text-xs text-rose-200">{entry.key} • severity {entry.severity} • {entry.sourceNodeKey}</p>)}</div>

              {run.finalReport ? (
                <div className="rounded border border-amber-300/30 bg-amber-950/20 p-3 text-sm">
                  <h3 className="font-display text-lg text-amber-100">Raport końcowy</h3>
                  <p>Wynik: <strong>{run.finalReport.outcome}</strong></p>
                  <p>Węzeł końcowy: {run.finalReport.completionNodeKey}{run.finalReport.failureNodeKey ? ` • porażka: ${run.finalReport.failureNodeKey}` : ''}</p>
                  <p>Czas: {durationLabel(run.finalReport.durationMs)} • grupa: {run.finalReport.groupSize}</p>
                  <p>Ekonomia: {run.finalReport.economy.securedSilver + run.finalReport.economy.pendingSilver} srebra, {run.finalReport.economy.securedItemQuantity + run.finalReport.economy.pendingItemQuantity} przedmiotów</p>
                  <p>Decyzje: {run.finalReport.decisions.length} • odwiedzone: {run.finalReport.visitedNodeKeys.length}</p>
                  <div className="mt-2 space-y-1 border-t border-amber-200/20 pt-2">
                    <p className="font-semibold text-amber-100">Wkład drużyny</p>
                    {run.finalReport.contributions.map((contribution) => (
                      <p key={contribution.characterId} className="text-xs text-slate-300">
                        {contribution.name} ({contribution.roleKey}) • wynik {contribution.score} • akcje {contribution.actions} • obrażenia {Math.round(contribution.damage)} • leczenie/ochrona {Math.round(contribution.healing + contribution.protection)} • mechaniki {contribution.mechanics} • timeouty {contribution.timedOutTurns}
                      </p>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="retro-button mt-3 w-full py-2"
                    onClick={() => {
                      setRun(null);
                      setRiskAccepted(false);
                    }}
                  >
                    Przygotuj nową wyprawę
                  </button>
                </div>
              ) : null}

              {run.canExtract && isLeader ? <button type="button" className="retro-button w-full border-emerald-300/60 bg-emerald-500/20 py-2 text-emerald-100" disabled={busy} onClick={() => void act(() => client.extractExpedition({ runId: run.runId, expectedRevision: run.revision }))}>Zabezpiecz łup i zakończ</button> : null}
              {(run.status === 'ACTIVE' || run.status === 'PREPARING') && isLeader ? <button type="button" className="retro-button w-full border-rose-300/50 bg-rose-500/10 py-2 text-rose-100" disabled={busy} onClick={() => void act(() => client.abandonExpedition({ runId: run.runId, expectedRevision: run.revision }))}>Porzuć wyprawę według zaakceptowanego ryzyka</button> : null}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
