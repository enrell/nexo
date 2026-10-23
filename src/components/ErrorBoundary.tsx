import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; /** o que está sendo protegido, para a mensagem */ what: string; /** troca quando o conteúdo muda: tenta desenhar de novo */ resetKey?: unknown };
type State = { error: Error | null; key: unknown };

/**
 * Um erro ao desenhar uma parte da interface não pode derrubar o app inteiro (tela branca até
 * reinstalar). A parte afetada mostra um aviso com "tentar de novo"; o resto continua funcionando.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`erro ao desenhar ${this.props.what}:`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty fatal" role="alert">
        <h1>Algo deu errado</h1>
        <p className="dim">Não consegui desenhar {this.props.what}. Suas mensagens e sua conta estão salvas e não foram afetadas.</p>
        <p className="dim small mono">{this.state.error.message}</p>
        <div className="row">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Tentar de novo
          </button>
          <button className="btn ghost" onClick={() => location.reload()}>
            Recarregar o app
          </button>
        </div>
      </div>
    );
  }
}
