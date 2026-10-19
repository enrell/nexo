import { useEffect, useState } from "react";
import { safetyNumber } from "../lib/identity";
import type { Session } from "../lib/session";
import { Avatar, Modal } from "./common";

type State = { s: Session; pub: string } | null;
let setter: ((s: State) => void) | null = null;

/** Abre a verificação de identidade entre você e outra pessoa. */
export const openSafety = (s: Session, pub: string) => setter?.({ s, pub });

export function SafetyHost() {
  const [state, setState] = useState<State>(null);
  setter = setState;
  if (!state) return null;
  return <SafetyModal s={state.s} pub={state.pub} onClose={() => setState(null)} />;
}

function SafetyModal({ s, pub, onClose }: { s: Session; pub: string; onClose: () => void }) {
  const [num, setNum] = useState<string | null>(null);
  const other = s.profileOf(pub);
  useEffect(() => {
    safetyNumber(s.me, pub).then(setNum);
  }, [s, pub]);
  return (
    <Modal title="Verificar identidade" onClose={onClose}>
      <div className="safety-head">
        <Avatar name={other.name} color={other.color} src={other.avatar} size={48} />
        <div>
          <strong>{other.name}</strong>
          <div className="dim small mono">{pub}</div>
        </div>
      </div>
      <p className="dim">
        Compare este número com o que aparece no Nexo de <strong>{other.name}</strong> — pessoalmente, numa ligação ou por outro app que vocês já confiam. Se for igual, ninguém está se
        passando por nenhum dos dois.
      </p>
      <div className="safety-number mono">{num ?? "calculando…"}</div>
      <p className="dim small">O número muda se alguém trocar de chave (por exemplo, reinstalou sem restaurar o backup). Nesse caso, verifiquem de novo.</p>
    </Modal>
  );
}
