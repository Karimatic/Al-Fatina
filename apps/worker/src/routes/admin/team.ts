/**
 * Admin → Équipe: members, roles and permissions, invitations, sessions.
 */
import { Hono } from "hono";
import { z } from "zod";
import { cleanText, hasPermission, PERMISSIONS, ROLE_PRESETS, type Permission } from "@henine/shared";
import type { AppEnv } from "../../env";
import { auditStmt } from "../../lib/audit";
import { hashPassword, passwordKeyValid } from "../../lib/auth";
import { body, HttpError, intParam } from "../../lib/http";
import { mailLayout, mailProvider, sendMail } from "../../lib/mail";
import { actorOf, requireOwner, requirePermission } from "../../middleware/access";
import { liveDisconnect } from "../../lib/live";
import { createInvite } from "../auth";

export const teamRoutes = new Hono<AppEnv>();

/* ───────────── Équipe ───────────── */

teamRoutes.get("/team", requirePermission("team.manage"), async (c) => {
  const [members, roles] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT m.id, m.email, m.name, m.phone, m.telegram_user_id, m.is_active, m.last_seen_at, m.created_at, m.email_verified_at,
              (m.password_hash IS NOT NULL) AS has_password, r.key AS role, r.name AS role_name, r.permissions AS permissions,
              (SELECT COUNT(*) FROM admin_sessions s WHERE s.member_id = m.id AND s.expires_at > ?) AS sessions
         FROM team_members m JOIN roles r ON r.id = m.role_id ORDER BY m.is_active DESC, m.created_at`,
    ).bind(Date.now()),
    c.env.DB.prepare("SELECT key, name, permissions FROM roles WHERE key NOT LIKE 'custom-%' ORDER BY id"),
  ]);
  return c.json({
    members: (members!.results as ({ permissions: string } & Record<string, unknown>)[]).map((m) => ({ ...m, permissions: JSON.parse(m.permissions) as string[] })),
    roles: (roles!.results as { key: string; name: string; permissions: string }[]).map((r) => ({ ...r, permissions: JSON.parse(r.permissions) })),
  });
});

/**
 * Per-account permissions ("Sur mesure"): each account gets its own role `custom-<id>`, so
 * the permission checks stay exactly the same everywhere. Takes effect on the next request.
 */
const permissionList = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

function customRoleStmts(env: AppEnv["Bindings"], memberId: number, permissions: string[]) {
  const key = `custom-${memberId}`;
  const perms = [...new Set(["dashboard.view", ...permissions])];
  return [
    env.DB.prepare("INSERT INTO roles (key, name, permissions) VALUES (?, 'Sur mesure', ?) ON CONFLICT(key) DO UPDATE SET permissions = excluded.permissions").bind(key, JSON.stringify(perms)),
    env.DB.prepare("UPDATE team_members SET role_id = (SELECT id FROM roles WHERE key = ?) WHERE id = ?").bind(key, memberId),
  ];
}

async function assertNotLastOwner(env: AppEnv["Bindings"], memberId: number) {
  const target = await env.DB.prepare("SELECT r.key FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?").bind(memberId).first<{ key: string }>();
  if (target?.key !== "owner") return;
  const owners = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM team_members m JOIN roles r ON r.id = m.role_id WHERE r.key = 'owner' AND m.is_active = 1 AND m.id != ?",
  )
    .bind(memberId)
    .first<{ n: number }>();
  if (!owners?.n) throw new HttpError(409, "last_owner");
}

/**
 * An account given « Équipe » rights that is not the owner can manage the team, but never
 * climb to the owner's level: no owner role, no changes to an owner's account, and no rights
 * it does not hold itself.
 */
async function assertCanManage(
  c: Parameters<typeof body>[0],
  targetId: number | null,
  grant: { role?: string; permissions?: readonly string[] } = {},
) {
  const me = c.get("member");
  if (me.role === "owner") return;
  const wanted = grant.role ? (ROLE_PRESETS[grant.role]?.permissions ?? ["*"]) : (grant.permissions ?? []);
  if (wanted.some((p) => p === "*" || !hasPermission(me.permissions, p as Permission))) throw new HttpError(403, "owner_only");
  if (targetId != null) {
    const target = await c.env.DB.prepare("SELECT r.key FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?").bind(targetId).first<{ key: string }>();
    if (target?.key === "owner") throw new HttpError(403, "owner_only");
  }
}

teamRoutes.put("/team/:id/permissions", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const { permissions } = await body(c, z.object({ permissions: permissionList }));
  const me = c.get("member");
  if (id === me.id) throw new HttpError(409, "cannot_demote_self");
  const exists = await c.env.DB.prepare("SELECT id FROM team_members WHERE id = ?").bind(id).first();
  if (!exists) throw new HttpError(404, "not_found");
  await assertCanManage(c, id, { permissions });
  await assertNotLastOwner(c.env, id);
  await c.env.DB.batch([...customRoleStmts(c.env, id, permissions), auditStmt(c.env, actorOf(me), "permissions", "team_member", id, { permissions })]);
  return c.json({ ok: true });
});

async function sendInvite(c: Parameters<typeof body>[0], memberId: number, email: string, name: string) {
  const token = await createInvite(c.env, memberId);
  const origin = new URL(c.req.url).origin;
  const url = `${origin}/admin/invitation?token=${token}`;
  const mail = await sendMail(c.env, {
    to: email,
    subject: "Invitation à l'équipe Henine Boutique",
    text: `Bonjour ${name},\n\nVous êtes invitée à rejoindre l'administration de Henine Boutique.\nChoisissez votre mot de passe ici (lien valable 7 jours) :\n${url}`,
    html: mailLayout("Invitation à l'équipe Henine Boutique", [`Bonjour ${name},`, "Vous êtes invitée à rejoindre l'administration de Henine Boutique.", "Ce lien est valable 7 jours."], undefined, { label: "Choisir mon mot de passe", url }),
  });
  return { inviteUrl: url, emailed: mail.delivered && mailProvider(c.env) !== "console", provider: mail.provider };
}

teamRoutes.post("/team", requirePermission("team.manage"), async (c) => {
  const input = await body(
    c,
    z.object({
      email: z.string().trim().toLowerCase().email().max(120),
      name: cleanText(60).pipe(z.string().min(2)),
      role: z.enum(["custom", ...Object.keys(ROLE_PRESETS)] as [string, ...string[]]),
      permissions: permissionList.optional(),
    }),
  );
  await assertCanManage(c, null, input.role === "custom" ? { permissions: input.permissions ?? [] } : { role: input.role });
  const role = await c.env.DB.prepare("SELECT id FROM roles WHERE key = ?").bind(input.role === "custom" ? "readonly" : input.role).first<{ id: number }>();
  if (!role) throw new HttpError(422, "unknown_role");
  let member: { id: number } | null;
  try {
    member = await c.env.DB.prepare("INSERT INTO team_members (email, name, role_id, is_active, created_at) VALUES (?, ?, ?, 1, ?) RETURNING id")
      .bind(input.email, input.name, role.id, Date.now())
      .first<{ id: number }>();
  } catch (err) {
    if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "email_taken");
    throw err;
  }
  await c.env.DB.batch([
    ...(input.role === "custom" ? customRoleStmts(c.env, member!.id, input.permissions ?? []) : []),
    auditStmt(c.env, actorOf(c.get("member")), "invite", "team_member", member!.id, { email: input.email, role: input.role }),
  ]);
  return c.json({ id: member!.id, ...(await sendInvite(c, member!.id, input.email, input.name)) }, 201);
});

teamRoutes.post("/team/:id/invite", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const m = await c.env.DB.prepare("SELECT m.email, m.name, r.permissions FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?")
    .bind(id)
    .first<{ email: string; name: string; permissions: string }>();
  if (!m) throw new HttpError(404, "not_found");
  // a new invitation resets the password and the authenticator: only for an account whose every
  // right the inviter has too (else it would be a way to take over a more powerful account)
  await assertCanManage(c, id, { permissions: JSON.parse(m.permissions) as string[] });
  return c.json(await sendInvite(c, id, m.email, m.name));
});

teamRoutes.patch("/team/:id", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  const input = await body(
    c,
    z.object({
      name: cleanText(60).pipe(z.string().min(2)).optional(),
      role: z.enum(Object.keys(ROLE_PRESETS) as [string, ...string[]]).optional(),
      isActive: z.boolean().optional(),
      telegramUserId: z.number().int().positive().nullable().optional(),
      phone: cleanText(20).nullable().optional(),
    }),
  );
  const me = c.get("member");
  if (id === me.id && (input.isActive === false || (input.role && input.role !== me.role))) throw new HttpError(409, "cannot_demote_self");
  if (id !== me.id) await assertCanManage(c, id, { role: input.role });
  if (input.isActive === false || (input.role && input.role !== "owner")) {
    // never leave the shop without an active owner
    const owners = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM team_members m JOIN roles r ON r.id = m.role_id WHERE r.key = 'owner' AND m.is_active = 1 AND m.id != ?",
    )
      .bind(id)
      .first<{ n: number }>();
    const target = await c.env.DB.prepare("SELECT r.key FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?").bind(id).first<{ key: string }>();
    if (target?.key === "owner" && !owners?.n) throw new HttpError(409, "last_owner");
  }
  const stmts = [
    c.env.DB.prepare(
      `UPDATE team_members SET name = COALESCE(?, name), role_id = COALESCE((SELECT id FROM roles WHERE key = ?), role_id),
         is_active = COALESCE(?, is_active), telegram_user_id = CASE WHEN ? THEN ? ELSE telegram_user_id END,
         phone = CASE WHEN ? THEN ? ELSE phone END WHERE id = ?`,
    ).bind(
      input.name ?? null, input.role ?? null, input.isActive == null ? null : input.isActive ? 1 : 0,
      "telegramUserId" in input ? 1 : 0, input.telegramUserId ?? null, "phone" in input ? 1 : 0, input.phone ?? null, id,
    ),
    auditStmt(c.env, actorOf(me), "update", "team_member", id, input),
  ];
  if (input.isActive === false) stmts.push(c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id));
  try {
    await c.env.DB.batch(stmts);
  } catch (err) {
    if (String((err as Error).message).includes("telegram_user_id")) throw new HttpError(409, "telegram_id_taken");
    throw err;
  }
  if (input.isActive === false) c.executionCtx.waitUntil(liveDisconnect(c.env, id));
  return c.json({ ok: true });
});

/** Everything about one account, for the owner: identity, access, devices, recent actions. */
teamRoutes.get("/team/:id/details", requireOwner, async (c) => {
  const id = intParam(c, "id");
  const m = await c.env.DB.prepare(
    `SELECT m.id, m.email, m.name, m.phone, m.telegram_user_id, m.is_active, m.last_seen_at, m.created_at, m.email_verified_at,
            m.failed_logins, m.locked_until, (m.password_hash IS NOT NULL) AS has_password, r.key AS role, r.name AS role_name, r.permissions
       FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown> & { permissions: string }>();
  if (!m) throw new HttpError(404, "not_found");
  const [sessions, actions, counts] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT id, user_agent, created_at, last_seen_at, expires_at FROM admin_sessions WHERE member_id = ? AND expires_at > ? ORDER BY last_seen_at DESC").bind(id, Date.now()),
    c.env.DB.prepare("SELECT action, entity, entity_id, created_at FROM audit_log WHERE actor LIKE ? ORDER BY id DESC LIMIT 15").bind(`member:${id}:%`),
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM order_events WHERE actor LIKE ?1 AND kind = 'status') AS order_changes,
              (SELECT COUNT(*) FROM orders o JOIN order_events e ON e.order_id = o.id WHERE e.actor LIKE ?1 AND e.to_status = 'confirmee') AS confirmed,
              (SELECT COUNT(*) FROM stock_movements WHERE actor LIKE ?1) AS stock_moves`,
    ).bind(`member:${id}:%`),
  ]);
  return c.json({
    member: { ...m, permissions: JSON.parse(m.permissions) as string[] },
    sessions: sessions!.results,
    actions: actions!.results,
    counts: counts!.results[0],
  });
});

/**
 * The owner gives an account a new password (passwords are never stored readable, so this
 * replaces "seeing" it). The browser stretches it like at login; the account is signed out
 * everywhere and unblocked.
 */
teamRoutes.put("/team/:id/password", requireOwner, async (c) => {
  const id = intParam(c, "id");
  if (id === c.get("member").id) throw new HttpError(409, "use_my_account");
  const input = await body(c, z.object({ newKey: z.string().refine(passwordKeyValid) }));
  const m = await c.env.DB.prepare("SELECT id, email FROM team_members WHERE id = ?").bind(id).first<{ id: number; email: string }>();
  if (!m) throw new HttpError(404, "not_found");
  const { hash, salt } = await hashPassword(c.env, input.newKey);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE team_members SET password_hash = ?, password_salt = ?, email_verified_at = COALESCE(email_verified_at, ?), failed_logins = 0, locked_until = NULL WHERE id = ?",
    ).bind(hash, salt, Date.now(), id),
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id),
    auditStmt(c.env, actorOf(c.get("member")), "password_set_by_owner", "team_member", id),
  ]);
  c.executionCtx.waitUntil(liveDisconnect(c.env, id));
  return c.json({ ok: true });
});

/** Removes an account for good (the owner only; never yourself, never the last owner). */
teamRoutes.delete("/team/:id", requireOwner, async (c) => {
  const id = intParam(c, "id");
  const me = c.get("member");
  if (id === me.id) throw new HttpError(409, "cannot_delete_self");
  const target = await c.env.DB.prepare("SELECT m.id, m.email, m.name, r.key FROM team_members m JOIN roles r ON r.id = m.role_id WHERE m.id = ?")
    .bind(id)
    .first<{ id: number; email: string; name: string; key: string }>();
  if (!target) throw new HttpError(404, "not_found");
  if (target.key === "owner") {
    const owners = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM team_members m JOIN roles r ON r.id = m.role_id WHERE r.key = 'owner' AND m.is_active = 1 AND m.id != ?")
      .bind(id)
      .first<{ n: number }>();
    if (!owners?.n) throw new HttpError(409, "last_owner");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE orders SET assigned_to = NULL WHERE assigned_to = ?").bind(id),
    c.env.DB.prepare("UPDATE products SET created_by = NULL WHERE created_by = ?").bind(id),
    c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM auth_challenges WHERE member_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM team_members WHERE id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM roles WHERE key = ?").bind(`custom-${id}`),
    auditStmt(c.env, actorOf(me), "delete", "team_member", id, { email: target.email, name: target.name }),
  ]);
  c.executionCtx.waitUntil(liveDisconnect(c.env, id));
  return c.json({ ok: true });
});

teamRoutes.delete("/team/:id/sessions", requirePermission("team.manage"), async (c) => {
  const id = intParam(c, "id");
  if (id !== c.get("member").id) await assertCanManage(c, id);
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM admin_sessions WHERE member_id = ?").bind(id), auditStmt(c.env, actorOf(c.get("member")), "revoke_sessions", "team_member", id)]);
  c.executionCtx.waitUntil(liveDisconnect(c.env, id));
  return c.json({ ok: true });
});
