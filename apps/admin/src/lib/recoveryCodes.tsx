/**
 * The recovery codes, shown once (after the authenticator app is set up, or renewed in Mon
 * compte): copy them or save them as a file, and tick that they are kept somewhere safe. Each one
 * signs in once if the phone with the app is lost.
 */
import { useState } from "react";
import { tr } from "../i18n";
import { Button, useToast } from "../ui";

export function RecoveryCodesBox({ codes, onDone, doneLabel }: { codes: string[]; onDone?: () => void; doneLabel?: string }) {
  const toast = useToast();
  const [kept, setKept] = useState(false);
  const text = `El Fatina · ${tr("codes de secours")}\n${codes.join("\n")}\n`;
  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        {tr("Gardez ces codes en lieu sûr (papier, autre téléphone). Si vous perdez le téléphone de l'application, chaque code permet de vous connecter une fois. Ils ne seront plus affichés.")}
      </p>
      <ol className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-ivory-deep/40 p-3 font-mono text-base tracking-wider" dir="ltr">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(text).then(
              () => toast(tr("Codes copiés")),
              () => toast(tr("Copie impossible : notez-les à la main"), "error"),
            )
          }
        >
          {tr("📋 Copier")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            a.download = "elfatina-codes-de-secours.txt";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          {tr("⬇️ Télécharger")}
        </Button>
      </div>
      {onDone && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-plum-600" checked={kept} onChange={(e) => setKept(e.target.checked)} />
            {tr("J'ai gardé ces codes en lieu sûr")}
          </label>
          <Button variant="primary" className="w-full" disabled={!kept} onClick={onDone}>
            {doneLabel ?? tr("Continuer")}
          </Button>
        </>
      )}
    </div>
  );
}
