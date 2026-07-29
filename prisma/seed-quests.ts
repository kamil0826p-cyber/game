import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import { compileCollisionGrid, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const QUEST_KEY = 'rabbit-fur-for-mira';
const NPC_KEY = 'mira-tanner';
const dialogue = {
  type: 'QUEST', rootNodeId: 'need-help',
  quest: { questKey: QUEST_KEY, rootNodes: { notStarted: 'need-help', active: 'waiting', ready: 'ready', rewarded: 'after' } },
  nodes: {
    'need-help': {
      text: { pl: 'Dobrze, że jesteś! Nocami robi się tu przeraźliwie zimno, a ja szyję koce dla dzieci z Greenfields. Potrzebuję pięciu króliczych futer, ale sama nie dam rady przegonić tych spaczonych bestii.', en: 'I am glad you came! The nights are bitterly cold, and I am sewing blankets for the children of Greenfields. I need five rabbit furs, but I cannot face those corrupted beasts alone.' },
      choices: [
        { id: 'accept', label: { pl: 'Pomogę ci. Zdobędę pięć futer.', en: 'I will help. I will bring five furs.' }, questAction: { type: 'ACCEPT', questKey: QUEST_KEY, successNodeId: 'accepted' } },
        { id: 'decline', label: { pl: 'Nie teraz.', en: 'Not now.' }, action: 'CLOSE' },
      ],
    },
    accepted: { text: { pl: 'Dziękuję! Króliki Pomiotu kręcą się po całych Greenfields. Przynieś mi pięć futer, a porządnie cię wynagrodzę.', en: 'Thank you! Spawn Rabbits roam all over Greenfields. Bring me five furs and I will reward you properly.' }, choices: [{ id: 'leave', label: { pl: 'Wrócę z futrami.', en: 'I will return with the furs.' }, action: 'CLOSE' }] },
    waiting: { text: { pl: 'Koce czekają. Masz już dla mnie pięć króliczych futer?', en: 'The blankets are waiting. Do you have five rabbit furs for me?' }, choices: [
      { id: 'turn-in', label: { pl: 'Mam dla ciebie futra.', en: 'I have the furs for you.' }, questAction: { type: 'TURN_IN', questKey: QUEST_KEY, successNodeId: 'thanks', incompleteNodeId: 'missing' } },
      { id: 'leave', label: { pl: 'Jeszcze ich szukam.', en: 'I am still looking.' }, action: 'CLOSE' },
    ] },
    ready: { text: { pl: 'Widzę, że masz komplet futer. Czy to wszystko dla mnie?', en: 'I can see you have all the fur. Is it for me?' }, choices: [
      { id: 'turn-in', label: { pl: 'Tak, weź pięć futer.', en: 'Yes, take five furs.' }, questAction: { type: 'TURN_IN', questKey: QUEST_KEY, successNodeId: 'thanks', incompleteNodeId: 'missing' } },
      { id: 'leave', label: { pl: 'Jeszcze nie.', en: 'Not yet.' }, action: 'CLOSE' },
    ] },
    missing: { text: { pl: 'Nie naliczyłam pięciu futer. Wróć, gdy naprawdę będziesz mieć komplet.', en: 'That is fewer than five furs. Return when you have the full set.' }, choices: [{ id: 'leave', label: { pl: 'Zdobędę resztę.', en: 'I will find the rest.' }, action: 'CLOSE' }] },
    thanks: { text: { pl: 'Są idealne! Jeszcze dziś uszyję z nich ciepłe podszycia. Dziękuję — uratowałeś dzieciom niejedną zimną noc.', en: 'They are perfect! I will sew warm linings tonight. Thank you — you have spared the children many cold nights.' }, choices: [{ id: 'leave', label: { pl: 'Cieszę się, że pomogłem.', en: 'I am glad I could help.' }, action: 'CLOSE' }] },
    after: { text: { pl: 'Koce są już gotowe, a dzieci pierwszy raz od dawna spały spokojnie. Tego, co zrobiłeś, nie zapomnę.', en: 'The blankets are finished, and the children slept peacefully. I will not forget what you did.' }, choices: [
      { id: 'ask', label: { pl: 'Jak radzi sobie osada?', en: 'How is the settlement doing?' }, nextNodeId: 'after-story' },
      { id: 'leave', label: { pl: 'Do zobaczenia, Miro.', en: 'Until next time, Mira.' }, action: 'CLOSE' },
    ] },
    'after-story': { text: { pl: 'Lepiej niż wcześniej. Nadal brakuje nam rąk do pracy, ale przynajmniej noc nie odbiera już ludziom sił.', en: 'Better than before. We still lack helping hands, but the cold no longer steals everyone’s strength.' }, choices: [{ id: 'leave', label: { pl: 'Powodzenia.', en: 'Good luck.' }, action: 'CLOSE' }] },
  },
} as const;

function findNpcPosition(map: { width: number; height: number; spawnX: number; spawnY: number; tiledData: Prisma.JsonValue }, occupied: Set<string>): { x: number; y: number } {
  const collision = compileCollisionGrid(parseTiledMap(map.tiledData));
  const queue = [{ x: 8, y: 5 }]; const visited = new Set<string>();
  const deltas = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!; const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue; visited.add(key);
    if (current.x < 0 || current.y < 0 || current.x >= map.width || current.y >= map.height) continue;
    if (collision[current.y * map.width + current.x] !== 1 && !occupied.has(key) && key !== `${map.spawnX},${map.spawnY}`) return current;
    for (const delta of deltas) { const next = { x: current.x + delta.x, y: current.y + delta.y }; if (next.x >= 0 && next.y >= 0 && next.x < map.width && next.y < map.height && !visited.has(`${next.x},${next.y}`)) queue.push(next); }
  }
  throw new Error('No walkable tile is available for the quest NPC.');
}

async function main(): Promise<void> {
  const realm = await prisma.realm.findUnique({ where: { slug: realmSlug } });
  if (!realm) throw new Error(`Realm ${realmSlug} must be seeded first.`);
  const map = await prisma.map.findUnique({ where: { realmId_key: { realmId: realm.id, key: 'greenfields' } } });
  if (!map) throw new Error('Greenfields must be seeded before quest content.');
  const [npcs, mobs, portals] = await Promise.all([
    prisma.npcDefinition.findMany({ where: { mapId: map.id }, select: { x: true, y: true } }),
    prisma.mobDefinition.findMany({ where: { mapId: map.id }, select: { x: true, y: true } }),
    prisma.portal.findMany({ where: { sourceMapId: map.id }, select: { sourceX: true, sourceY: true } }),
  ]);
  const occupied = new Set([...npcs.map((entry) => `${entry.x},${entry.y}`), ...mobs.map((entry) => `${entry.x},${entry.y}`), ...portals.map((entry) => `${entry.sourceX},${entry.sourceY}`)]);
  const position = findNpcPosition(map, occupied);
  await prisma.$transaction(async (transaction) => {
    await transaction.questDefinition.upsert({
      where: { key: QUEST_KEY },
      create: { key: QUEST_KEY, name: 'Ciepło dla Greenfields', description: 'Zdobądź pięć króliczych futer dla Miry, aby mogła uszyć ciepłe koce dla dzieci z osady.', minimumLevel: 1, steps: [{ id: 'collect-rabbit-fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 5, consumeOnComplete: true, label: { pl: 'Zdobądź królicze futra', en: 'Collect rabbit furs' } }], rewards: { experience: 180, gold: 0, silver: 300 } },
      update: { name: 'Ciepło dla Greenfields', description: 'Zdobądź pięć króliczych futer dla Miry, aby mogła uszyć ciepłe koce dla dzieci z osady.', minimumLevel: 1, steps: [{ id: 'collect-rabbit-fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 5, consumeOnComplete: true, label: { pl: 'Zdobądź królicze futra', en: 'Collect rabbit furs' } }], rewards: { experience: 180, gold: 0, silver: 300 } },
    });
    await transaction.npcDefinition.upsert({ where: { mapId_key: { mapId: map.id, key: NPC_KEY } }, create: { mapId: map.id, key: NPC_KEY, name: 'Mira Igłopalca', x: position.x, y: position.y, outfitKey: 'npc-quest-mira', dialogue }, update: { name: 'Mira Igłopalca', x: position.x, y: position.y, outfitKey: 'npc-quest-mira', dialogue } });
  });
  console.log(`Seeded quest ${QUEST_KEY} and NPC ${NPC_KEY} at Greenfields ${position.x},${position.y}.`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());