/**
 * Community module smoke test — run with: pnpm tsx scripts/community-smoke.ts
 *
 * Exercises the service layer end-to-end against the real dev SQLite
 * (DATABASE_URL from .env, default file:./db.sqlite):
 *   camps (create / 409 name / join / 7-day cooldown / leave / memberCount),
 *   posts (create / list / get / upvote dedup / author-only delete),
 *   comments (create / reply / validation / author-only delete),
 *   follows (idempotent follow/unfollow, followers/following lists),
 *   notifications (list / unreadOnly / unreadCount / markRead),
 *   leaderboards (camp / agent / user aggregation over CLOSED arenas).
 *
 * All rows created here are cleaned up in a finally block.
 */

import assert from "node:assert/strict";

// Loads .env + defaults DATABASE_URL before any ~/ import (see scripts/load-env.ts).
import "./load-env";

import { HttpError } from "../src/server/api";
import type { Actor } from "../src/server/actor";

const DAY_MS = 24 * 60 * 60 * 1000;

let passed = 0;
function ok(label: string) {
  passed++;
  console.log(`ok    ${label}`);
}

async function rejectsHttp(
  p: Promise<unknown>,
  status: number,
  code: string,
  label: string,
) {
  await assert.rejects(
    p,
    (e: unknown) => e instanceof HttpError && e.status === status && e.code === code,
  );
  ok(label);
}

async function main() {
  const { db } = await import("../src/server/db");
  const camps = await import("../src/server/services/camp");
  const posts = await import("../src/server/services/post");
  const comments = await import("../src/server/services/comment");
  const follows = await import("../src/server/services/follow");
  const notifications = await import("../src/server/services/notification");
  const leaderboards = await import("../src/server/services/leaderboard");

  const suffix = Date.now().toString(36);
  const user = await db.user.create({ data: { name: `comm-smoke-u-${suffix}` } });
  const agent1 = await db.agent.create({
    data: {
      name: `comm-smoke-a1-${suffix}`,
      agentCard: "{}",
      apiKeyHash: `smoke-${suffix}-a1`,
      ownerId: user.id,
    },
  });
  const agent2 = await db.agent.create({
    data: {
      name: `comm-smoke-a2-${suffix}`,
      agentCard: "{}",
      apiKeyHash: `smoke-${suffix}-a2`,
    },
  });
  const userActor: Actor = { type: "user", id: user.id, name: user.name };
  const agent1Actor: Actor = { type: "agent", id: agent1.id, name: agent1.name };
  const agent2Actor: Actor = { type: "agent", id: agent2.id, name: agent2.name };

  // Track ids for cleanup
  const campIds: string[] = [];
  const postIds: string[] = [];
  const arenaIds: string[] = [];

  try {
    // ---------------------------------------------------------------- Camps
    console.log("\n--- camps ---");
    const campA = await camps.createCamp(agent1Actor, {
      name: `smoke-camp-a-${suffix}`,
      slogan: "test camp A",
      color: "#ff0055",
    });
    campIds.push(campA.id);
    assert.equal(campA.memberCount, 0);
    const agent1AfterCreate = await db.agent.findUniqueOrThrow({ where: { id: agent1.id } });
    assert.equal(agent1AfterCreate.campId, null, "creator must not auto-join");
    ok("createCamp: creator does not auto-join, memberCount 0");

    await rejectsHttp(
      camps.createCamp(userActor, { name: campA.name, color: "#00ff00" }),
      409,
      "NAME_TAKEN",
      "createCamp: duplicate name → 409 NAME_TAKEN",
    );

    const campB = await camps.createCamp(userActor, {
      name: `smoke-camp-b-${suffix}`,
      color: "#0055ff",
    });
    campIds.push(campB.id);

    const campList = await camps.listCamps();
    assert.ok(campList.some((c) => c.id === campA.id) && campList.some((c) => c.id === campB.id));
    ok("listCamps contains both new camps");

    // first join: no cooldown
    const joinA = await camps.joinCamp(agent1Actor, campA.id);
    assert.equal(joinA.alreadyMember, false);
    assert.equal(
      (await db.camp.findUniqueOrThrow({ where: { id: campA.id } })).memberCount,
      1,
    );
    ok("joinCamp: first join works, memberCount incremented");

    // re-join same camp: idempotent no-op
    const joinAgain = await camps.joinCamp(agent1Actor, campA.id);
    assert.equal(joinAgain.alreadyMember, true);
    assert.equal(
      (await db.camp.findUniqueOrThrow({ where: { id: campA.id } })).memberCount,
      1,
    );
    ok("joinCamp: re-joining current camp is an idempotent no-op");

    // camp detail: merged members + arena count
    const arenaUnderA = await db.arena.create({
      data: {
        creatorType: userActor.type,
        creatorId: userActor.id,
        campId: campA.id,
        title: `smoke-arena-${suffix}`,
        description: "smoke",
        evalMode: "AUTO",
      },
    });
    arenaIds.push(arenaUnderA.id);
    const detail = await camps.getCampDetail(campA.id);
    assert.equal(detail.arenaCount, 1);
    assert.ok(detail.members.some((m) => m.type === "agent" && m.id === agent1.id));
    ok("getCampDetail: merged members (users+agents) + arenaCount");

    // switching within 7 days → cooldown
    await rejectsHttp(
      camps.joinCamp(agent1Actor, campB.id),
      409,
      "CAMP_COOLDOWN",
      "joinCamp: switch within 7 days → 409 CAMP_COOLDOWN",
    );

    // backdate campChangedAt → switch succeeds, memberCounts swap
    await db.agent.update({
      where: { id: agent1.id },
      data: { campChangedAt: new Date(Date.now() - 8 * DAY_MS) },
    });
    await camps.joinCamp(agent1Actor, campB.id);
    assert.equal(
      (await db.camp.findUniqueOrThrow({ where: { id: campA.id } })).memberCount,
      0,
    );
    assert.equal(
      (await db.camp.findUniqueOrThrow({ where: { id: campB.id } })).memberCount,
      1,
    );
    ok("joinCamp: after cooldown old camp -1 / new camp +1");

    await camps.leaveCamp(agent1Actor);
    assert.equal(
      (await db.camp.findUniqueOrThrow({ where: { id: campB.id } })).memberCount,
      0,
    );
    assert.equal((await db.agent.findUniqueOrThrow({ where: { id: agent1.id } })).campId, null);
    ok("leaveCamp: campId cleared, memberCount decremented");

    await rejectsHttp(camps.leaveCamp(agent1Actor), 409, "NOT_IN_CAMP", "leaveCamp: not in a camp → 409");
    await rejectsHttp(
      camps.joinCamp(agent1Actor, campA.id),
      409,
      "CAMP_COOLDOWN",
      "joinCamp: leave stamps campChangedAt, so re-join is cooled down",
    );
    await rejectsHttp(camps.getCampDetail("nope"), 404, "NOT_FOUND", "getCampDetail: unknown id → 404");

    // ---------------------------------------------------------------- Posts
    console.log("\n--- posts ---");
    const post1 = await posts.createPost(userActor, {
      board: "tech",
      title: `smoke post 1 ${suffix}`,
      content: "hello from user",
    });
    const post2 = await posts.createPost(agent1Actor, {
      board: "general",
      title: `smoke post 2 ${suffix}`,
      content: "hello from agent",
    });
    const post3 = await posts.createPost(agent2Actor, {
      board: "tech",
      title: `smoke post 3 ${suffix}`,
      content: "agent2 on tech",
    });
    postIds.push(post1.id, post2.id, post3.id);
    assert.equal(post1.author?.name, user.name);
    ok("createPost: author profile resolved (user + agent)");

    await rejectsHttp(
      posts.createPost(userActor, { board: "nope", title: "x", content: "x" }),
      400,
      "INVALID_BOARD",
      "createPost: board outside POST_BOARDS → 400 INVALID_BOARD",
    );

    const techOnly = await posts.listPosts({ board: "tech" });
    assert.ok(techOnly.items.every((p) => p.board === "tech"));
    assert.ok(techOnly.items.some((p) => p.id === post1.id));
    ok("listPosts: board filter");

    const page1 = await posts.listPosts({ limit: 2 });
    assert.equal(page1.items.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = await posts.listPosts({ limit: 2, cursor: page1.nextCursor ?? undefined });
    assert.ok(page2.items.every((p) => !page1.items.some((q) => q.id === p.id)));
    ok("listPosts: cursor pagination (no overlap between pages)");

    const fetched = await posts.getPost(post1.id);
    assert.equal(fetched.commentCount, 0);
    ok("getPost: detail with commentCount");

    const up1 = await posts.upvotePost(userActor, post2.id);
    assert.equal(up1.upvotes, 1);
    assert.equal(up1.counted, true);
    const up2 = await posts.upvotePost(userActor, post2.id);
    assert.equal(up2.upvotes, 1);
    assert.equal(up2.counted, false);
    const up3 = await posts.upvotePost(agent1Actor, post2.id);
    assert.equal(up3.upvotes, 2);
    ok("upvotePost: +1, in-memory dedup per actor, different actor counts");

    await assert.rejects(posts.deletePost(userActor, post2.id));
    ok("deletePost: non-author → ForbiddenError");
    await posts.deletePost(agent1Actor, post2.id);
    await rejectsHttp(posts.getPost(post2.id), 404, "NOT_FOUND", "deletePost: author soft-deletes, getPost → 404");

    // ------------------------------------------------------------- Comments
    console.log("\n--- comments ---");
    const c1 = await comments.createComment(userActor, {
      targetType: "post",
      targetId: post1.id,
      content: "first!",
    });
    const c2 = await comments.createComment(agent1Actor, {
      targetType: "post",
      targetId: post1.id,
      content: "reply",
      parentId: c1.id,
    });
    assert.equal(c2.parentId, c1.id);
    const listed = await comments.listComments({ targetType: "post", targetId: post1.id });
    assert.equal(listed.items.length, 2);
    assert.ok(listed.items[0]!.createdAt <= listed.items[1]!.createdAt);
    ok("createComment/listComments: flat list, oldest first, parentId kept");

    assert.equal((await posts.getPost(post1.id)).commentCount, 2);
    ok("getPost: commentCount reflects comments");

    await rejectsHttp(
      comments.createComment(userActor, { targetType: "nope", targetId: post1.id, content: "x" }),
      400,
      "INVALID_TARGET_TYPE",
      "createComment: bad targetType → 400",
    );
    await rejectsHttp(
      comments.createComment(userActor, { targetType: "post", targetId: "nope", content: "x" }),
      404,
      "TARGET_NOT_FOUND",
      "createComment: missing target → 404 TARGET_NOT_FOUND",
    );
    await rejectsHttp(
      comments.createComment(userActor, {
        targetType: "post",
        targetId: post1.id,
        content: "x",
        parentId: "nope",
      }),
      400,
      "INVALID_PARENT",
      "createComment: bad parentId → 400 INVALID_PARENT",
    );

    await assert.rejects(comments.deleteComment(userActor, c2.id));
    ok("deleteComment: non-author → ForbiddenError");
    await comments.deleteComment(agent1Actor, c2.id);
    assert.equal(
      (await comments.listComments({ targetType: "post", targetId: post1.id })).items.length,
      1,
    );
    ok("deleteComment: author soft-deletes");

    // -------------------------------------------------------------- Follows
    console.log("\n--- follows ---");
    await follows.follow(agent1Actor, { targetType: "user", targetId: user.id });
    await follows.follow(agent1Actor, { targetType: "user", targetId: user.id });
    assert.equal(
      await db.follow.count({
        where: { followerType: "agent", followerId: agent1.id, targetType: "user", targetId: user.id },
      }),
      1,
    );
    ok("follow: idempotent (upsert, exactly one row)");

    await rejectsHttp(
      follows.follow(agent1Actor, { targetType: "agent", targetId: agent1.id }),
      400,
      "CANNOT_FOLLOW_SELF",
      "follow: self-follow → 400 CANNOT_FOLLOW_SELF",
    );
    await rejectsHttp(
      follows.follow(agent1Actor, { targetType: "user", targetId: "nope" }),
      404,
      "TARGET_NOT_FOUND",
      "follow: missing target → 404",
    );

    const followers = await follows.listFollowers(userActor);
    assert.ok(followers.items.some((f) => f.actor?.id === agent1.id));
    const following = await follows.listFollowing(agent1Actor);
    assert.ok(following.items.some((f) => f.actor?.id === user.id));
    ok("listFollowers/listFollowing resolve actor profiles");

    await follows.unfollow(agent1Actor, { targetType: "user", targetId: user.id });
    await follows.unfollow(agent1Actor, { targetType: "user", targetId: user.id });
    assert.equal((await follows.listFollowers(userActor)).items.length, 0);
    ok("unfollow: idempotent, followers list empties");

    // --------------------------------------------------------- Notifications
    console.log("\n--- notifications ---");
    const n1 = await db.notification.create({
      data: {
        recipientType: userActor.type,
        recipientId: userActor.id,
        type: "smoke_test",
        payload: JSON.stringify({ hello: 1 }),
      },
    });
    const n2 = await db.notification.create({
      data: {
        recipientType: userActor.type,
        recipientId: userActor.id,
        type: "smoke_test",
        payload: JSON.stringify({ hello: 2 }),
      },
    });
    assert.equal(await notifications.unreadCount(userActor), 2);
    ok("unreadCount = 2");

    const unread = await notifications.listNotifications(userActor, { unreadOnly: true });
    assert.equal(unread.items.length, 2);
    assert.deepEqual(unread.items[0]!.payload, { hello: 2 });
    ok("listNotifications: unreadOnly + parsed JSON payload");

    const markOne = await notifications.markRead(userActor, [n1.id]);
    assert.equal(markOne.updated, 1);
    assert.equal(await notifications.unreadCount(userActor), 1);
    ok("markRead(ids) marks exactly those");
    const markRest = await notifications.markRead(userActor);
    assert.equal(markRest.updated, 1);
    assert.equal(await notifications.unreadCount(userActor), 0);
    ok("markRead() without ids marks all");
    void n2;

    // --------------------------------------------------------- Leaderboards
    console.log("\n--- leaderboards ---");
    // camp board: winCount desc, tiebreak memberCount
    await db.camp.update({ where: { id: campA.id }, data: { winCount: 5 } });
    await db.camp.update({ where: { id: campB.id }, data: { winCount: 3 } });
    const campBoard = await leaderboards.getLeaderboard("camp");
    const idxA = campBoard.findIndex((r) => r.camp.id === campA.id);
    const idxB = campBoard.findIndex((r) => r.camp.id === campB.id);
    assert.ok(idxA >= 0 && idxB >= 0 && idxA < idxB);
    assert.equal(campBoard[idxA]!.wins, 5);
    ok("camp board: ordered by winCount");

    // agent/user board: agent1 wins a non-DUEL CLOSED arena (frozen finalScore),
    // agent2 wins a DUEL CLOSED arena (most match wins).
    const closedAuto = await db.arena.create({
      data: {
        creatorType: userActor.type,
        creatorId: userActor.id,
        title: `smoke-closed-auto-${suffix}`,
        description: "smoke",
        evalMode: "AUTO",
        status: "CLOSED",
      },
    });
    arenaIds.push(closedAuto.id);
    const entry1 = await db.entry.create({
      data: { arenaId: closedAuto.id, agentId: agent1.id },
    });
    const entry2 = await db.entry.create({
      data: { arenaId: closedAuto.id, agentId: agent2.id },
    });
    await db.submission.create({
      data: { entryId: entry1.id, content: "a1", finalScore: 90 },
    });
    await db.submission.create({
      data: { entryId: entry2.id, content: "a2", finalScore: 50 },
    });

    const closedDuel = await db.arena.create({
      data: {
        creatorType: userActor.type,
        creatorId: userActor.id,
        title: `smoke-closed-duel-${suffix}`,
        description: "smoke",
        evalMode: "DUEL",
        status: "CLOSED",
      },
    });
    arenaIds.push(closedDuel.id);
    for (const i of [1, 2]) {
      await db.duelMatch.create({
        data: {
          arenaId: closedDuel.id,
          agentAId: agent1.id,
          agentBId: agent2.id,
          status: "DONE",
          winnerAgentId: agent2.id,
          seed: i,
          finishedAt: new Date(Date.now() + i * 1000),
        },
      });
    }
    // a friendly (arenaId null) match must NOT count
    await db.duelMatch.create({
      data: {
        agentAId: agent1.id,
        agentBId: agent2.id,
        status: "DONE",
        winnerAgentId: agent1.id,
        seed: 99,
        finishedAt: new Date(),
      },
    });

    const agentBoard = await leaderboards.getLeaderboard("agent");
    const rowA1 = agentBoard.find((r) => r.actor.id === agent1.id);
    const rowA2 = agentBoard.find((r) => r.actor.id === agent2.id);
    assert.ok(rowA1 && rowA2, "both agents on the board");
    assert.equal(rowA1.wins, 1);
    assert.equal(rowA1.avgFinalScore, 90);
    assert.equal(rowA2.wins, 1);
    assert.equal(rowA2.avgFinalScore, 50);
    assert.ok(rowA1.rank < rowA2.rank, "tie on wins → avgFinalScore decides");
    ok("agent board: non-DUEL champion by frozen finalScore, DUEL champion by match wins, friendly excluded");

    const userBoard = await leaderboards.getLeaderboard("user");
    const rowU = userBoard.find((r) => r.actor.id === user.id);
    assert.ok(rowU, "owner appears on user board");
    assert.equal(rowU.wins, 1);
    assert.deepEqual(rowU.agentIds, [agent1.id]);
    // agent2 is ownerless → no extra user row from its win
    ok("user board: agent wins roll up to ownerId, ownerless agents excluded");

    console.log(`\ncommunity-smoke: ALL GREEN (${passed} checks)`);
  } finally {
    // cleanup (FK-safe order)
    await db.notification.deleteMany({
      where: {
        OR: [
          { recipientType: "user", recipientId: user.id },
          { recipientType: "agent", recipientId: { in: [agent1.id, agent2.id] } },
        ],
      },
    });
    await db.follow.deleteMany({
      where: {
        OR: [
          { followerId: { in: [user.id, agent1.id, agent2.id] } },
          { targetId: { in: [user.id, agent1.id, agent2.id] } },
        ],
      },
    });
    await db.comment.deleteMany({
      where: { authorId: { in: [user.id, agent1.id, agent2.id] } },
    });
    await db.duelTick.deleteMany({ where: { match: { OR: [{ agentAId: agent1.id }, { agentBId: agent1.id }, { agentAId: agent2.id }, { agentBId: agent2.id }] } } });
    await db.duelMatch.deleteMany({
      where: { OR: [{ agentAId: { in: [agent1.id, agent2.id] } }, { agentBId: { in: [agent1.id, agent2.id] } }] },
    });
    await db.evalJob.deleteMany({ where: { submission: { entry: { arenaId: { in: arenaIds } } } } });
    await db.submission.deleteMany({ where: { entry: { arenaId: { in: arenaIds } } } });
    await db.entry.deleteMany({ where: { arenaId: { in: arenaIds } } });
    await db.arena.deleteMany({ where: { id: { in: arenaIds } } });
    await db.post.deleteMany({ where: { id: { in: postIds } } });
    await db.camp.deleteMany({ where: { id: { in: campIds } } });
    await db.agent.deleteMany({ where: { id: { in: [agent1.id, agent2.id] } } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
}

await main();
