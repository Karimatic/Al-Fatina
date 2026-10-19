import { PERMISSIONS, ROLE_PRESETS, type Permission } from "@elfatina/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";
import { api, del, errorMessage, patch, post, put } from "../api";
import { tr } from "../i18n";
import { ago } from "../lib/format";
import { useMe } from "../Shell";
import { MemberOwnerPanel } from "./MemberDetails";
import { Badge, Button, ErrorState, inputCls, ListSkeleton, NumberField, PageHeader, Sheet, TextField, useToast } from "../ui";

/**
 * Équipe: everyone who can open this admin, on one page (it used to be two: « Équipe » for names
 * and « Comptes » for rights). Tap a person: her role in plain words, her name and Telegram, a
 * new sign-in link, sign out everywhere, switch off. A role is a ready-made card; « Sur mesure »
 * opens the detailed rights only when someone needs them.
 */

interface Member {
  id: number;
  email: string;
  name: string;
  telegram_user_id: number | null;
  is_active: number;
  last_seen_at: number | null;
  has_password: number;
  role: string;
  role_name: string;
  permissions: string[];
  sessions: number;
}

/** The ready-made roles, what each one can do in one line (the order of the cards). */
const ROLES: { key: keyof typeof ROLE_PRESETS | "custom"; icon: string; can: string }[] = [
  { key: "confirmation", icon: "📞", can: "Voit et confirme les commandes, appelle les clientes." },
  { key: "fulfilment", icon: "📦", can: "Prépare et expédie les colis, gère le stock et la caisse." },
  { key: "marketing", icon: "📣", can: "Produits, promos, page d'accueil, avis et statistiques." },
  { key: "manager", icon: "⭐", can: "Tout le travail de la boutique, sauf l'équipe et les connexions." },
  { key: "readonly", icon: "👀", can: "Regarde seulement : commandes, produits, statistiques." },
  { key: "owner", icon: "👑", can: "Tout, y compris l'équipe, les connexions et les suppressions." },
  { key: "custom", icon: "🎛️", can: "Vous choisissez chaque droit, un par un." },
];
const roleName = (key: string) => (key === "custom" ? tr("Sur mesure") : tr(ROLE_PRESETS[key]?.name ?? key));
const roleOf = (m: Pick<Member, "role">) => (m.role.startsWith("custom-") ? "custom" : m.role);

/** Rights by area, in the order of the menu (« Sur mesure »). */
const GROUPS: { title: string; items: [Permission, string][] }[] = [
  { title: "Tableau de bord", items: [["dashboard.view", "Voir le tableau de bord"]] },
  {
    title: "Commandes",
    items: [
      ["orders.view", "Voir les commandes"],
      ["orders.confirm", "Confirmer / annuler"],
      ["orders.ship", "Préparer / expédier / livrer"],
      ["orders.edit", "Modifier une commande"],
      ["orders.discount", "Faire une remise sur une commande"],
      ["orders.export", "Exporter (CSV)"],
    ],
  },
  {
    title: "Clientes",
    items: [
      ["customers.view", "Voir les clientes"],
      ["customers.edit", "Modifier les fiches clientes"],
      ["customers.export", "Exporter les clientes"],
      ["loyalty.edit", "Fidélité (points)"],
    ],
  },
  {
    title: "Catalogue",
    items: [
      ["products.view", "Voir les produits"],
      ["products.edit", "Créer / modifier les produits"],
      ["publish", "Mettre en ligne"],
      ["stock.view", "Voir le stock"],
      ["stock.edit", "Modifier le stock"],
      ["stock.approve", "Valider un inventaire"],
      ["cost.view", "Voir les prix d'achat et marges"],
    ],
  },
  { title: "Ventes", items: [["sales.view", "Voir les ventes"], ["sales.create", "Enregistrer une vente (caisse)"]] },
  {
    title: "Marketing",
    items: [
      ["promos.edit", "Codes promo"],
      ["marketing.edit", "Page d'accueil, collections, liens, notifications"],
      ["reviews.moderate", "Avis"],
      ["contact.view", "Messages de contact"],
    ],
  },
  { title: "Analyse", items: [["stats.view", "Statistiques"], ["finance.view", "Voir les finances"], ["finance.edit", "Modifier les finances"]] },
  {
    title: "Système",
    items: [
      ["content.edit", "Contenu (pages, catégories)"],
      ["delivery.edit", "Tarifs de livraison"],
      ["team.manage", "Équipe"],
      ["integrations.manage", "Connexions (Telegram, ZR, pixels…)"],
      ["errors.view", "Erreurs"],
      ["audit.view", "Journal d'audit"],
    ],
  },
];

/** Every right's name (also used by the owner's details panel). */
export const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(GROUPS.flatMap((g) => g.items.map(([p, label]) => [p, tr(label)])));

const ALL = PERMISSIONS as readonly Permission[];
/** a member's rights, without old ones the shop no longer has */
const permsOf = (m: Pick<Member, "permissions">) => (m.permissions.includes("*") ? [...ALL] : (m.permissions.filter((p) => (ALL as readonly string[]).includes(p)) as Permission[]));
const presetPerms = (key: string) => {
  const p = ROLE_PRESETS[key]?.permissions ?? [];
  return p.includes("*") ? [...ALL] : ([...p] as Permission[]);
};

/** « Envoyez ce lien sur WhatsApp » with the message already written (she chooses the person). */
const whatsappShare = (name: string, url: string) =>
  `https://wa.me/?text=${encodeURIComponent(`Bonjour ${name} ✨ Voici votre accès à l'administration El Fatina (valable 7 jours, une seule fois) : ${url}`)}`;

export function TeamPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ["team"], queryFn: () => api<{ members: Member[] }>("/team") });
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<Member | null>(null);
  const members = q.data?.members ?? [];
  const active = members.filter((m) => m.is_active);
  const off = members.filter((m) => !m.is_active);
  return (
    <div className="space-y-4">
      <PageHeader
        group={tr("Système")}
        title={tr("Équipe")}
        subtitle={tr("Les personnes qui ouvrent l'administration, et ce que chacune peut faire. Touchez une personne pour la modifier.")}
        actions={<Button variant="primary" onClick={() => setInviting(true)}>{tr("+ Inviter quelqu'un")}</Button>}
      />
      {q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !q.data ? (
        <ListSkeleton />
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {active.map((m) => (
              <MemberCard key={m.id} m={m} mine={m.id === me.data?.id} onOpen={() => setOpen(m)} />
            ))}
          </ul>
          {off.length > 0 && (
            <details className="rounded-xl border border-line bg-surface p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink-soft">{tr("Accès désactivés ({0})", { 0: off.length })}</summary>
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {off.map((m) => (
                  <MemberCard key={m.id} m={m} mine={false} onOpen={() => setOpen(m)} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
      {open && <MemberSheet member={open} isMe={open.id === me.data?.id} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MemberCard({ m, mine, onOpen }: { m: Member; mine: boolean; onOpen: () => void }) {
  const role = roleOf(m);
  const card = ROLES.find((r) => r.key === role);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-4 text-start transition hover:border-plum-600/40 ${m.is_active ? "" : "opacity-60"}`}
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-rose-100 text-lg font-bold text-plum-700" aria-hidden="true">
          {m.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {m.name}
            {mine ? tr(" (vous)") : ""}
          </span>
          <span className="block text-sm">
            {card?.icon} {roleName(role)}
          </span>
          <span className="mt-0.5 block text-xs text-ink-soft">{tr(card?.can ?? "")}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {!m.has_password && <Badge tone="bg-amber-100 text-amber-800">{tr("Invitation en attente")}</Badge>}
            {!m.is_active && <Badge tone="bg-stone-200 text-stone-700">{tr("Désactivé")}</Badge>}
            {m.telegram_user_id ? <Badge>{tr("📱 Telegram lié")}</Badge> : null}
            <span className="text-xs text-ink-soft">{tr("vu")} {ago(m.last_seen_at)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** The role cards; « Sur mesure » opens the detailed rights. */
function RolePicker({ role, perms, onRole, onPerms, disabled }: { role: string; perms: Permission[]; onRole: (k: string) => void; onPerms: (p: Permission[]) => void; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={tr("Rôle")} className="grid gap-2 sm:grid-cols-2">
        {ROLES.map((r) => {
          const on = role === r.key;
          return (
            <button
              key={r.key}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => {
                onRole(r.key);
                if (r.key !== "custom") onPerms(presetPerms(r.key));
              }}
              className={`flex items-start gap-2.5 rounded-xl border p-3 text-start transition disabled:opacity-50 ${on ? "border-plum-600 bg-rose-100/60 ring-1 ring-plum-600" : "border-line bg-surface hover:border-plum-600/40"}`}
            >
              <span className="text-xl leading-none" aria-hidden="true">{r.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{roleName(r.key)}</span>
                <span className="block text-xs text-ink-soft">{tr(r.can)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {role === "custom" && <RightsGrid value={perms} onChange={onPerms} disabled={disabled} />}
    </div>
  );
}

function RightsGrid({ value, onChange, disabled }: { value: Permission[]; onChange: (v: Permission[]) => void; disabled?: boolean }) {
  const has = (p: Permission) => value.includes(p);
  const toggle = (p: Permission) => onChange(has(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <div className="space-y-3">
      {GROUPS.map((g) => {
        const all = g.items.every(([p]) => has(p));
        return (
          <fieldset key={g.title} className="rounded-xl border border-line p-3" disabled={disabled}>
            <legend className="flex w-full items-center justify-between px-1 text-sm font-semibold">
              {tr(g.title)}
              <button
                type="button"
                onClick={() => onChange(all ? value.filter((p) => !g.items.some(([x]) => x === p)) : [...new Set([...value, ...g.items.map(([p]) => p)])])}
                className="text-xs font-semibold text-plum-600"
              >
                {all ? tr("Tout retirer") : tr("Tout cocher")}
              </button>
            </legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {g.items.map(([p, label]) => (
                <li key={p}>
                  <label className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition ${has(p) ? "bg-rose-100/60" : "hover:bg-ivory-deep"}`}>
                    <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${has(p) ? "border-plum-600 bg-plum-600 text-white" : "border-line bg-surface"}`}>
                      {has(p) && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                    <input type="checkbox" className="sr-only" checked={has(p)} onChange={() => toggle(p)} />
                    {tr(label)}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

/** The sign-in link, ready to copy or to send on WhatsApp. */
function LinkBox({ name, url, emailed }: { name: string; url: string; emailed?: boolean }) {
  const toast = useToast();
  return (
    <div className="space-y-2 rounded-xl border border-plum-600/30 bg-rose-100/40 p-3">
      <p className="text-sm">
        {emailed ? tr("✉️ Le lien a aussi été envoyé par email.") : tr("Envoyez ce lien à la personne. Il marche 7 jours, une seule fois :")}
      </p>
      <input readOnly dir="ltr" className={`${inputCls} font-mono text-xs`} value={url} onFocus={(e) => e.target.select()} aria-label={tr("Lien")} />
      <div className="flex flex-wrap gap-2">
        <a href={whatsappShare(name, url)} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg bg-[#25D366] px-4 text-sm font-semibold text-white">
          {tr("💬 Envoyer sur WhatsApp")}
        </a>
        <Button onClick={() => void navigator.clipboard?.writeText(url).then(() => toast(tr("Lien copié ✓")))}>{tr("Copier le lien")}</Button>
      </div>
    </div>
  );
}

function InviteSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "" });
  const [role, setRole] = useState("confirmation");
  const [perms, setPerms] = useState<Permission[]>(presetPerms("confirmation"));
  const [result, setResult] = useState<{ inviteUrl: string; emailed: boolean } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      post<{ inviteUrl: string; emailed: boolean }>("/team", { ...form, ...(role === "custom" ? { role: "custom", permissions: perms } : { role }) }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["team"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const ok = form.name.trim().length >= 2 && /^\S+@\S+\.\S+$/.test(form.email.trim());
  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={tr("Inviter quelqu'un")}
      footer={
        result ? (
          <Button className="w-full" onClick={onClose}>{tr("Terminé")}</Button>
        ) : (
          <Button variant="primary" className="w-full" loading={create.isPending} disabled={!ok} onClick={() => create.mutate()}>
            {tr("Créer l'invitation")}
          </Button>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="font-semibold">{tr("✓ {0} est invitée.", { 0: form.name.trim() })}</p>
          <LinkBox name={form.name.trim()} url={result.inviteUrl} emailed={result.emailed} />
          <p className="text-xs text-ink-soft">{tr("Avec ce lien, elle choisit son mot de passe puis configure son application d'authentification.")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-semibold">{tr("1. Qui ?")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tr("Prénom / nom")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label={tr("Email")} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <p className="text-sm font-semibold">{tr("2. Que peut-elle faire ?")}</p>
          <RolePicker role={role} perms={perms} onRole={setRole} onPerms={setPerms} />
        </div>
      )}
    </Sheet>
  );
}

function MemberSheet({ member, isMe, onClose }: { member: Member; isMe: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(member.name);
  const [tg, setTg] = useState<number | null>(member.telegram_user_id);
  const [role, setRole] = useState(roleOf(member));
  const [perms, setPerms] = useState<Permission[]>(permsOf(member));
  const [link, setLink] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["team"] });

  const roleChanged = role !== roleOf(member) || (role === "custom" && JSON.stringify([...perms].sort()) !== JSON.stringify(permsOf(member).sort()));
  const infoChanged = name.trim() !== member.name || tg !== member.telegram_user_id;
  const save = useMutation({
    mutationFn: async () => {
      if (infoChanged) await patch(`/team/${member.id}`, { name: name.trim(), telegramUserId: tg });
      if (roleChanged && !isMe) await (role === "custom" ? put(`/team/${member.id}/permissions`, { permissions: perms }) : patch(`/team/${member.id}`, { role }));
    },
    onSuccess: () => {
      toast(tr("Enregistré ✓"));
      refresh();
      onClose();
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const action = (fn: () => Promise<unknown>, ok: string, close = false) =>
    fn().then(
      () => {
        toast(tr(ok));
        refresh();
        if (close) onClose();
      },
      (e: unknown) => toast(errorMessage(e), "error"),
    );

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={member.name}
      footer={
        <Button variant="primary" className="w-full" disabled={!roleChanged && !infoChanged} loading={save.isPending} onClick={() => save.mutate()}>
          {tr("Enregistrer")}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-ink-soft" dir="auto">
          <span dir="ltr">{member.email}</span> · {tr("{0} appareil(s) connecté(s)", { 0: member.sessions })} · {tr("vu")} {ago(member.last_seen_at)}
        </p>

        <section className="space-y-2">
          <h3 className="font-semibold">{tr("Son rôle")}</h3>
          {isMe ? (
            <p className="rounded-xl bg-ivory-deep p-3 text-sm">{tr("C'est votre compte : votre rôle ne peut être changé que par une autre propriétaire.")}</p>
          ) : (
            <RolePicker role={role} perms={perms} onRole={setRole} onPerms={setPerms} />
          )}
        </section>

        <section className="space-y-3">
          <h3 className="font-semibold">{tr("Ses infos")}</h3>
          <TextField label={tr("Nom")} value={name} onChange={(e) => setName(e.target.value)} />
          <NumberField label={tr("ID Telegram")} hint={tr("Elle envoie /id au bot Telegram de la boutique, puis vous collez le numéro ici : ses actions sur Telegram portent son nom.")} value={tg} onChange={setTg} />
        </section>

        {!isMe && (
          <section className="space-y-2">
            <h3 className="font-semibold">{tr("Son accès")}</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void action(() => post<{ inviteUrl: string }>(`/team/${member.id}/invite`).then((r) => setLink(r.inviteUrl)), "Nouveau lien créé")}>
                {member.has_password ? tr("🔑 Mot de passe oublié : nouveau lien") : tr("✉️ Renvoyer l'invitation")}
              </Button>
              {member.sessions > 0 && (
                <Button size="sm" onClick={() => void action(() => del(`/team/${member.id}/sessions`), "Déconnecté de tous les appareils")}>
                  {tr("Déconnecter de tous ses appareils")}
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  confirm(member.is_active ? tr("Désactiver l'accès de {0} ? Elle est déconnectée tout de suite ; vous pourrez la réactiver.", { 0: member.name }) : tr("Réactiver {0} ?", { 0: member.name })) &&
                  void action(() => patch(`/team/${member.id}`, { isActive: !member.is_active }), member.is_active ? "Accès désactivé" : "Accès réactivé", true)
                }
              >
                {member.is_active ? tr("Désactiver l'accès") : tr("Réactiver")}
              </Button>
            </div>
            {link && <LinkBox name={member.name} url={link} />}
          </section>
        )}

        <MemberOwnerPanel id={member.id} onDeleted={onClose} />
      </div>
    </Sheet>
  );
}
