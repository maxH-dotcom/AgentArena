import { db } from "~/server/db";
import { resolveActors, actorKey, type ActorProfile } from "~/server/services/actors";

/**
 * Leaderboards (docs/PLAN.md 排行榜).
 *
 * Metric decision (no winner field exists on Arena, so wins are aggregated
 * read-time — fine under the capacity assumption of <1000 arenas):
 *
 * - "camp":  Camp.winCount (credited at settlement by eval/settle.ts), tiebreak memberCount.
 * - "agent": championship wins of CLOSED arenas —
 *     · non-DUEL arenas: the entry owning the submission with the highest
 *       frozen finalScore (settle.ts freezes finalScore at close; ties go to
 *       the earliest submission, mirroring closeArena()).
 *     · DUEL arenas: the agent with the most DONE DuelMatch wins
 *       (winnerAgentId) inside that arena; ties go to whoever reached the
 *       count first. Friendly matches (arenaId null) never count.
 *     Tiebreak between agents: mean of their frozen finalScores in CLOSED
 *     arenas (PLAN: 同场比 finalScore 均值).
 * - "user":  agent championship wins attributed to the agent's owner
 *     (Agent.ownerId). Ownerless agents only appear on the agent board.
 *
 * Only actors with wins > 0 are listed.
 */

export type LeaderboardType = "camp" | "user" | "agent";

export interface CampLeaderboardRow {
  rank: number;
  camp: {
    id: string;
    name: string;
    slogan: string | null;
    color: string;
    memberCount: number;
    winCount: number;
  };
  wins: number;
}

export interface ActorLeaderboardRow {
  rank: number;
  actor: ActorProfile;
  wins: number;
  avgFinalScore: number | null;
  /** user board only: the owned agents whose wins roll up into this row */
  agentIds?: string[];
}

export async function getLeaderboard(type: "camp"): Promise<CampLeaderboardRow[]>;
export async function getLeaderboard(type: "user" | "agent"): Promise<ActorLeaderboardRow[]>;
export async function getLeaderboard(
  type: LeaderboardType,
): Promise<CampLeaderboardRow[] | ActorLeaderboardRow[]>;
export async function getLeaderboard(
  type: LeaderboardType,
): Promise<CampLeaderboardRow[] | ActorLeaderboardRow[]> {
  if (type === "camp") return getCampLeaderboard();
  return getActorLeaderboard(type);
}

async function getCampLeaderboard(): Promise<CampLeaderboardRow[]> {
  const camps = await db.camp.findMany({
    orderBy: [{ winCount: "desc" }, { memberCount: "desc" }, { createdAt: "asc" }],
  });
  return camps.map((c, i) => ({
    rank: i + 1,
    camp: {
      id: c.id,
      name: c.name,
      slogan: c.slogan,
      color: c.color,
      memberCount: c.memberCount,
      winCount: c.winCount,
    },
    wins: c.winCount,
  }));
}

interface AgentStats {
  wins: number;
  scoreSum: number;
  scoreCount: number;
}

/** Real-time aggregation of championship wins over all CLOSED arenas. */
async function computeAgentStats(): Promise<Map<string, AgentStats>> {
  const stats = new Map<string, AgentStats>();
  const stat = (agentId: string): AgentStats => {
    let s = stats.get(agentId);
    if (!s) {
      s = { wins: 0, scoreSum: 0, scoreCount: 0 };
      stats.set(agentId, s);
    }
    return s;
  };

  const closedArenas = await db.arena.findMany({
    where: { status: "CLOSED" },
    select: { id: true, evalMode: true },
  });
  if (closedArenas.length === 0) return stats;

  const scoredArenaIds = closedArenas.filter((a) => a.evalMode !== "DUEL").map((a) => a.id);
  const duelArenaIds = new Set(
    closedArenas.filter((a) => a.evalMode === "DUEL").map((a) => a.id),
  );

  // Non-DUEL champions: highest frozen finalScore per arena (ties → earliest).
  if (scoredArenaIds.length > 0) {
    const submissions = await db.submission.findMany({
      where: { entry: { arenaId: { in: scoredArenaIds } }, finalScore: { not: null } },
      select: {
        finalScore: true,
        createdAt: true,
        entry: { select: { arenaId: true, agentId: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const bestByArena = new Map<string, { agentId: string; finalScore: number }>();
    for (const s of submissions) {
      const score = s.finalScore ?? 0;
      const agentId = s.entry.agentId;
      // tiebreak input for every scored submission, champion or not
      const st = stat(agentId);
      st.scoreSum += score;
      st.scoreCount += 1;
      const current = bestByArena.get(s.entry.arenaId);
      if (!current || score > current.finalScore) {
        bestByArena.set(s.entry.arenaId, { agentId, finalScore: score });
      }
    }
    for (const best of bestByArena.values()) {
      stat(best.agentId).wins += 1;
    }
  }

  // DUEL champions: most DONE match wins per arena (ties → first to reach,
  // via insertion order over matches sorted by finishedAt).
  if (duelArenaIds.size > 0) {
    const matches = await db.duelMatch.findMany({
      where: {
        arenaId: { in: [...duelArenaIds] },
        status: "DONE",
        winnerAgentId: { not: null },
      },
      select: { arenaId: true, winnerAgentId: true, finishedAt: true },
      orderBy: { finishedAt: "asc" },
    });
    const tallies = new Map<string, Map<string, number>>();
    for (const m of matches) {
      if (!m.arenaId || !m.winnerAgentId) continue;
      let tally = tallies.get(m.arenaId);
      if (!tally) {
        tally = new Map<string, number>();
        tallies.set(m.arenaId, tally);
      }
      tally.set(m.winnerAgentId, (tally.get(m.winnerAgentId) ?? 0) + 1);
    }
    for (const tally of tallies.values()) {
      let champion: string | null = null;
      let bestCount = 0;
      for (const [agentId, count] of tally) {
        if (count > bestCount) {
          champion = agentId;
          bestCount = count;
        }
      }
      if (champion) stat(champion).wins += 1;
    }
  }

  return stats;
}

function avgOf(s: AgentStats): number | null {
  return s.scoreCount > 0 ? s.scoreSum / s.scoreCount : null;
}

function sortRows<T extends { wins: number; avgFinalScore: number | null; name: string }>(
  rows: T[],
): T[] {
  return rows.sort(
    (a, b) =>
      b.wins - a.wins ||
      (b.avgFinalScore ?? -Infinity) - (a.avgFinalScore ?? -Infinity) ||
      a.name.localeCompare(b.name),
  );
}

async function getActorLeaderboard(
  type: "user" | "agent",
): Promise<ActorLeaderboardRow[]> {
  const stats = await computeAgentStats();
  const winningAgentIds = [...stats.entries()].filter(([, s]) => s.wins > 0).map(([id]) => id);
  if (winningAgentIds.length === 0) return [];

  if (type === "agent") {
    const profiles = await resolveActors(
      winningAgentIds.map((id) => ({ type: "agent", id })),
    );
    const rows = winningAgentIds.flatMap((agentId) => {
      const profile = profiles.get(actorKey({ type: "agent", id: agentId }));
      const s = stats.get(agentId);
      if (!profile || !s) return [];
      return [{ actor: profile, wins: s.wins, avgFinalScore: avgOf(s), name: profile.name }];
    });
    return sortRows(rows).map((r, i) => ({
      rank: i + 1,
      actor: r.actor,
      wins: r.wins,
      avgFinalScore: r.avgFinalScore,
    }));
  }

  // user board: roll agent wins up to Agent.ownerId
  const agents = await db.agent.findMany({
    where: { id: { in: winningAgentIds }, ownerId: { not: null }, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  const byUser = new Map<string, { wins: number; scoreSum: number; scoreCount: number; agentIds: string[] }>();
  for (const agent of agents) {
    const s = stats.get(agent.id);
    if (!s || !agent.ownerId) continue;
    let u = byUser.get(agent.ownerId);
    if (!u) {
      u = { wins: 0, scoreSum: 0, scoreCount: 0, agentIds: [] };
      byUser.set(agent.ownerId, u);
    }
    u.wins += s.wins;
    u.scoreSum += s.scoreSum;
    u.scoreCount += s.scoreCount;
    u.agentIds.push(agent.id);
  }
  const profiles = await resolveActors(
    [...byUser.keys()].map((id) => ({ type: "user", id })),
  );
  const rows = [...byUser.entries()].flatMap(([userId, u]) => {
    const profile = profiles.get(actorKey({ type: "user", id: userId }));
    if (!profile) return [];
    return [
      {
        actor: profile,
        wins: u.wins,
        avgFinalScore: u.scoreCount > 0 ? u.scoreSum / u.scoreCount : null,
        agentIds: u.agentIds,
        name: profile.name,
      },
    ];
  });
  return sortRows(rows).map((r, i) => ({
    rank: i + 1,
    actor: r.actor,
    wins: r.wins,
    avgFinalScore: r.avgFinalScore,
    agentIds: r.agentIds,
  }));
}

